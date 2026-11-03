/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@anviq/adapter-kit";
import { displayName } from "@anviq/core";
import { lightTokens } from "@anviq/ui-tokens";
import { Hr, Link, Text } from "react-email";
import { linkStyle, message } from "./email.js";

export function welcomeEmail(
  user: { email: string; name: string },
  unsubscribeUrl: string,
): Promise<TransactionalEmail> {
  return message(
    user.email,
    "Welcome to Sekundo",
    <>
      <Text>Hi {displayName(user.name, "there")},</Text>
      <Text>Thanks for signing up for Sekundo.</Text>
      <Text>Have any questions? Reply to this email.</Text>
      <Text>The Sekundo team</Text>
      <Hr style={{ borderColor: lightTokens.border, marginTop: "32px" }} />
      <Text style={{ color: lightTokens.mutedForeground, fontSize: "12px" }}>
        <Link href={unsubscribeUrl} style={{ color: lightTokens.mutedForeground }}>
          Unsubscribe
        </Link>
      </Text>
    </>,
    {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  );
}
