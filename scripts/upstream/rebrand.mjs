// Copyright 2026 Anviq LLC. All rights reserved.
// Applies the Anviq rename to a checkout of upstream rakazo.
// Usage: node rebrand.mjs <worktree-dir>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: node rebrand.mjs <worktree-dir>");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.name !== "rakazo") {
  throw new Error(
    `refusing to run: ${root} is not an upstream checkout (package name "${pkg.name}")`,
  );
}

const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 1 << 28 }).toString("utf8");

const SKIP_CONTENT = new Set(["CHANGELOG.md", "LICENSE"]);
const DROP = [
  "apps/www",
  "README.md",
  "README.ja.md",
  "README.zh-CN.md",
  "CONTRIBUTING.md",
  "VISION.md",
  "CHANGELOG.md",
  ".coderabbit.yaml",
  ".github/ISSUE_TEMPLATE",
];

const rules = [
  [/\b[\w.-]+@rakazo\.com\b/gi, "lvoss@anviq.net"],
  [/rakazo\.com/gi, "anviq.net"],
  [/ghcr\.io\/elie222\/rakazo/g, "ghcr.io/anviq-llc/anviq-agents"],
  [
    /(e)lie222(\\?\/)rakazo/gi,
    (_m, e, s) => (e === "E" ? `Leovoss${s}Anviq-agents` : `leovoss${s}anviq-agents`),
  ],
  [/\bowner elie222 repo rakazo\b/g, "owner leovoss repo anviq-agents"],
  [/((?:owner|"owner")\s*:\s*"?)elie222/g, "$1leovoss"],
  [/((?:repo|"repo")\s*:\s*"?)rakazo\b/g, "$1anviq-agents"],
  [/\belie222\b/g, "leovoss"],
  [/the inbox-zero\/rakazo Expo project/g, "the Expo project that owns the app"],
  // Upstream's Expo account, project id and OTA update channel must not ship in our builds.
  [/^\s*"owner": "inbox-zero",\n/m, ""],
  [/,\n\s*"eas": \{\n\s*"projectId": "[0-9a-f-]{36}"\n\s*\}/, ""],
  [/,\n\s*"updates": \{\n\s*"url": "https:\/\/u\.expo\.dev\/[0-9a-f-]{36}"\n\s*\}/, ""],
  // apps/www is dropped, so the Dockerfile must not copy its manifest.
  [/^COPY --chmod=755 apps\/www\/package\.json apps\/www\/\n/m, ""],
  // Packaging tools build file and bundle names from productName, so it stays a single word.
  [/("productName"\s*:\s*)"Rakazo"/g, '$1"Anviq"'],
  [/(productName\)\.toBe\()"Rakazo"/g, '$1"Anviq"'],
  // Bare object keys in locale catalogs are the source string, so they need quoting.
  [/^(\s*)Rakazo(?=:)/gm, '$1"Anviq Agents"'],
  // The product name shown to people. Identifiers, paths and package names keep the short form.
  [/(?<![\w@./\\:-])Rakazo['’]s\b/g, "Anviq Agents'"],
  [/(?<![\w@./\\:-])Rakazo(?![\w/\\-]|\.[A-Za-z])/g, "Anviq Agents"],
  [/Rakazo/g, "Anviq"],
  [/RAKAZO/g, "ANVIQ"],
  [/rakazo/g, "anviq"],
];

const rewritePath = (p) => p.replace(/Rakazo/g, "Anviq").replace(/rakazo/g, "anviq");

const files = git("ls-files", "-z").split("\0").filter(Boolean);

let edited = 0;
const moves = [];
for (const file of files) {
  if (DROP.some((d) => file === d || file.startsWith(`${d}/`))) {
    rmSync(join(root, file), { force: true });
    continue;
  }
  const abs = join(root, file);
  if (!SKIP_CONTENT.has(file) && existsSync(abs)) {
    const buf = readFileSync(abs);
    if (!buf.subarray(0, 8000).includes(0)) {
      const before = buf.toString("utf8");
      let after = before;
      for (const [re, to] of rules) after = after.replace(re, to);
      if (after !== before) {
        writeFileSync(abs, after);
        edited++;
      }
    }
  }
  const next = rewritePath(file);
  if (next !== file) moves.push([file, next]);
}

for (const [from, to] of moves) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  git("mv", "-f", "--", from, to);
}

git("add", "-A");
let leftovers = "";
try {
  leftovers = git(
    "grep",
    "-nIiE",
    "rakazo|elie222|getinboxzero|Inbox Zero Inc|inbox-zero|u\\.expo\\.dev",
    "--",
    ".",
    ":!CHANGELOG.md",
    ":!LICENSE",
  ).trim();
} catch (error) {
  if (error.status !== 1) throw error;
}
console.log(`rebrand: ${edited} files edited, ${moves.length} paths moved`);
if (leftovers) {
  console.error(`rebrand: unhandled upstream names remain:\n${leftovers}`);
  process.exit(1);
}
