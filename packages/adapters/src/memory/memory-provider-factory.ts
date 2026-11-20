import type { DurableMemoryScope, SecretStore, SemanticMemoryProvider } from "@anviq/adapter-kit";
import type { MemoryProviderDescriptor } from "@anviq/contracts";
import { settingsFieldProblem, visibleSettingsFields } from "@anviq/core";
import type { PrismaClient } from "@anviq/db";
import { contentEncryptionOf } from "@anviq/db";
import { getLogger } from "@anviq/logging";
import type { MemoryEngine, MirrorMode, MirrorResult } from "@anviq/memory-engine";
import { createMemoryEngine } from "@anviq/memory-engine";
import { Client } from "pg";
import { ANVIQ_MEMORY_PROVIDER_ID, AnviqMemoryProvider } from "./anviq-memory-provider.js";
import type { MemoryProviderDefinition } from "./memory-provider-descriptor.js";
import { knownMemoryProvider, memoryProviders } from "./memory-providers.js";
import { createMemorySealer } from "./memory-sealer.js";

export { MemoryProviderPrivateEndpointRequiredError } from "../providers/memory/serenity/serenity-memory-provider.js";

export interface MemoryProviderConnectionInput {
  provider: string;
  settings: Record<string, string>;
  credentials: Record<string, string>;
  /** When false, providers must not probe endpoints that classify as private. */
  allowPrivateEndpoint?: boolean;
}

export interface PreparedMemoryProviderConnection {
  provider: string;
  settings: Record<string, string>;
  credentials: Record<string, string>;
}

export interface ConfiguredMemoryProvider {
  provider: SemanticMemoryProvider;
  defaultScope: DurableMemoryScope;
}

export interface MemoryProviderResolver {
  resolve(spaceId: string): Promise<ConfiguredMemoryProvider | null>;
  /** Remove built-in memories when their owner is deleted. */
  purgeBot?(botId: string): Promise<void>;
  purgeSpace?(spaceId: string): Promise<void>;
}

function memoryProviderAdapter(provider: string): MemoryProviderDefinition {
  const adapter = knownMemoryProvider(provider);
  if (!adapter) throw new Error(`Unknown memory provider "${provider}".`);
  return adapter;
}

/** Every provider's settings form, in the order a Space picks from; the first is offered first. */
export function memoryProviderDescriptors(): MemoryProviderDescriptor[] {
  return Object.entries(memoryProviders).map(
    ([
      id,
      {
        settings: { displayName, fields },
      },
    ]) => ({
      id,
      displayName,
      fields,
    }),
  );
}

/** One line naming a saved connection, or nothing for a provider this build does not have. */
export function memoryProviderConnectionLabel(
  provider: string,
  settings: Record<string, string>,
): string | undefined {
  return knownMemoryProvider(provider)?.settings.connectionLabel(settings);
}

/**
 * Refuses settings the provider's form would not send. Settings no field names are left to the
 * provider, and so are secrets: only it knows whether a key is needed where it connects.
 */
export function assertMemoryProviderSettings(
  provider: string,
  settings: Record<string, string>,
): void {
  const { fields } = memoryProviderAdapter(provider).settings;
  for (const field of visibleSettingsFields(fields, settings)) {
    if (field.kind === "secret") continue;
    const problem = settingsFieldProblem(field, settings);
    if (!problem) continue;
    if (problem.message) throw new Error(problem.message);
    if (problem.rule === "required") throw new Error(`${field.key} is required`);
    if (problem.rule === "length") throw new Error(`${field.key} is the wrong length`);
    throw new Error(`${field.key} is not one of its choices`);
  }
}

/** The stored settings an edit carries over because no field of the form holds them. */
export function keptMemoryProviderSettings(
  provider: string,
  stored: Record<string, string>,
): Record<string, string> {
  const kept = memoryProviderAdapter(provider).settings.keptSettings ?? [];
  return Object.fromEntries(
    kept.flatMap((key) => (stored[key] === undefined ? [] : [[key, stored[key]]])),
  );
}

/** Adapters classify their settings; callers enforce the deployment trust boundary. */
export function memoryProviderRequiresPrivateEndpoint(
  provider: string,
  settings: Record<string, string>,
): boolean {
  return memoryProviderAdapter(provider).requiresPrivateEndpoint(settings);
}

/** Where a provider's stored credentials would be sent and what they could read there. */
export function memoryProviderCredentialTarget(
  provider: string,
  settings: Record<string, string>,
): string {
  return memoryProviderAdapter(provider).credentialTarget(settings);
}

/**
 * Run provider-specific trust classification (DNS, etc.) without credentialed probes.
 * Callers must authorize private endpoints through operator configuration before prepare/probe.
 */
export async function classifyMemoryProviderSettings(
  provider: string,
  settings: Record<string, string>,
): Promise<Record<string, string>> {
  const adapter = memoryProviderAdapter(provider);
  return adapter.classifySettings ? adapter.classifySettings(settings) : settings;
}

export async function prepareMemoryProviderConnection(
  input: MemoryProviderConnectionInput,
): Promise<PreparedMemoryProviderConnection> {
  const prepared = await memoryProviderAdapter(input.provider).prepare(
    input.settings,
    input.credentials,
    { allowPrivateEndpoint: input.allowPrivateEndpoint },
  );
  return { provider: input.provider, ...prepared };
}

export function createMemoryProvider(
  provider: string,
  settings: Record<string, string>,
  credentials: Record<string, string>,
  connectionVersion?: string,
): SemanticMemoryProvider {
  return memoryProviderAdapter(provider).create(settings, credentials, connectionVersion);
}

