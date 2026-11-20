import type {
  AdapterContext,
  ConnectorCall,
  ManagedConnectorProvider,
  SecretStore,
} from "@anviq/adapter-kit";
import type {
  ProviderSettingsField,
  IntegrationProviderConfig as SubmittedConfig,
} from "@anviq/contracts";
import { ClientError } from "@anviq/core";
import type { PrismaClient } from "@anviq/db";
import { runAsSystem } from "@anviq/db";
import { getLogger } from "@anviq/logging";
import * as z from "zod";
import { ComposioConnector } from "../providers/integration/composio/composio-connector.js";
import { PipedreamConnector } from "../providers/integration/pipedream/pipedream-connector.js";
import { credentialDigest } from "../secrets/credential-digest.js";

/** Each provider this build has, with the credentials it takes. */
const IntegrationProviderConfigSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("composio"), apiKey: z.string().trim().min(1).max(16384) }),
  z.object({
    provider: z.literal("pipedream"),
    clientId: z.string().trim().min(1).max(512),
    clientSecret: z.string().trim().min(1).max(16384),
    projectId: z.string().trim().min(1).max(512),
    environment: z.enum(["production", "development"]).default("production"),
  }),
]);
type IntegrationProviderConfig = z.infer<typeof IntegrationProviderConfigSchema>;
type IntegrationProviderId = IntegrationProviderConfig["provider"];
export const INTEGRATION_PROVIDER_IDS: readonly IntegrationProviderId[] =
  IntegrationProviderConfigSchema.options.map((option) => option.shape.provider.value);

export interface IntegrationProviderDescriptor {
  id: IntegrationProviderId;
  displayName: string;
  fields: ProviderSettingsField[];
}

export const INTEGRATION_PROVIDER_DESCRIPTORS: readonly IntegrationProviderDescriptor[] = [
  {
    id: "composio",
    displayName: "Composio",
    fields: [
      {
        key: "apiKey",
        label: "Composio API key",
        kind: "secret",
        required: true,
        maxLength: 16384,
      },
    ],
  },
  {
    id: "pipedream",
    displayName: "Pipedream",
    fields: [
      {
        key: "clientId",
        label: "Pipedream client ID",
        kind: "text",
        required: true,
        maxLength: 512,
      },
      {
        key: "clientSecret",
        label: "Pipedream client secret",
        kind: "secret",
        required: true,
        maxLength: 16384,
      },
      {
        key: "projectId",
        label: "Pipedream project ID",
        kind: "text",
        required: true,
        maxLength: 512,
      },
      {
        key: "environment",
        label: "Environment",
        kind: "select",
        required: true,
        default: "production",
        options: [
          { value: "production", label: "Production" },
          { value: "development", label: "Development" },
        ],
      },
    ],
  },
];

const PLUGIN_SLUG_PROVIDER: IntegrationProviderId = "composio";

/** Providers whose credentials belong to each user; any other is configured once for the deployment. */
const PER_USER: ReadonlySet<IntegrationProviderId> = new Set(["composio", "pipedream"]);

/** Resolve persisted credentials on every operation so API and workers observe changes.
 * Cache adapters by ciphertext to preserve sessions without retaining old credentials. */
