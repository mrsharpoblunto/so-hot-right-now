import { browser } from "./rules/browser.mjs";
import { audioWorklet, react } from "./rules/frameworks.mjs";
import { webgpu } from "./rules/webgpu.mjs";

export { createClassicAnalysis } from "./backends/classic.mjs";
export { createNativeAnalysis } from "./backends/native.mjs";
export { compareWithBaseline, countProblems } from "./baseline.mjs";
export { checkHotPaths, walkerMessages } from "./checker.mjs";
export { defineConfig, findConfig, loadConfig, readBaseline } from "./config.mjs";
export { DEFAULT_EXCLUDE } from "./options.mjs";
export { openProject } from "./project.mjs";
export { core } from "./rules/core.mjs";

export const presets = { browser, webgpu, react, audioWorklet };
