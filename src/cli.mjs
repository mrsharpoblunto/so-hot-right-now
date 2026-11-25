import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { compareWithBaseline, countProblems } from "./baseline.mjs";
import { checkHotPaths } from "./checker.mjs";
import { CONFIG_FILES, createProgram, findConfig, loadConfig, readBaseline } from "./config.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "so-hot-right-now";

const USAGE = `Usage: ${NAME} <command> [options]

Commands:
  check              Check the hot paths against the baseline. This is the default command.
  report [text]      Show each problem whose path contains the text, with its call chain.
  baseline           Write the current problem counts to the baseline file.
  init               Write a starter ${CONFIG_FILES[0]} in the current folder.
  skills             Copy the agent skills for Claude Code and Codex into the project.

Options:
  --config <path>    Use this config file. The default is the nearest ${CONFIG_FILES[0]}.
  --format <format>  Write "text" or "json". The default is "text".
  --target <target>  For "skills": "all" (the default), "claude" (.claude/skills),
                     "codex" (.agents/skills), or a folder.
  --global           For "skills": copy into the user folders (~/.claude/skills, ~/.agents/skills).
  --help             Show this help.
`;

const STARTER_CONFIG = `import { defineConfig, presets } from "${NAME}";

export default defineConfig({
  tsconfig: "tsconfig.json",
  baseline: "hot-path-baseline.json",
  // Every function in these files is a root, and the baseline accepts no problems in them.
  strict: [],
  plugins: [presets.browser, presets.react],
  // Add the entry points that your engine calls on each frame or tick.
  // A \`/** @hot <caller> */\` tag on a function also makes it a root.
  roots: [
    // { kind: "method", owner: { implements: "System" }, methods: ["update"], label: "simulation" },
    // { kind: "argument", callee: "useFrame", index: 0, label: "frame" },
  ],
});
`;

async function load(values) {
  const configPath = values.config ? path.resolve(values.config) : findConfig(process.cwd());
  if (!configPath)
    throw new Error(`Found no ${CONFIG_FILES[0]}. Run \`${NAME} init\` to write one.`);
  const loaded = await loadConfig(configPath);
  const problems = checkHotPaths(createProgram(loaded.tsconfig), loaded.options);
  return { loaded, problems };
}

function relativeTo(loaded, problem) {
  return path.relative(process.cwd(), path.join(loaded.root, problem.file));
}

async function check(values) {
  const { loaded, problems } = await load(values);
  const { grown, stale } = compareWithBaseline(problems, readBaseline(loaded.baseline));
  if (values.format === "json") {
    const newProblems = problems.filter((problem) =>
      grown.some((group) => group.file === problem.file && group.messageId === problem.messageId),
    );
    console.log(JSON.stringify({ problems: newProblems, grown, stale }, null, 2));
  } else {
    for (const group of grown) {
      const members = problems.filter(
        (problem) => problem.file === group.file && problem.messageId === group.messageId,
      );
      console.error(
        `${group.file}: ${group.count} "${group.messageId}" problem(s), ${group.allowed} allowed. ${members[0].message}`,
      );
      for (const problem of members)
        console.error(
          `  ${relativeTo(loaded, problem)}:${problem.line}:${problem.column} (hot via ${problem.chain})`,
        );
    }
    for (const group of stale)
      console.error(
        `${group.file}: ${group.count} "${group.messageId}" problem(s), but the baseline allows ${group.allowed}. Run \`${NAME} baseline\`.`,
      );
  }
  return grown.length + stale.length > 0 ? 1 : 0;
}

async function report(values, filter) {
  const { loaded, problems } = await load(values);
  const shown = problems.filter((problem) => problem.file.includes(filter));
  if (values.format === "json") console.log(JSON.stringify(shown, null, 2));
  else {
    for (const problem of shown)
      console.log(
        `${relativeTo(loaded, problem)}:${problem.line}:${problem.column} ${problem.messageId} ${problem.message} (hot via ${problem.chain})`,
      );
    console.log(`${shown.length} of ${problems.length} hot path problem(s).`);
  }
  return 0;
}

async function writeBaseline(values) {
  const { loaded, problems } = await load(values);
  writeFileSync(loaded.baseline, `${JSON.stringify(countProblems(problems), null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), loaded.baseline)}.`);
  return 0;
}

function init() {
  const target = path.resolve(CONFIG_FILES[0]);
  if (existsSync(target)) throw new Error(`${CONFIG_FILES[0]} exists. Edit it instead.`);
  writeFileSync(target, STARTER_CONFIG);
  console.log(`Wrote ${CONFIG_FILES[0]}. Add your roots, then run \`${NAME} baseline\`.`);
  return 0;
}

// Claude Code reads `.claude/skills`. Codex and other Agent Skills tools read `.agents/skills`.
const SKILL_FOLDERS = { claude: ".claude/skills", codex: ".agents/skills" };

function skillDestinations(values) {
  const base = values.global ? os.homedir() : process.cwd();
  if (values.target === "all")
    return Object.values(SKILL_FOLDERS).map((folder) => path.join(base, folder));
  if (values.target in SKILL_FOLDERS) return [path.join(base, SKILL_FOLDERS[values.target])];
  return [path.resolve(values.target)];
}

function installSkills(values) {
  const source = path.join(PACKAGE_ROOT, "plugins", NAME, "skills");
  for (const destination of skillDestinations(values))
    for (const skill of readdirSync(source)) {
      const target = path.join(destination, skill);
      // Remove the old copy, so that a file that an update deletes does not stay.
      rmSync(target, { recursive: true, force: true });
      cpSync(path.join(source, skill), target, { recursive: true });
      console.log(`Copied ${skill} to ${path.relative(process.cwd(), destination) || "."}.`);
    }
  return 0;
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      format: { type: "string", default: "text" },
      target: { type: "string", default: "all" },
      global: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.format !== "text" && values.format !== "json")
    throw new Error(`Use --format text or --format json, not "${values.format}".`);
  const [command = "check", argument = ""] = positionals;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (command === "check") return check(values);
  if (command === "report") return report(values, argument);
  if (command === "baseline") return writeBaseline(values);
  if (command === "init") return init();
  if (command === "skills") return installSkills(values);
  console.error(USAGE);
  return 2;
}