export class IntegrationProviderSettings {
  private readonly cache = new Map<
    string,
    { ciphertext: string; digest: string; adapter: ManagedConnectorProvider }
  >();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly secrets: SecretStore,
    private readonly identitySecret: string,
    private readonly fallbacks: Partial<
      Record<IntegrationProviderId, ManagedConnectorProvider>
    > = {},
    private readonly factory?: (config: IntegrationProviderConfig) => ManagedConnectorProvider,
  ) {
    this.secrets.onChange?.((ref) => {
      for (const [id, entry] of this.cache) if (entry.ciphertext === ref) this.cache.delete(id);
    });
  }

  private create(config: IntegrationProviderConfig): ManagedConnectorProvider {
    if (this.factory) return this.factory(config);
    return config.provider === "composio"
      ? new ComposioConnector({ apiKey: config.apiKey })
      : new PipedreamConnector({ ...config, identitySecret: this.identitySecret });
  }

  /** Whether this build has an integration provider with that id. */
  has(id: string): id is IntegrationProviderId {
    return (INTEGRATION_PROVIDER_IDS as string[]).includes(id);
  }

  private scope(id: IntegrationProviderId, userId?: string) {
    return PER_USER.has(id) && userId ? `${id}:${userId}` : id;
  }

  private recordId(id: IntegrationProviderId, userId?: string) {
    return `integration-provider:${this.scope(id, userId)}`;
  }

  private async row(id: IntegrationProviderId, userId?: string) {
    if (!PER_USER.has(id)) {
      return this.prisma.integrationProviderConfig.findUnique({
        where: { id },
        select: { ciphertext: true },
      });
    }
    if (!userId) return null;
    // Narrowed to the one user by the key; callers may run outside any request.
    return runAsSystem("read a user's integration provider key", () =>
      this.prisma.userIntegrationProviderConfig.findUnique({
        where: { id: `${id}:${userId}` },
        select: { ciphertext: true },
      }),
    );
  }

  async configured(id: string, userId?: string): Promise<boolean> {
    if (!this.has(id)) return false;
    return Boolean(await this.row(id, userId)) || Boolean(this.fallbacks[id]);
  }

  async resolve(id: string, userId?: string): Promise<ManagedConnectorProvider | undefined> {
    return (await this.prepare(id, userId)).provider;
  }

  async prepare(
    id: string,
    userId?: string,
  ): Promise<{ provider: ManagedConnectorProvider | undefined; ref: string | null }> {
    if (!this.has(id)) return { provider: undefined, ref: null };
    const scope = this.scope(id, userId);
    const row = await this.row(id, userId);
    if (!row) {
      this.cache.delete(scope);
      return { provider: this.fallbacks[id], ref: null };
    }
    let invalidated = false;
    const unsubscribe =
      this.secrets.onChange?.((ref) => {
        if (ref === row.ciphertext) invalidated = true;
      }) ?? (() => {});
    try {
      const plaintext = await this.secrets.load(row.ciphertext, this.recordId(id, userId));
      if (invalidated) return await this.prepare(id, userId);
      const cached = this.cache.get(scope);
      const digest = credentialDigest(plaintext);
      if (cached?.ciphertext === row.ciphertext && cached.digest === digest)
        return { provider: cached.adapter, ref: row.ciphertext };
      const config = IntegrationProviderConfigSchema.parse(JSON.parse(plaintext));
      if (config.provider !== id)
        throw new Error("Integration provider configuration does not match");
      const adapter = this.create(config);
      this.cache.set(scope, { ciphertext: row.ciphertext, digest, adapter });
      return { provider: adapter, ref: row.ciphertext };
    } finally {
      unsubscribe();
    }
  }

  async save(submitted: SubmittedConfig, context: AdapterContext): Promise<void> {
    if (!this.has(submitted.provider))
      throw new ClientError("BAD_REQUEST", "Unknown integration provider");
    const parsed = IntegrationProviderConfigSchema.safeParse(submitted);
    // The schema's own message could repeat a credential.
    if (!parsed.success) throw new ClientError("BAD_REQUEST", "Could not verify these credentials");
    const config = parsed.data;
    const adapter = this.create(config);
    try {
      // Exercises authenticated access before replacing working credentials.
      await adapter.listConnectedExternalIds(context);
    } catch {
      // Provider errors can contain credentials or account details.
      throw new Error("Could not verify these credentials");
    }
    const userId = PER_USER.has(config.provider) ? context.userId : undefined;
    const stored = await this.secrets.put(JSON.stringify(config), context, {
      recordId: this.recordId(config.provider, userId),
    });
    if (userId) {
      const rowId = `${config.provider}:${userId}`;
      await this.prisma.userIntegrationProviderConfig.upsert({
        where: { id: rowId },
        create: {
          id: rowId,
          userId,
          provider: config.provider,
          ciphertext: stored.ciphertext,
        },
        update: { ciphertext: stored.ciphertext },
      });
    } else {
      await this.prisma.integrationProviderConfig.upsert({
        where: { id: config.provider },
        create: { id: config.provider, ciphertext: stored.ciphertext },
        update: { ciphertext: stored.ciphertext },
      });
    }
    // The store may have expired or invalidated this ref while persistence waited.
    // Re-resolve through it before retaining any provider credentials.
    this.cache.delete(this.scope(config.provider, userId));
  }

  /**
   * Connected app slugs from the provider whose app ids match plugin slugs, with the refs of
   * the signed-in accounts when the provider lists them. `refsFailed` says that listing was
   * tried and failed, so rows must not be matched to accounts this time.
   */
  async listConnectedPlugins(
    userId: string,
  ): Promise<{ slugs: string[]; refs?: string[]; refsFailed?: boolean }> {
    const provider = await this.resolve(PLUGIN_SLUG_PROVIDER, userId);
    if (!provider) return { slugs: [] };
    const context = {
      userId,
      spaceId: "",
      operationId: "connections.sync",
      traceId: "connections.sync",
      signal: AbortSignal.timeout(15_000),
    };
    let refsFailed = false;
    const [slugs, refs] = await Promise.all([
      provider.listConnectedExternalIds(context),
      provider.listConnectedRefs?.(context).catch((error: unknown) => {
        getLogger().warn("signed-in accounts could not be listed", { error });
        refsFailed = true;
        return undefined;
      }),
    ]);
    return { slugs, refs, refsFailed };
  }

  providers(): ManagedConnectorProvider[] {
    return INTEGRATION_PROVIDER_IDS.map((id) => new ConfiguredIntegrationProvider(id, this));
  }

  /** Warm catalogs for env- and DB-configured providers. Fire-and-forget. */
  warmDirectories(): void {
    for (const id of INTEGRATION_PROVIDER_IDS) {
      void this.resolve(id)
        .then((provider) => provider?.warmDirectory?.())
        .catch(() => undefined);
    }
  }
}

