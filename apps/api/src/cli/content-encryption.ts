import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import {
  AwsKmsKeyProvider,
  awsKmsConfigFromEnv,
  contentKeyProviderFromEnv,
  createSecretStore,
  EncryptedSecretStore,
  LocalArtifactStore,
  rewriteBuiltInMemory,
  upgradeLegacySecrets,
  withSecretPersistence,
} from "@anviq/adapters";
import { resolveContentEncryption, resolveEncryptionKey } from "@anviq/core";
import { loadRootEnv } from "@anviq/core/node/load-root-env";
import type { ContentMigrationMode } from "@anviq/db";
import {
  clearOrganizationKey,
  contentEncryptionStatus,
  createDb,
  exportContent,
  migrateContent,
  organizationKeys,
  rewrapSpaceKeys,
  rotateSpaceDataKeys,
  runAsSystem,
  setOrganizationKey,
} from "@anviq/db";
import { moveMcpArgsIntoSecrets } from "../mcp-args-migration.js";
import { createSecretMigrationRepository } from "../secret-migration.js";

loadRootEnv();

const USAGE = `Usage: content-encryption <command> [--dry-run]
  status               Rows and artifacts still in plaintext, keys per master key
  migrate              Encrypt existing content, upgrade legacy credentials and
                       move MCP server arguments into their encrypted credentials
  rotate [--reencrypt] Re-wrap space keys under the active master key; with
                       --reencrypt also add new data keys and re-encrypt content
  reencrypt            Re-encrypt content still under an older data key
  decrypt              Write plaintext back, after CONTENT_ENCRYPTION=off or
                       before rolling back to an older release
  export [--space <id>] [--thread <id>] [--bot <id>] [--output <file>]
                       Write decrypted threads, messages and memory as JSON lines
  org-key list         Organizations with their own KMS key
  org-key set <organization id> <key arn>
                       Wrap the organization's space keys with the company's KMS
                       key (checked first); run rotate to move the existing ones
  org-key clear <organization id>
                       Back to the deployment key for new space keys`;

const COMMANDS = ["status", "migrate", "rotate", "reencrypt", "decrypt", "export", "org-key"];
const EXPORT_OPTIONS = ["space", "thread", "bot", "output"] as const;
/** org-key subcommand and how many words follow the command: `list`, `set <org> <arn>`, `clear <org>`. */
const ORG_KEY_ARGS = new Map([
  ["list", 1],
  ["set", 3],
  ["clear", 2],
]);

function parseCommand() {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean" },
        reencrypt: { type: "boolean" },
        space: { type: "string" },
        thread: { type: "string" },
        bot: { type: "string" },
        output: { type: "string" },
      },
    });
    const [command, ...rest] = positionals;
    const exporting = command === "export";
    const orgKey = command === "org-key";
    if (
      !command ||
      !COMMANDS.includes(command) ||
      (orgKey
        ? !ORG_KEY_ARGS.has(rest[0] ?? "") || rest.length !== ORG_KEY_ARGS.get(rest[0]!)!
        : rest.length) ||
      (values.reencrypt && command !== "rotate") ||
      (values["dry-run"] && exporting) ||
      (!exporting && EXPORT_OPTIONS.some((name) => values[name] !== undefined)) ||
      EXPORT_OPTIONS.some((name) => values[name] === "")
    )
      return undefined;
    return { command, values, args: rest };
  } catch {
    return undefined;
  }
}

const parsed = parseCommand();
if (!parsed) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
const { command, values: flags, args } = parsed;
const dryRun = flags["dry-run"] === true;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// Encrypting commands seal content whatever CONTENT_ENCRYPTION says; the rest
// only read, or write plaintext back.
const encrypting = ["migrate", "rotate", "reencrypt"].includes(command);
const { prisma, pool, contentKeys } = createDb(process.env.DATABASE_URL, {
  applicationName: "anviq-content-encryption",
  keyProvider: contentKeyProviderFromEnv(),
  ...(encrypting ? { encryptContent: true } : {}),
});
const artifacts = new LocalArtifactStore(process.env.DATA_DIR ?? "./data", contentKeys);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const write = (line: string) => process.stdout.write(`${line}\n`);

