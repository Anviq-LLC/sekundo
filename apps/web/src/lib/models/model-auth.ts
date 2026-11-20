import { waitForModelOAuthCompletion } from "@anviq/core";
import type { RpcClient } from "../query/rpc";
import { rpc } from "../query/rpc";

export type { ModelCatalogEntry, ModelCredential, ModelOAuthBegin } from "@anviq/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@anviq/core";

/** `client` must be the one that began the sign-in: the login belongs to its space. */
export async function waitForModelOAuth(
  loginId: string,
  signal?: AbortSignal,
  client: RpcClient = rpc,
) {
  return waitForModelOAuthCompletion(() => client.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
