import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UI_LOCALES } from "../i18n/ui-locale";

const resources = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "modules/anviq-notifications/android/src/main/res",
);
const keys = [
  "anviq_channel_live",
  "anviq_channel_messages",
  "anviq_channel_scheduled",
  "anviq_channel_attention",
  "anviq_live_one",
  "anviq_live_many",
  "anviq_live_working",
  "anviq_scheduled_title",
  "anviq_replied_group",
  "anviq_replied",
  "anviq_attention_failed",
  "anviq_attention_takeover",
  "anviq_attention_input",
];

const resourceDirectories = {
  en: "values",
  "zh-CN": "values-zh-rCN",
  "zh-TW": "values-zh-rTW",
  ru: "values-ru",
  de: "values-de",
  nl: "values-nl",
  ja: "values-ja",
  es: "values-es",
  pl: "values-pl",
  fr: "values-fr",
  he: "values-iw",
  hi: "values-hi",
  ko: "values-ko",
  "pt-BR": "values-pt-rBR",
  tr: "values-tr",
} as const satisfies Record<(typeof UI_LOCALES)[number], string>;

function strings(locale: (typeof UI_LOCALES)[number]) {
  return readFileSync(resolve(resources, resourceDirectories[locale], "strings.xml"), "utf8");
}

describe("Android notification resources", () => {
  it("provides every notification string in each shipped mobile locale", () => {
    for (const locale of UI_LOCALES) {
      const xml = strings(locale);
      for (const key of keys) expect(xml).toContain(`name="${key}"`);
    }
  });

  it("preserves every Polish notification format argument", () => {
    const entries = (xml: string) =>
      new Map(
        [...xml.matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g)].map((match) => [
          match[1],
          match[2],
        ]),
      );
    const source = entries(strings("en"));
    const polish = entries(strings("pl"));
    for (const key of keys) {
      const argumentsOf = (value: string) => value.match(/%\d+\$[sd]/g)?.sort() ?? [];
      expect(argumentsOf(polish.get(key) ?? ""), key).toEqual(argumentsOf(source.get(key) ?? ""));
    }
  });

  it("keeps positional format arguments in translated strings", () => {
    expect(strings("de")).toContain("%1$s und %2$d");
    expect(strings("ru")).toContain("%1$s и ещё %2$d");
    expect(strings("zh-CN")).toContain("%1$s 和另外 %2$d");
    expect(strings("nl")).toContain("%1$s en %2$d anderen");
    expect(strings("ja")).toContain("%1$sとほか%2$d件");
    expect(strings("es")).toContain("%1$s y %2$d más");
    expect(strings("pl")).toContain("%1$s i jeszcze %2$d");
  });
});