/** JSON lines to stdout, or to a new owner-only file; the export holds plaintext. */
async function exportJsonLines() {
  let records = 0;
  async function* lines() {
    for await (const record of exportContent(
      prisma,
      { spaceId: flags.space, threadId: flags.thread, botId: flags.bot },
      { signal: controller.signal },
    )) {
      records += 1;
      yield `${JSON.stringify(record)}\n`;
    }
  }
  // pipeline surfaces write errors (a full disk, a closed pipe) and closes the file on failure.
  if (flags.output) {
    await pipeline(lines(), createWriteStream(flags.output, { flags: "wx", mode: 0o600 }));
    write(`export: ${records} records written to ${flags.output}`);
  } else {
    await pipeline(lines(), process.stdout, { end: false });
    process.stderr.write(`export: ${records} records\n`);
  }
}

async function rewriteContent(mode: ContentMigrationMode) {
  if (!(await artifacts.hasDirectory()))
    write("artifacts: no artifact directory under DATA_DIR; files were not checked");
  else if (!dryRun) {
    const removed = await artifacts.removeAbandoned();
    if (removed) write(`artifacts: removed ${removed} temporary files left by an interrupted run`);
  }
  for (const table of await migrateContent(prisma, {
    mode,
    dryRun,
    signal: controller.signal,
  }))
    write(
      `${table.table}: ${table.updated} of ${table.scanned} ${dryRun ? "to rewrite" : "rewritten"}`,
    );
  if (mode !== "reencrypt") {
    const memory = dryRun
      ? undefined
      : await rewriteBuiltInMemory(prisma, mode === "encrypt" ? "seal" : "unseal");
    write(
      dryRun
        ? "memories: not checked in a dry run"
        : memory
          ? `memories: ${memory.updated} of ${memory.scanned} rewritten`
          : "memories: built-in memory was never used",
    );
  }
  let files = 0;
  let rewritten = 0;
  for await (const file of artifacts.files()) {
    controller.signal.throwIfAborted();
    files += 1;
    try {
      if (dryRun) continue;
      if ((await artifacts.rewriteFile(file.spaceId, file.id, mode)) === "rewritten")
        rewritten += 1;
    } catch {
      write(`artifact ${file.spaceId}/${file.id}: failed`);
      process.exitCode = 1;
    }
  }
  write(`artifacts: ${dryRun ? "not checked in a dry run" : `${rewritten} of ${files} rewritten`}`);
}

const KEY_ARN = /^arn:aws[a-z-]*:kms:[a-z0-9-]+:\d{12}:key\/[A-Za-z0-9-]+$/;

/** The company's own KMS key for its organization's space keys. */
async function orgKey() {
  const [action, organizationId, keyArn] = args;
  if (action === "list") {
    const configs = await organizationKeys(prisma);
    for (const config of configs)
      write(
        `${config.organizationId}: ${config.keyArn || "deployment key"}${
          config.previousKeyArns.length ? ` (earlier: ${config.previousKeyArns.join(", ")})` : ""
        }`,
      );
    if (!configs.length) write("no organization has its own key");
    return;
  }
  if (!(await prisma.organization.findUnique({ where: { id: organizationId! } })))
    throw new Error(`Unknown organization ${organizationId}`);
  if (action === "clear") {
    write(
      (await clearOrganizationKey(prisma, organizationId!))
        ? `${organizationId}: new space keys use the deployment key; run rotate to move the existing ones`
        : `${organizationId}: no key was set`,
    );
    return;
  }
  if (!KEY_ARN.test(keyArn!)) throw new Error("The key must be a KMS key ARN, not an alias");
  // Prove the server can use the key before any space key depends on it.
  const kms = new AwsKmsKeyProvider({ ...awsKmsConfigFromEnv(process.env), keyArn: keyArn! });
  const context = { spaceId: "org-key-check", version: 0 };
  const probe = Buffer.alloc(32, 7);
  const wrapped = await kms.wrap(probe, context);
  if (!Buffer.from(await kms.unwrap(wrapped, context)).equals(probe))
    throw new Error("The key did not round-trip");
  await setOrganizationKey(prisma, organizationId!, keyArn!);
  write(
    `${organizationId}: space keys are wrapped by ${keyArn}; run rotate to move the existing ones`,
  );
}

