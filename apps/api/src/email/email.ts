import type { TransactionalEmailProvider } from "@anviq/adapter-kit";
import { configuredEmailProvider as providerFor } from "@anviq/adapters";
import type { AppEnv } from "../env.js";

export function configuredEmailProvider(
  env: Pick<AppEnv, "emailProvider" | "emailApiKey" | "emailFrom" | "emailReplyTo" | "smtpUrl">,
): TransactionalEmailProvider | undefined {
  return providerFor({
    provider: env.emailProvider,
    apiKey: env.emailApiKey,
    from: env.emailFrom,
    replyTo: env.emailReplyTo,
    smtpUrl: env.smtpUrl,
  });
}
