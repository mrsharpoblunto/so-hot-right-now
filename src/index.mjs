import { browser } from "./rules/browser.mjs";
import { audioWorklet, react } from "./rules/frameworks.mjs";
import { webgpu } from "./rules/webgpu.mjs";

export { checkHotPaths, walkerMessages } from "./checker.mjs";
export { compareWithBaseline, countProblems } from "./baseline.mjs";
export { createProgram, defineConfig, findConfig, loadConfig, readBaseline } from "./config.mjs";
export { core } from "./rules/core.mjs";
export { DEFAULT_EXCLUDE } from "./options.mjs";
// Plugins must use the same TypeScript as the checker, because the versions number flags differently.
export { default as ts } from "typescript";

export const presets = { browser, webgpu, react, audioWorklet };