async function upgradeCredentials() {
  const counts = await upgradeLegacySecrets(
    createSecretMigrationRepository(prisma),
    new EncryptedSecretStore(resolveEncryptionKey(process.env)),
    {
      operationId: "content-encryption",
      traceId: "content-encryption",
      userId: "migration",
      spaceId: "migration",
      signal: controller.signal,
    },
    { dryRun, report: (row, status) => write(`credential ${row.label} ${row.id}: ${status}`) },
  );
  write(
    `credentials: ${counts.migrated} upgraded, ${counts.planned} planned, ${counts.verified} current, ${counts.concurrent} changed concurrently, ${counts.failed} failed`,
  );
  if (counts.failed) process.exitCode = 1;
}

async function moveMcpArgs() {
  const secrets = createSecretStore(resolveEncryptionKey(process.env));
  await secrets.start();
  try {
    const counts = await moveMcpArgsIntoSecrets(withSecretPersistence(prisma, secrets), secrets, {
      dryRun,
      signal: controller.signal,
    });
    write(
      `mcp server arguments: ${counts.moved} encrypted, ${counts.planned} planned, ${counts.concurrent} changed concurrently, ${counts.failed} failed`,
    );
    if (counts.failed) process.exitCode = 1;
  } finally {
    await secrets.close();
  }
}

// Reads or rewrites every tenant's content, so it runs across Spaces.
try {
  await runAsSystem("content encryption maintenance", async () => {
    if (command === "status") {
      const status = await contentEncryptionStatus(prisma);
      for (const table of status.tables)
        write(`${table.table}: ${table.plaintext} of ${table.rows} in plaintext`);
      for (const [masterKeyId, count] of Object.entries(status.masterKeys))
        write(`space keys under master key ${masterKeyId}: ${count}`);
      write(`active master key: ${contentKeys.provider.activeKeyId()}`);
      const files = await artifacts.fileCounts();
      write(
        files.present
          ? `artifacts: ${files.plaintext} of ${files.plaintext + files.sealed} in plaintext${
              files.abandoned
                ? `, ${files.abandoned} temporary files from an interrupted run (migrate removes them)`
                : ""
            }`
          : "artifacts: no artifact directory under DATA_DIR; run where the data volume is mounted",
      );
    } else if (command === "migrate") {
      if (!resolveContentEncryption(process.env))
        write("CONTENT_ENCRYPTION is off: new content is still stored in plaintext");
      await rewriteContent("encrypt");
      await upgradeCredentials();
      await moveMcpArgs();
    } else if (command === "rotate") {
      const keys = await rewrapSpaceKeys(prisma, contentKeys, {
        dryRun,
        signal: controller.signal,
      });
      write(`space keys: ${keys.rewrapped} re-wrapped, ${keys.current} already current`);
      if (flags.reencrypt && !dryRun) {
        write(
          `data keys: ${await rotateSpaceDataKeys(prisma, contentKeys, { signal: controller.signal })} spaces rotated`,
        );
        await rewriteContent("reencrypt");
      }
    } else if (command === "reencrypt") {
      await rewriteContent("reencrypt");
    } else if (command === "export") {
      await exportJsonLines();
    } else if (command === "org-key") {
      await orgKey();
    } else {
      await rewriteContent("decrypt");
    }
  });
} catch (error) {
  process.stderr.write(
    `content-encryption ${command} failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
}