class ConfiguredIntegrationProvider implements ManagedConnectorProvider {
  readonly resolveConnectedAccountId?: ManagedConnectorProvider["resolveConnectedAccountId"];
  readonly cancelAuthorizationRequest?: ManagedConnectorProvider["cancelAuthorizationRequest"];
  readonly revokeUnreferencedAccounts?: ManagedConnectorProvider["revokeUnreferencedAccounts"];

  constructor(
    private readonly id: IntegrationProviderId,
    private readonly settings: IntegrationProviderSettings,
    private readonly prepared?: ManagedConnectorProvider,
  ) {
    // Only a prepared provider is known up front; callers branch on which of these exist.
    this.resolveConnectedAccountId = prepared?.resolveConnectedAccountId?.bind(prepared);
    this.cancelAuthorizationRequest = prepared?.cancelAuthorizationRequest?.bind(prepared);
    this.revokeUnreferencedAccounts = prepared?.revokeUnreferencedAccounts?.bind(prepared);
  }
  async prepareForTransaction(userId: string) {
    const prepared = await this.settings.prepare(this.id, userId);
    return {
      provider: prepared.provider
        ? new ConfiguredIntegrationProvider(this.id, this.settings, prepared.provider)
        : undefined,
      recheck: async (
        client: Pick<PrismaClient, "integrationProviderConfig" | "userIntegrationProviderConfig">,
      ) => {
        const current = PER_USER.has(this.id)
          ? await client.userIntegrationProviderConfig.findUnique({
              where: { id: `${this.id}:${userId}` },
              select: { ciphertext: true },
            })
          : await client.integrationProviderConfig.findUnique({
              where: { id: this.id },
              select: { ciphertext: true },
            });
        return (current?.ciphertext ?? null) === prepared.ref;
      },
    };
  }
  describe() {
    return {
      id: this.id,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }
  private async resolve(context: AdapterContext) {
    return this.prepared ?? this.settings.resolve(this.id, context.userId);
  }
  private async required(context: AdapterContext) {
    const provider = await this.resolve(context);
    if (!provider) throw new Error("Set up an integration provider in Integrations first");
    return provider;
  }
  async catalog(context: AdapterContext, query?: string) {
    return (await this.resolve(context))?.catalog(context, query) ?? [];
  }
  async listAppTools(context: AdapterContext, externalId: string) {
    const provider = await this.resolve(context);
    if (!provider) return [];
    return provider.listAppTools
      ? provider.listAppTools(context, externalId)
      : provider.discoverTools(context);
  }
  async discoverTools(context: AdapterContext) {
    return (await this.resolve(context))?.discoverTools(context) ?? [];
  }
  async listConnectedExternalIds(context: AdapterContext) {
    return (await this.resolve(context))?.listConnectedExternalIds(context) ?? [];
  }
  async needsReconnect(context: AdapterContext, externalId: string) {
    return (await (await this.resolve(context))?.needsReconnect?.(context, externalId)) ?? false;
  }
  async listConnectedRefs(context: AdapterContext) {
    return (await this.resolve(context))?.listConnectedRefs?.(context);
  }
  async listReconnectRefs(context: AdapterContext) {
    return (await (await this.resolve(context))?.listReconnectRefs?.(context)) ?? [];
  }
  async connectionReady(context: AdapterContext, externalId: string) {
    return (await this.required(context)).connectionReady(context, externalId);
  }
  async begin(request: Parameters<ManagedConnectorProvider["begin"]>[0], context: AdapterContext) {
    return (await this.required(context)).begin(request, context);
  }
  async complete(
    request: Parameters<ManagedConnectorProvider["complete"]>[0],
    context: AdapterContext,
  ) {
    return (await this.required(context)).complete(request, context);
  }
  async revoke(ref: string, context: AdapterContext) {
    return (await this.required(context)).revoke(ref, context);
  }
  async resolveCall(call: ConnectorCall, context: AdapterContext) {
    const provider = await (call.route ? this.required(context) : this.resolve(context));
    return provider?.resolveCall?.(call, context);
  }
  async *execute(call: ConnectorCall, context: AdapterContext) {
    yield* (await this.required(context)).execute(call, context);
  }
}

export async function prepareManagedConnectorForTransaction(
  connector: ManagedConnectorProvider,
  userId: string,
) {
  return connector instanceof ConfiguredIntegrationProvider
    ? connector.prepareForTransaction(userId)
    : { provider: connector, recheck: undefined };
}
