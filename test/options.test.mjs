import { checkHotPaths, presets } from "@thestraylight/so-hot-right-now";
import { expect, it } from "vitest";
import ts5 from "typescript-5";

import { ecs } from "../examples/ecs-plugin.mjs";
import { ROOT, createTestProgram } from "./program.mjs";

const gpuSource = `declare const device: GPUDevice;
declare const descriptor: GPUBindGroupDescriptor;
/** @hot Test root. */ export function draw() { device.createBindGroup(descriptor); }
`;

const ids = (problems) => problems.map((problem) => problem.messageId);

it("runs a preset rule only when the config adds the preset", () => {
  const program = createTestProgram({ "src/draw.ts": gpuSource });
  expect(ids(checkHotPaths(program, { root: ROOT }))).toEqual([]);
  expect(ids(checkHotPaths(program, { root: ROOT, plugins: [presets.webgpu] }))).toEqual(["gpu"]);
});

it("does not check an excluded file", () => {
  const program = createTestProgram({
    "src/draw.ts": "/** @hot Test root. */ export function draw() { return [1]; }\n",
  });
  expect(ids(checkHotPaths(program, { root: ROOT, exclude: ["src/draw.ts"] }))).toEqual([]);
});

it("starts at a method on a class with a matching name", () => {
  const program = createTestProgram({
    "src/game.ts": `export class Game {
  /** @hot */
  update() { return [1]; }
}
`,
  });
  const roots = [
    {
      kind: "method",
      owner: { name: "Game" },
      methods: ["update"],
      label: "tick",
    },
  ];
  expect(
    checkHotPaths(program, { root: ROOT, roots }).map((problem) => [
      problem.chain,
      problem.messageId,
    ]),
  ).toEqual([["Game.update", "array"]]);
});

it("rejects a root without a label", () => {
  const program = createTestProgram({ "src/a.ts": "" });
  expect(() =>
    checkHotPaths(program, {
      root: ROOT,
      roots: [{ kind: "argument", callee: "useFrame", index: 0 }],
    }),
  ).toThrow("label");
});

it("rejects a plugin message id that another plugin owns", () => {
  const program = createTestProgram({ "src/a.ts": "" });
  const copy = { name: "copy", messages: { array: "Again." } };
  expect(() => checkHotPaths(program, { root: ROOT, plugins: [copy] })).toThrow('"array"');
});

it("keeps the state of a plugin inside one check", () => {
  const program = createTestProgram({
    "src/frame.ts": `declare class World { set(entity: number, value: number): void }
declare const world: World;
/** @hot Test root. */ export function frame() { world.set(1, 2); }
`,
  });
  const check = () => ids(checkHotPaths(program, { root: ROOT, plugins: [ecs] }));
  expect(check()).toEqual(["worldWrite"]);
  expect(check()).toEqual(["worldWrite"]);
});

it("rejects a program from another TypeScript version", () => {
  const program = ts5.createProgram([], { noEmit: true });
  expect(() => checkHotPaths(program, { root: ROOT })).toThrow("different TypeScript version");
});
