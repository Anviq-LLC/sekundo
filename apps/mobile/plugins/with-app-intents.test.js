import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const mobile = join(import.meta.dirname, "..");
const read = (file) => readFileSync(join(mobile, file), "utf8");
const constant = (file, name) => read(file).match(new RegExp(`${name} = "([^"]+)"`))?.[1];

describe("AnviqIntents", () => {
  // The intents read what the app saved; renaming a key on one side would break them silently.
  it("reads the secure-store keys the app writes", () => {
    const swift = read("ios-intents/AnviqIntents.swift");
    for (const [file, name] of [
      ["lib/api/session.ts", "SESSION_KEY"],
      ["lib/api/server-config.ts", "API_BASE_STORAGE_KEY"],
      ["lib/api/api.ts", "SPACE_KEY"],
      ["lib/inbox/last-bot.ts", "LAST_BOT_KEY"],
      ["lib/api/server-headers.ts", "SERVER_HEADERS_KEY"],
    ]) {
      const key = constant(file, name);
      expect(key, `${name} in ${file}`).toBeTruthy();
      expect(swift).toContain(`secureStoreItem("${key}")`);
    }
  });

  it("hands a voice chat to the module that reads it", () => {
    const swift = read("ios-intents/AnviqIntents.swift");
    const module = read("modules/anviq-voice-chat/ios/AnviqVoiceChatModule.swift");
    expect(swift).toContain('"anviq.pending_voice_chat"');
    expect(module).toContain('"anviq.pending_voice_chat"');
    for (const source of [swift, module]) {
      expect(source).toContain('Notification.Name("AnviqPendingVoiceChat")');
    }
  });

  it("falls back to the app's own default server", () => {
    const local = constant("lib/api/server-config.ts", "LOCAL_API");
    expect(read("plugins/with-app-intents.js")).toContain(`"${local}"`);
  });
});

describe("withAppIntents prebuild", () => {
  it("refreshes the sources without duplicating their build references", () => {
    const files = new Set();
    const copied = [];
    const added = [];
    const widgetSettings = { PRODUCT_NAME: '"AnviqWidgets"' };
    const config = {
      version: "2.0.0",
      ios: { bundleIdentifier: "com.example.app", buildNumber: "7" },
      modRequest: { projectRoot: "/project", platformProjectRoot: "/project/ios" },
      modResults: {
        hasFile: (file) => files.has(file),
        pbxTargetByName: (name) => (name === "AnviqWidgets" ? {} : undefined),
        pbxNativeTargetSection: () => ({
          "app-target": { name: "Sekundo" },
          "app-target_comment": "Sekundo",
          "widget-target": { name: '"AnviqWidgets"' },
        }),
        pbxXCBuildConfigurationSection: () => ({ widget: { buildSettings: widgetSettings } }),
      },
    };
    const plist = { modResults: { UIBackgroundModes: ["audio"] } };
    const module = { exports: {} };
    runInNewContext(read("plugins/with-app-intents.js"), {
      module,
      __dirname: join(mobile, "plugins"),
      process: { env: { EXPO_PUBLIC_API_URL: "https://api.example.test" } },
      require: (name) => {
        if (name === "node:fs")
          return {
            copyFileSync: (...args) => copied.push(args),
            cpSync: (...args) => copied.push(args.slice(0, 2)),
          };
        if (name === "node:path") return { join };
        if (name === "./pbx-group") return createRequire(import.meta.url)("./pbx-group.js");
        if (name === "expo/config-plugins")
          return {
            withInfoPlist: (value, mod) => {
              mod(plist);
              return value;
            },
            withXcodeProject: (value, mod) => mod(value),
            IOSConfig: {
              XcodeUtils: {
                getProjectName: () => "Sekundo",
                addBuildSourceFileToGroup: (input) => {
                  // Like the real helper, a file already in its group is skipped.
                  const key = `${input.groupName}/${input.filepath}`;
                  if (!files.has(key)) added.push(input);
                  files.add(key);
                  files.add(input.filepath);
                },
              },
            },
          };
        throw new Error(`Unexpected module: ${name}`);
      },
    });
    module.exports(config);
    module.exports(config);
    expect(plist.modResults.AnviqDefaultApiBase).toBe("https://api.example.test");
    expect(plist.modResults.UIBackgroundModes).toEqual(["audio"]);
    expect(copied).toContainEqual([
      join(mobile, "ios-intents/AnviqIntents.swift"),
      "/project/ios/Sekundo/AnviqIntents.swift",
    ]);
    expect(added.map((input) => input.filepath)).toEqual([
      "Sekundo/AnviqIntents.swift",
      "Sekundo/VoiceMessageRecorder.swift",
      "Sekundo/VoiceMessageActivity.swift",
      "AnviqWidgets.swift",
      "WorkLiveActivity.swift",
      "VoiceMessageActivity.swift",
      "WorkActivityAttributes.swift",
    ]);
    // An existing widget target still gets every source, in its own group and build phase.
    expect(added.slice(3).every((input) => input.targetUuid === "widget-target")).toBe(true);
    expect(added.slice(3).every((input) => input.groupName === "AnviqWidgets")).toBe(true);
    expect(widgetSettings).toMatchObject({
      CURRENT_PROJECT_VERSION: "7",
      MARKETING_VERSION: "2.0.0",
    });
  });
});

describe("voice message Live Activity", () => {
  // EAS signs only the extensions app.json lists, under the bundle id the plugin gives them.
  it("lists the widget extension for EAS signing", () => {
    const app = JSON.parse(read("app.json")).expo;
    const extension = app.extra.eas.build.experimental.ios.appExtensions.find(
      ({ targetName }) => targetName === "AnviqWidgets",
    );
    expect(read("plugins/with-app-intents.js")).toContain(`"${extension.targetName}"`);
    expect(extension.bundleIdentifier).toBe(`${app.ios.bundleIdentifier}.widgets`);
  });
});
