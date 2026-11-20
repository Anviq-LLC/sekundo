import { scryptSync } from "node:crypto";
import { MCP_SIGNIN_WINDOW_PREFIX } from "@anviq/contracts";

const OAUTH_POPUP_NAMES = new Set([
  "anviq-app-connect",
  "anviq-mcp-oauth",
  "anviq-sso-oauth",
  "anviq-model-oauth",
  "anviq-plugin-connect",
]);

/** A server id from a per-server MCP sign-in window name; null otherwise. */
export function mcpOAuthPopupServerId(frameName: string): string | null {
  if (!frameName.startsWith(MCP_SIGNIN_WINDOW_PREFIX)) return null;
  const serverId = frameName.slice(MCP_SIGNIN_WINDOW_PREFIX.length);
  return isMcpOAuthServerId(serverId) ? serverId : null;
}

export function isMcpOAuthServerId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

/** One persistent cookie jar per connected instance and server. */
export function mcpOAuthPartition(appUrl: string, serverId: string) {
  const digest = scryptSync(
    JSON.stringify([new URL(appUrl).origin, serverId]),
    "anviq-mcp-partition",
    12,
    { N: 1024, r: 8, p: 1 },
  ).toString("hex");
  return `persist:anviq-mcp-${digest}`;
}

export function shouldOpenInAppPopup(
  appOrigin: string | null,
  childUrl: string,
  frameName: string,
) {
  let target: URL;
  try {
    target = new URL(childUrl);
  } catch {
    return false;
  }

  if (childUrl === "about:blank" && frameName === "anviq-sso-oauth") return true;

  const isHttp = target.protocol === "http:" || target.protocol === "https:";
  if (appOrigin !== null && target.origin === appOrigin) return isHttp;
  return (
    target.protocol === "https:" &&
    (OAUTH_POPUP_NAMES.has(frameName) ||
      (frameName.startsWith("anviq-mcp-oauth:") && frameName.length > "anviq-mcp-oauth:".length) ||
      mcpOAuthPopupServerId(frameName) !== null)
  );
}

/** Keep auth cookies in the parent app's server-specific session. */
export function oauthPopupSessionPreferences(partition: string | null) {
  return {
    preload: "",
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    ...(partition === null ? {} : { partition }),
  };
}
