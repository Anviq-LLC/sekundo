/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@anviq/adapter-kit";
import { displayName } from "@anviq/core";
import { lightTokens } from "@anviq/ui-tokens";
import type { ReactNode } from "react";
import { Body, Container, Head, Html, Link, render, Text, toPlainText } from "react-email";

export async function message(
  to: string,
  subject: string,
  content: ReactNode,
  headers?: Record<string, string>,
): Promise<TransactionalEmail> {
  const html = await render(
    <Html lang="en">
      <Head />
      <Body
        style={{
          backgroundColor: lightTokens.dialog,
          color: lightTokens.foreground,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "480px", padding: "24px" }}>{content}</Container>
      </Body>
    </Html>,
  );
  return { to, subject, html, text: toPlainText(html), ...(headers ? { headers } : {}) };
}

export const linkStyle = { color: lightTokens.primary, textDecoration: "underline" };

export function verificationEmail(email: string, url: string): Promise<TransactionalEmail> {
  return message(
    email,
    "Verify your Sekundo email",
    <>
      <Text>
        <Link href={url} style={linkStyle}>
          Verify email
        </Link>
      </Text>
      <Text>Then return to Sekundo to sign in.</Text>
      <Text>This link expires in one hour. If you did not register, ignore this email.</Text>
    </>,
  );
}

export function signInCodeEmail(email: string, code: string): Promise<TransactionalEmail> {
  return message(
    email,
    "Your Sekundo sign-in code",
    <>
      <Text>Enter this code to sign in to Sekundo:</Text>
      <Text>
        <strong>{code}</strong>
      </Text>
      <Text>This code expires in ten minutes. If you did not request it, ignore this email.</Text>
    </>,
  );
}

export function passwordResetEmail(
  user: { id: string; email: string; name: string },
  resetUrl: string,
): Promise<TransactionalEmail> {
  return message(
    user.email,
    "Reset your Sekundo password",
    <>
      <Text>Hi {displayName(user.name, "there")},</Text>
      <Text>Reset your Sekundo password:</Text>
      <Text>
        <Link href={resetUrl} style={linkStyle}>
          Reset password
        </Link>
      </Text>
      <Text>
        This link expires in one hour. If you did not request this, you can ignore this email.
      </Text>
    </>,
  );
}

export function teamInvitationEmail(
  email: string,
  invitation: { organizationName: string; inviterName: string; url: string },
): Promise<TransactionalEmail> {
  const team = displayName(invitation.organizationName, "a team");
  return message(
    email,
    `Join ${team} on Sekundo`,
    <>
      <Text>
        {displayName(invitation.inviterName, "A teammate")} invited you to join {team} on Sekundo
        Agents.
      </Text>
      <Text>
        <Link href={invitation.url} style={linkStyle}>
          Accept the invitation
        </Link>
      </Text>
      <Text>Sign in with this email address to accept. The invitation expires in seven days.</Text>
    </>,
  );
}

export function accountDeletionEmail(email: string, code: string): Promise<TransactionalEmail> {
  return message(
    email,
    "Confirm Sekundo account deletion",
    <>
      <Text>Enter this code in Sekundo to delete your account:</Text>
      <Text>{code}</Text>
      <Text>
        This code expires in ten minutes. If you did not request deletion, ignore this email.
      </Text>
    </>,
  );
}

export function identityCodeEmail(email: string, code: string): Promise<TransactionalEmail> {
  return message(
    email,
    "Your Sekundo confirmation code",
    <>
      <Text>Enter this code in Sekundo to confirm it's you:</Text>
      <Text>
        <strong>{code}</strong>
      </Text>
      <Text>This code expires in ten minutes. If you did not request it, ignore this email.</Text>
    </>,
  );
}
