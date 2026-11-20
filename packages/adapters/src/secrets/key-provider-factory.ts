import type { KeyProvider } from "@anviq/adapter-kit";
import type { DbClientOptions } from "@anviq/db";
import {
  LocalKeyProvider,
  lazyKeyProvider,
  masterKeysFromEnv,
  PgOrgKeyLookup,
  withLocalMasterKeys,
} from "@anviq/db";
import { OrgKeyProvider } from "../org-key-provider.js";
import {
  AwsKmsKeyProvider,
  awsKmsConfigFromEnv,
} from "../providers/key/aws-kms/aws-kms-key-provider.js";
import { isWrappedEnvValue, unwrapEnv } from "./wrapped-env.js";

type KeyProviderOption = NonNullable<DbClientOptions["keyProvider"]>;

/** Settings that build the key provider, which must be readable before anything unwraps. */
export const KEY_PROVIDER_SETTINGS = [
  "MASTER_KEY_PROVIDER",
  "AWS_KMS_KEY_ARN",
  "AWS_KMS_ACCESS_KEY_ID",
  "AWS_KMS_SECRET_ACCESS_KEY",
  "AWS_KMS_PROFILE",
];

/** The external key manager alone, without the local master keys. */
export function keyManagerFromEnv(env: NodeJS.ProcessEnv = process.env): KeyProvider | undefined {
  const provider = env.MASTER_KEY_PROVIDER?.trim() || "local";
  if (provider === "local") return undefined;
  if (provider !== "aws-kms") throw new Error("Unsupported MASTER_KEY_PROVIDER");
  return new AwsKmsKeyProvider(awsKmsConfigFromEnv(env));
}

/**
 * `MASTER_KEY_PROVIDER` picks who wraps space keys. Undefined keeps createDb's default,
 * the local master keys. A key manager wraps new keys while local ones keep unwrapping.
 *
 * With AWS credentials set, an organization can also bring its own KMS key (see
 * `content-encryption org-key`): its space keys are wrapped by that key, and every other
 * space by the provider above.
 */
export function contentKeyProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeyProviderOption | undefined {
  const local = () => new LocalKeyProvider(masterKeysFromEnv(env));
  // Configuration errors surface at startup; local master keys are read on first use.
  const external = keyManagerFromEnv(env);
  const base: KeyProvider | undefined =
    external && lazyKeyProvider(() => withLocalMasterKeys(external, local()));
  const accessKeyId = env.AWS_KMS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_KMS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return base;
  return (keyPool) =>
    new OrgKeyProvider(
      base ?? lazyKeyProvider(local),
      new PgOrgKeyLookup(keyPool),
      (keyArn) => new AwsKmsKeyProvider({ keyArn, accessKeyId, secretAccessKey }),
    );
}

/**
 * Unwraps `wrapped:v1:` values with the configured key manager. Every server process
 * awaits this right after loading `.env`, before reading any setting.
 */
export async function unwrapEnvFromKeyManager(env: NodeJS.ProcessEnv = process.env) {
  const bootstrap = KEY_PROVIDER_SETTINGS.filter((name) => isWrappedEnvValue(env[name]));
  if (bootstrap.length)
    throw new Error(`Key manager settings cannot be wrapped: ${bootstrap.join(", ")}`);
  await unwrapEnv(env, keyManagerFromEnv(env));
}
