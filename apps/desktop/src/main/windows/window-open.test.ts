import { describe, expect, it } from "vitest";
import {
  mcpOAuthPartition,
  mcpOAuthPopupServerId,
  oauthPopupSessionPreferences,
  shouldOpenInAppPopup,
} from "./window-open.js";

const appOrigin = "https://anviq.example.com";

describe("desktop child windows", () => {
  it("keeps same-origin app routes in Electron", () => {
    expect(shouldOpenInAppPopup(appOrigin, `${appOrigin}/mcp/oauth/callback`, "_blank")).toBe(true);
  });

  it("opens ordinary external links outside Electron", () => {
    expect(
      shouldOpenInAppPopup(appOrigin, "https://github.com/anviq-llc/sekundo/pull/395", "_blank"),
    ).toBe(false);
  });

  it.each([
    "anviq-model-oauth",
    "anviq-mcp-oauth",
    "anviq-mcp-oauth:session",
    "anviq-sso-oauth",
    "anviq-app-connect",
    "anviq-plugin-connect",
  ])("keeps the intentional %s flow in an Electron popup", (frameName) => {
    expect(
      shouldOpenInAppPopup(appOrigin, "https://provider.example.com/authorize", frameName),
    ).toBe(true);
  });

  it("rejects malformed URLs and non-HTTPS third-party targets", () => {
    expect(shouldOpenInAppPopup(appOrigin, "not a url", "anviq-model-oauth")).toBe(false);
    expect(
      shouldOpenInAppPopup(appOrigin, "http://provider.example.com", "anviq-model-oauth"),
    ).toBe(false);
  });
});

it("keeps a server-named MCP sign-in window in an Electron popup", () => {
  const authorize = "https://provider.example.com/authorize";
  expect(shouldOpenInAppPopup(appOrigin, authorize, "anviq-mcp-signin:cabc")).toBe(true);
  expect(shouldOpenInAppPopup(appOrigin, authorize, "anviq-mcp-signin:")).toBe(false);
  expect(shouldOpenInAppPopup(appOrigin, authorize, "anviq-mcp-signin:../other")).toBe(false);
});

describe("MCP sign-in browsers", () => {
  it("reads the server from the window name", () => {
    expect(mcpOAuthPopupServerId("anviq-mcp-signin:clx123abc")).toBe("clx123abc");
    expect(mcpOAuthPopupServerId("anviq-mcp-signin:")).toBeNull();
    expect(mcpOAuthPopupServerId("anviq-mcp-signin:a/b")).toBeNull();
    // Session-named windows sign in through the app's own session.
    expect(mcpOAuthPopupServerId("anviq-mcp-oauth:session-1")).toBeNull();
    expect(mcpOAuthPopupServerId("_blank")).toBeNull();
  });

  it("gives every server a persistent, opaque jar of its own", () => {
    const first = mcpOAuthPartition("https://first.example.test", "clx123abc");
    expect(first).toMatch(/^persist:anviq-mcp-[0-9a-f]{24}$/);
    expect(mcpOAuthPartition("https://first.example.test", "clx123abc")).toBe(first);
    expect(mcpOAuthPartition("https://first.example.test", "clx999xyz")).not.toBe(first);
    expect(mcpOAuthPartition("https://second.example.test", "clx123abc")).not.toBe(first);
    expect(mcpOAuthPartition("https://first.example.test:8443", "clx123abc")).not.toBe(first);
    expect(mcpOAuthPartition("https://first.example.test/settings", "clx123abc")).toBe(first);
    expect(first).not.toContain("clx123abc");
  });
});

it("keeps SSO popups sandboxed in the parent session without a privileged preload", () => {
  expect(oauthPopupSessionPreferences("persist:test-server")).toEqual({
    partition: "persist:test-server",
    preload: "",
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  expect(oauthPopupSessionPreferences(null)).not.toHaveProperty("partition");
  expect(shouldOpenInAppPopup(appOrigin, "http://provider.example.com", "anviq-sso-oauth")).toBe(
    false,
  );
});

it("allows only the named SSO blank popup before provider navigation", () => {
  expect(shouldOpenInAppPopup(appOrigin, "about:blank", "anviq-sso-oauth")).toBe(true);
  for (const name of ["_blank", "anviq-mcp-oauth", ""])
    expect(shouldOpenInAppPopup(appOrigin, "about:blank", name)).toBe(false);
  expect(shouldOpenInAppPopup(appOrigin, "about:blank#unsafe", "anviq-sso-oauth")).toBe(false);
});

it("keeps session-named MCP popups restricted to HTTPS", () => {
  expect(
    shouldOpenInAppPopup(appOrigin, "http://provider.example.com", "anviq-mcp-oauth:session"),
  ).toBe(false);
  expect(shouldOpenInAppPopup(appOrigin, "https://provider.example.com", "anviq-mcp-oauth:")).toBe(
    false,
  );
});
