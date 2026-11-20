import type { RealtimeFanout, SecretStore } from "@anviq/adapter-kit";
import { createSecretStore } from "@anviq/adapters";
import { resolveEncryptionKey } from "@anviq/core/node/secrets-guard";

/** Worker composition without starting job hosts or database connections. */
export async function createWorkerSecretStore(
  source: NodeJS.ProcessEnv,
  realtime?: RealtimeFanout,
): Promise<SecretStore> {
  const store = createSecretStore(resolveEncryptionKey(source), source, realtime);
  await store.start();
  return store;
}
