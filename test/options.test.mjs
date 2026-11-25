import { checkHotPaths, createClassicAnalysis, presets } from "@thestraylight/so-hot-right-now";
import { afterEach, expect, it } from "vitest";
import ts5 from "typescript-5";
import ts6 from "typescript-6";

import { ecs } from "../examples/ecs-plugin.mjs";
import { ROOT, closeTestAnalyses, createTestAnalysis } from "./program.mjs";

const gpuSource = `declare const device: GPUDevice;
declare const descriptor: GPUBindGroupDescriptor;
/** @hot Test root. */ export function draw() { device.createBindGroup(descriptor); }
`;

afterEach(closeTestAnalyses);

const ids = (problems) => problems.map((problem) => problem.messageId);

it("runs a preset rule only when the config adds the preset", () => {
  const analysis = createTestAnalysis({ "src/draw.ts": gpuSource }, "classic");
  expect(ids(checkHotPaths(analysis, { root: ROOT }))).toEqual([]);
  expect(ids(checkHotPaths(analysis, { root: ROOT, plugins: [presets.webgpu] }))).toEqual(["gpu"]);
});

it("does not check an excluded file", () => {
  const analysis = createTestAnalysis(
    {
      "src/draw.ts": "/** @hot Test root. */ export function draw() { return [1]; }\n",
    },
    "classic",
  );
  expect(ids(checkHotPaths(analysis, { root: ROOT, exclude: ["src/draw.ts"] }))).toEqual([]);
});

it("starts at a method on a class with a matching name", () => {
  const analysis = createTestAnalysis(
    {
      "src/game.ts": `export class Game {
  /** @hot */
  update() { return [1]; }
}
`,
    },
    "classic",
  );
  const roots = [
    {
      kind: "method",
      owner: { name: "Game" },
      methods: ["update"],
      label: "tick",
    },
  ];
  expect(
    checkHotPaths(analysis, { root: ROOT, roots }).map((problem) => [
      problem.chain,
      problem.messageId,
    ]),
  ).toEqual([["Game.update", "array"]]);
});

it("rejects a root without a label", () => {
  const analysis = createTestAnalysis({ "src/a.ts": "" }, "classic");
  expect(() =>
    checkHotPaths(analysis, {
      root: ROOT,
      roots: [{ kind: "argument", callee: "useFrame", index: 0 }],
    }),
  ).toThrow("label");
});

it("rejects a plugin message id that another plugin owns", () => {
  const analysis = createTestAnalysis({ "src/a.ts": "" }, "classic");
  const copy = { name: "copy", messages: { array: "Again." } };
  expect(() => checkHotPaths(analysis, { root: ROOT, plugins: [copy] })).toThrow('"array"');
});

it("keeps the state of a plugin inside one check", () => {
  const analysis = createTestAnalysis(
    {
      "src/frame.ts": `declare class World { set(entity: number, value: number): void }
declare const world: World;
/** @hot Test root. */ export function frame() { world.set(1, 2); }
`,
    },
    "classic",
  );
  const check = () => ids(checkHotPaths(analysis, { root: ROOT, plugins: [ecs] }));
  expect(check()).toEqual(["worldWrite"]);
  expect(check()).toEqual(["worldWrite"]);
});

it("rejects a program from another TypeScript version", () => {
  const program = ts5.createProgram([], { noEmit: true });
  expect(() => createClassicAnalysis(ts6, program)).toThrow("different TypeScript version");
});