export function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function decodeCredentials(provider: string, plaintext: string): Record<string, string> {
  try {
    const credentials = toStringRecord(JSON.parse(plaintext));
    if (Object.keys(credentials).length > 0) return credentials;
  } catch {
    // Configurations created before the generic provider boundary stored the API key directly.
  }
  const legacyCredentials = memoryProviderAdapter(provider).decodeLegacyCredentials?.(plaintext);
  if (legacyCredentials) return legacyCredentials;
  throw new Error(`Stored credentials for memory provider "${provider}" are invalid.`);
}

/** The built-in memory engine, sealed with the space keys when the client encrypts content. */
function builtInMemoryEngine(prisma: Pick<PrismaClient, "$queryRawUnsafe">): MemoryEngine {
  const ring = contentEncryptionOf(prisma)?.ring;
  return createMemoryEngine(
    async (sql, params = []) => ({ rows: await prisma.$queryRawUnsafe(sql, ...params) }),
    ring ? { sealer: createMemorySealer(ring) } : {},
  );
}

/**
 * Creates or upgrades the built-in memory schema. It runs with the migration (owner) role so the
 * runtime login never needs the right to create schemas.
 */
export async function migrateBuiltInMemory(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await createMemoryEngine(async (sql, params = []) => ({
      rows: (await client.query(sql, params)).rows,
    })).ensureSchema();
  } finally {
    await client.end();
  }
}

/**
 * Seals existing built-in memories, or writes them back as plaintext for a rollback. Skips a
 * deployment that never used built-in memory, so it never creates the schema.
 */
export async function rewriteBuiltInMemory(
  prisma: Pick<PrismaClient, "$queryRawUnsafe">,
  mode: "seal" | "unseal",
): Promise<{ scanned: number; updated: number } | undefined> {
  const rows = await prisma.$queryRawUnsafe<Array<{ found: string | null }>>(
    "SELECT to_regclass('anviq_memory.memories')::text AS found",
  );
  if (!rows[0]?.found) return undefined;
  return builtInMemoryEngine(prisma).rewrite({ mode });
}

/** Decrypts a Space's stored provider credentials. */
export async function loadMemoryProviderCredentials(
  secrets: Pick<SecretStore, "load">,
  provider: string,
  secret: { id: string; ciphertext: string },
): Promise<Record<string, string>> {
  return decodeCredentials(provider, await secrets.load(secret.ciphertext, secret.id));
}

export class SpaceMemoryProviderResolver implements MemoryProviderResolver {
  private readonly engine: MemoryEngine;

  constructor(
    private readonly prisma: Pick<
      PrismaClient,
      "spaceMemoryConfig" | "deploymentSettings" | "bot" | "$queryRawUnsafe"
    >,
    private readonly secrets: SecretStore,
  ) {
    this.engine = builtInMemoryEngine(prisma);
  }

  // Nothing to purge before the built-in store has ever been used, and creating its schema
  // on a delete path would need privileges the database role may not have.
  private async hasBuiltInStore(): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ found: string | null }>>(
      "SELECT to_regclass('anviq_memory.memories')::text AS found",
    );
    return Boolean(rows[0]?.found);
  }

  async purgeBot(botId: string): Promise<void> {
    if (await this.hasBuiltInStore()) await this.engine.purgeBot(botId);
  }

  async purgeSpace(spaceId: string): Promise<void> {
    if (await this.hasBuiltInStore()) await this.engine.purgeSpace(spaceId);
  }

  syncMirror(options: { dir: string; mode: MirrorMode }): Promise<MirrorResult> {
    return this.engine.syncFolder({
      ...options,
      resolveSpaceId: async (botId) =>
        (await this.prisma.bot.findUnique({ where: { id: botId }, select: { spaceId: true } }))
          ?.spaceId,
    });
  }

  async resolve(spaceId: string): Promise<ConfiguredMemoryProvider | null> {
    const config = await this.prisma.spaceMemoryConfig.findUnique({
      where: { spaceId },
      include: { secret: true },
    });
    if (!config) {
      return {
        provider: new AnviqMemoryProvider(this.engine),
        defaultScope: "isolated",
      };
    }
    if (config.provider === ANVIQ_MEMORY_PROVIDER_ID) {
      return {
        provider: new AnviqMemoryProvider(this.engine),
        defaultScope: config.defaultMemoryScope === "shared" ? "shared" : "isolated",
      };
    }
    const settings = toStringRecord(config.settings);
    if (memoryProviderRequiresPrivateEndpoint(config.provider, settings)) {
      // Saved configurations cannot bypass an operator's current network policy.
      if (process.env.MCP_ALLOW_PRIVATE_ENDPOINT !== "true") return null;
    }
    const adapter = memoryProviderAdapter(config.provider);
    try {
      await adapter.revalidate?.(settings);
    } catch {
      getLogger().warn("Semantic memory disabled: endpoint revalidation failed");
      return null;
    }
    const credentials = await loadMemoryProviderCredentials(
      this.secrets,
      config.provider,
      config.secret,
    );
    return {
      provider: createMemoryProvider(
        config.provider,
        settings,
        credentials,
        // Memory connection saves create a new secret ID when credentials change.
        JSON.stringify([config.id, config.secretId, config.provider]),
      ),
      defaultScope: config.defaultMemoryScope === "shared" ? "shared" : "isolated",
    };
  }
}
