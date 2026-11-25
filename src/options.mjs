import path from "node:path";

import picomatch from "picomatch";

import { core } from "./rules/core.mjs";
import { normalize } from "./syntax.mjs";

export const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
];

const ROOT_KINDS = new Set(["method", "argument", "scheduler"]);

function matcher(patterns) {
  if (patterns.length === 0) return () => false;
  return picomatch(patterns, { dot: true });
}

function validateRoot(root, plugin) {
  const where = plugin ? `plugin "${plugin}"` : "config";
  if (!ROOT_KINDS.has(root.kind))
    throw new Error(`A root in the ${where} has an unknown kind "${root.kind}".`);
  if (typeof root.label !== "string" || root.label === "")
    throw new Error(`Give each root in the ${where} a label.`);
  if (root.kind === "method") {
    const owner = root.owner ?? {};
    const keys = ["implements", "extends", "name"].filter((key) => owner[key] !== undefined);
    if (keys.length !== 1)
      throw new Error(
        `Give the "${root.label}" root in the ${where} one owner: implements, extends, or name.`,
      );
    if (!Array.isArray(root.methods) || root.methods.length === 0)
      throw new Error(`Give the "${root.label}" root in the ${where} its methods.`);
  } else if (typeof root.callee !== "string" || !Number.isInteger(root.index))
    throw new Error(
      `Give the "${root.label}" root in the ${where} a callee and an argument index.`,
    );
}

// Each option has a default here, so the checker reads only complete options.
export function resolveOptions(options, walkerMessages) {
  const root = normalize(path.resolve(options.root));
  const include = matcher(options.include ?? ["**/*"]);
  const exclude = matcher(options.exclude ?? DEFAULT_EXCLUDE);
  const strict = matcher(options.strict ?? []);
  const plugins = [core, ...(options.plugins ?? [])];

  const messages = { ...walkerMessages };
  for (const plugin of plugins)
    for (const [id, message] of Object.entries(plugin.messages ?? {})) {
      if (id in messages)
        throw new Error(
          `The plugin "${plugin.name}" defines the message "${id}" again. Give it a different id.`,
        );
      messages[id] = message;
    }

  const roots = [];
  for (const entry of options.roots ?? []) {
    validateRoot(entry, null);
    roots.push(entry);
  }
  for (const plugin of plugins)
    for (const entry of plugin.roots ?? []) {
      validateRoot(entry, plugin.name);
      roots.push(entry);
    }

  const relative = (fileName) => normalize(path.posix.relative(root, normalize(fileName)));
  const inProject = (file) => !file.startsWith("../") && !path.posix.isAbsolute(file);

  return {
    root,
    relative,
    isProjectFile: (file) => inProject(file) && include(file) && !exclude(file),
    isStrictFile: (file) => inProject(file) && strict(file),
    plugins,
    messages,
    roots,
    functionHooks: new Set(plugins.flatMap((plugin) => plugin.functionHooks ?? [])),
  };
}
