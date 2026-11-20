import type { ParsedBotAvatar } from "@anviq/contracts";
import { parseBotAvatarValue } from "@anviq/contracts";
import { resolvePersonaColorDef, shippedBotAvatarShapePath } from "@anviq/core";

export type MobileBotAvatarPresentation =
  | Exclude<ParsedBotAvatar, { kind: "shape" }>
  | { kind: "shape"; color: string; shapeIndex: number; shapePath: string };

/** Resolve a stored `bots.color` value for native rendering, including shape paths. */
export function mobileBotAvatarPresentation(color: string): MobileBotAvatarPresentation {
  const parsed = parseBotAvatarValue(color);
  if (parsed.kind === "color") {
    // A color saved as its earlier, deeper value draws as the color's current one.
    return {
      ...parsed,
      color: resolvePersonaColorDef("preview", parsed.color).hex,
    };
  }
  if (parsed.kind !== "shape") return parsed;
  const colorDef = resolvePersonaColorDef("preview", parsed.color);
  return {
    ...parsed,
    color: colorDef.hex,
    shapePath: shippedBotAvatarShapePath(parsed.shapeIndex),
  };
}
