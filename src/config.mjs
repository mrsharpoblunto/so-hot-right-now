import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONFIG_FILES = [
  "hot-path.config.mjs",
  "hot-path.config.js",
  "hot-path.config.ts",
  "hot-path.config.mts",
];

export function defineConfig(config) {
  return config;
}

export function findConfig(directory) {
  for (let current = path.resolve(directory); ;) {
    for (const name of CONFIG_FILES) {
      const candidate = path.join(current, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// The config file's folder is the project root. Paths in the config are relative to it.
export async function loadConfig(configPath) {
  const module = await import(pathToFileURL(configPath).href);
  const config = module.default;
  if (!config || typeof config !== "object")
    throw new Error(`${configPath} must export a config object as its default export.`);
  const root = path.dirname(configPath);
  return {
    root,
    tsconfig: path.resolve(root, config.tsconfig ?? "tsconfig.json"),
    baseline: path.resolve(root, config.baseline ?? "hot-path-baseline.json"),
    options: {
      root,
      include: config.include,
      exclude: config.exclude,
      strict: config.strict,
      plugins: config.plugins,
      roots: config.roots,
    },
  };
}

export function readBaseline(baselinePath) {
  return existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
}
