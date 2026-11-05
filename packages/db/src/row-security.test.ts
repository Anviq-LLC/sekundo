import { describe, expect, it } from "vitest";
import { rlsBypassKey } from "./row-security.js";

describe("rlsBypassKey", () => {
  it("follows the password pg logs in with", () => {
    const key = rlsBypassKey("postgres://app:secret@db/anviq");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(rlsBypassKey("postgres://app@db/anviq?password=secret")).toBe(key);
    expect(rlsBypassKey("postgres://app:other@db/anviq?password=secret")).toBe(key);
    expect(rlsBypassKey("postgres://app:secret@db/anviq?password=")).toBe(key);
    expect(rlsBypassKey("postgres://app:s%cret@db/anviq")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is empty without a password", () => {
    expect(rlsBypassKey("postgres://app@db/anviq")).toBe("");
    expect(rlsBypassKey("not a url")).toBe("");
  });
});
