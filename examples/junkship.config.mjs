// The config that gives the same results as the checker in the junkship repo.
// Copy it to `hot-path.config.mjs` in the project root.
import { defineConfig, presets } from "so-hot-right-now";

import { ecs } from "./ecs-plugin.mjs";

export const junkshipRoots = [
  {
    kind: "method",
    owner: { implements: "System" },
    methods: ["run", "beginStep"],
    label: "simulation",
  },
  {
    kind: "method",
    owner: { name: /PrepareRenderSystem$/ },
    methods: ["prepare"],
    label: "render",
  },
  // The frame loop calls each function that a component gives to this hook on each frame.
  { kind: "argument", callee: "useFrameLoopPhase", index: 1, label: "frame" },
];

export default defineConfig({
  tsconfig: "tsconfig.json",
  baseline: "scripts/lint-rules/hot-path-baseline.json",
  include: ["src/**"],
  strict: ["src/ecs/**"],
  plugins: [presets.browser, presets.webgpu, presets.react, presets.audioWorklet, ecs],
  roots: junkshipRoots,
});
