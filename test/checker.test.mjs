import { beforeAll, expect, it } from "vitest";

import { checkHotPaths, compareWithBaseline, presets } from "so-hot-right-now";

import { ecs } from "../examples/ecs-plugin.mjs";
import { junkshipRoots } from "../examples/junkship.config.mjs";
import { createTestProgram } from "./program.mjs";

export const options = {
  root: "/project",
  strict: ["src/ecs/**"],
  plugins: [presets.browser, presets.webgpu, presets.react, presets.audioWorklet, ecs],
  roots: junkshipRoots,
};

const cases = [
  ["allocation with new", "const a = new Float64Array(4);", ["new"]],
  ["object literal", "const a = { x: 1 };", ["object"]],
  ["array literal", "const a = [1];", ["array"]],
  ["closure", "const a = () => 1;", ["closure"]],
  ["allocating built-in", "values.map(Math.abs);", ["allocation"]],
  ["template literal", "const a = `${count}`;", ["string"]],
  ["string concatenation", 'const a = "n" + count;', ["string"]],
  ["string comparison", 'if (kind === "fan") count++;', ["compare"]],
  ["string switch", 'switch (kind) { case "fan": break; }', ["compare"]],
  ["map lookup", "lookup.get(1);", ["hash"]],
  ["string-keyed lookup", "record[kind];", ["hash"]],
  ["map iteration", "for (const entry of lookup) count++;", ["iterator"]],
  ["argument spread", "Math.max(...values);", ["spread"]],
  ["typeof comparison", 'if (typeof count === "number") count++;', []],
  ["thrown error", "if (count < 0) throw new Error(`bad ${count}`);", []],
  ["catch block", "try { count++; } catch (error) { console.error([error]); }", []],
  ["array iteration", "for (const value of values) count += value;", []],
  ["typed array index", "buffer[count] = 2;", []],
  ["string variable comparison", "if (kind === other) count++;", ["compare"]],
  ["string prefix test", 'if (kind.startsWith("f")) count++;', ["compare"]],
  ["array includes", "if (values.includes(1)) count++;", []],
  ["string ordering", "if (kind < other) count++;", ["compare"]],
  ["rest binding", "const { length, ...others } = values;", ["rest"]],
  ["swap by destructuring", "[count, count] = [count, count];", ["array"]],
  ["object spread", "const a = { ...record };", ["object"]],
  ["array spread", "const a = [...values];", ["array"]],
  ["object assign", "Object.assign(record, record);", ["allocation"]],
  ["rest in assignment", "[count, ...values] = values;", ["rest"]],
  ["object rest in assignment", "({ count, ...record } = record);", ["rest"]],
  ["regex literal", "if (/a/.test(kind)) count++;", ["compare", "regex"]],
  ["delete", "delete record.a;", ["delete"]],
  ["arguments", "count = arguments.length;", ["arguments"]],
  ["console", "console.log(count);", ["console"]],
  ["promise chain", "job.then(Math.abs);", ["promise"]],
  ["integer-keyed object", "count = numbered[count];", ["numberKey"]],
  ["match array index", 'count = "a".match(/a/)!.index!;', ["compare", "regex"]],
  ["mixed number array", "count = maybe[0] ?? 0;", ["mixed"]],
  ["gpu object", "device.createBindGroup(layoutDescriptor);", ["gpu"]],
  ["command encoder", "device.createCommandEncoder();", []],
  ["layout read", "count = element.offsetWidth;", ["layout"]],
  ["layout method", "element.getBoundingClientRect();", ["layout"]],
  ["global layout read", "getComputedStyle(element);", ["layout"]],
  ["nullable layout receiver", "maybeElement?.getBoundingClientRect();", ["layout"]],
  ["nullable gpu receiver", "maybeTexture?.createView();", ["gpu"]],
  ["async pipeline", "device.createRenderPipelineAsync(pipelineDescriptor);", ["gpu"]],
  ["union promise", "either.then(Math.abs);", ["promise"]],
  ["console through globalThis", "globalThis.console.log(count);", ["console"]],
  ["object named console", "fakeConsole.log(count);", []],
  ["mixed tuple", "count = pair[1] ?? 0;", ["mixed"]],
  ["mixed array loop", "for (const value of maybe) count += value ?? 0;", ["mixed"]],
  ["numeric union key", "count = numbered[smallKey];", ["numberKey"]],
  ["quoted layout name", 'const { "offsetHeight": tall } = element; count = tall;', ["layout"]],
  ["assigned layout read", "({ offsetHeight: count } = element);", ["layout"]],
  [
    "assigned mixed read",
    "let next: number | null = 0; [next] = maybe; count = next ?? 0;",
    ["mixed"],
  ],
  [
    "rest from an element",
    "const { ...offsetHeight } = element; count = offsetHeight.id.length;",
    ["rest"],
  ],
  ["branded number key", "count = numbered[brandedKey];", ["numberKey"]],
  ["bracket console", 'console["log"](count);', ["console"]],
  ["bracket layout read", 'count = element["offsetHeight"];', ["layout"]],
  [
    "destructured layout read",
    "const { offsetHeight } = element; count = offsetHeight;",
    ["layout"],
  ],
  ["destructured mixed read", "const [first] = maybe; count = first ?? 0;", ["mixed"]],
  ["arguments property name", "const { arguments: copied } = withArguments; count = copied;", []],
];

let problems;
let lines;
let source;
let review;
let edges;
let worlds;
let worklet;

beforeAll(() => {
  const files = {};
  const declarations = `
declare let values: number[];
declare const buffer: Float64Array;
declare const lookup: Map<number, number>;
declare let record: Record<string, number>;
declare let count: number;
declare const kind: string;
declare const other: string;
declare const job: Promise<number>;
declare const numbered: Record<number, number>;
declare const maybe: (number | null)[];
declare const device: GPUDevice;
declare const layoutDescriptor: GPUBindGroupDescriptor;
declare const element: HTMLElement;
declare const maybeElement: HTMLElement | undefined;
interface GPUTexture { createView(): unknown }
declare const maybeTexture: GPUTexture | undefined;
declare const pipelineDescriptor: GPURenderPipelineDescriptor;
declare const either: Promise<number> | Promise<void>;
declare const fakeConsole: { log(value: number): void };
declare const pair: readonly [number, number | null];
declare const smallKey: 0 | 1;
declare const withArguments: { arguments: number };
declare const brandedKey: number & { readonly brand: unique symbol };
`;
  lines = declarations.split("\n").length;
  source =
    declarations +
    cases
      .map(([, source], i) => `/** @hot Test root. */ function check${i}() { ${source} }`)
      .join("\n") +
    `
interface System<T> { run(context: T): void }
export class ExampleSystem implements System<number> {
  /** @hot */
  run(context: number): void { helper(context); cold(context); unexplained(); untagged(); }
}
/** @hot */ function helper(value: number) { return { value }; }
/** @hotIgnore Runs when the topology changes. */
function cold(value: number) { return { value }; }
/** @hotIgnore */
function unexplained() {}
function unreached() { return { value: 1 }; }
function untagged() {}
/** @hot */ function staleHot() {}
/** @hotIgnore Runs when a save loads. */ function staleIgnore() {}
`;
  files["src/checks.ts"] = source;
  files["src/queries.ts"] =
    `declare function defineQuery(types: unknown[], excluded: unknown[]): number;
export const MODULE_QUERY = defineQuery([], []);
export function inline() { return defineQuery([], []); }
`;
  files["src/allowed.ts"] = `/** @hot Test root. */ export function read(buffer: ArrayBuffer) {
  // hot-path: allow WebGPU returns a new buffer for each mapped read.
  const reasoned = new Float64Array(buffer);
  // hot-path: allow
  const bare = new Float64Array(buffer);
  return reasoned[0] + bare[0];
}
`;
  files["src/callbacks.ts"] = `interface Module { prepare(value: number): { value: number } }
/** @hot */ function named(value: number) { return { value }; }
const modules: Module[] = [
  {
    /** @hot */
    prepare(value) { return { value }; },
  },
  { prepare: named },
];
/** @hot */ function forClass(value: number) { return { value }; }
class Named implements Module { prepare = forClass; }
export const named2 = new Named();
/** @hot Test root. */ export function prepareAll() {
  for (let index = 0; index < modules.length; index++) modules[index].prepare(index);
}
`;
  files["src/cycle.ts"] = `type F = (() => void) | undefined;
var a: F = b;
var b: F = a;
interface Holder { run: F }
export const holder: Holder = { run: a };
`;
  files["src/frames.tsx"] =
    `declare function useFrameLoopPhase(phase: string, listener: () => void): void;
declare function useCallback<T>(callback: T, deps: unknown[]): T;
declare function requestAnimationFrame(callback: () => void): number;
declare function measure(name: string, run: () => void): void;
export function Scene() {
  /** @hot */
  const render = useCallback(() => { measure("draw", draw); }, []);
  useFrameLoopPhase("render", render);
  /** @hot */
  const loop = () => { requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  requestAnimationFrame(() => { const once = { at: 1 }; });
  return null;
}
/** @hot */ function draw() { return [1]; }
interface Level { draw(): void }
const level: Level = {
  /** @hot */
  draw() { const drawn = [2]; },
};
/** @hot Test root. */ export function drawLevel() { measure("level", level.draw); }
`;
  review = `interface System<T> { run(context: T): void }
export class ArrowSystem implements System<number> {
  /** @hot */
  run = (context: number): void => { const made = [context]; };
}
function setup() {
  return {
    tick() { return [1]; },
  };
}
const ticker = setup();
/** @hot */
class Tagged {
  step() { return 1; }
}
const tagged = new Tagged();
interface Reading { value: number }
class Reader implements Reading {
  /** @hot */
  get value() { return 1; }
  /** @hotIgnore Runs when a save loads. */
  set value(next: number) {}
}
const reader: Reading = new Reader();
/** @hot */
const LIMIT = 3;
/** @hot Test root. */ export function tickAll() {
  ticker.tick();
  tagged.step();
  return reader.value + LIMIT;
}
`;
  files["src/review.ts"] = review;
  edges = `class Store {
  /** @hot */
  get level() { return 1; }
  /** @hot */
  set level(next: number) { const written = [next]; }
}
const store = new Store();
declare const levels: number[];
/** @hot Test root. */ export function writeLevel() { [store.level] = levels; }
/** @hot Worker callback. */
export default () => [2];
/** @hot Worker callback. */
const wrapped = (() => [3]);
/** @hot */ function makeTick() { return () => 1; }
/** @hot Test root. */ export function makeIt() { return makeTick(); }
const tick = makeTick();
/** @hot Test root. */ export function callIt() { return tick() + wrapped().length; }
/** @hot Test root. */ export function readGeneric<T extends HTMLElement>(element: T) { return element.offsetHeight; }
/** @hot Test root. */ export function readParameter({ offsetHeight }: HTMLElement) { return offsetHeight; }
/** @hot Test root. */ export function readMixed<T extends (number | null)[]>(values: T) { const [first] = values; return first; }
`;
  files["src/edges.ts"] = edges;
  worlds = `declare class World { set(entity: number, value: number): void }
declare const world: World;
declare function useFrameLoopPhase(phase: string, listener: () => void): void;
interface System<T> { run(context: T): void }
/** @hot */ function simulate(context: number) { world.set(context, 1); }
class Sim implements System<number> { run = (simulate); }
class LightPrepareRenderSystem {
  /** @hot */
  prepare() { world.set(2, 3); }
}
const sim = new Sim();
const lights = new LightPrepareRenderSystem();
export function Frame() {
  /** @hot */
  const frame = () => { sim.run(1); lights.prepare(); };
  useFrameLoopPhase("render", frame);
}
`;
  files["src/worlds.tsx"] = worlds;
  worklet = `declare class AudioWorkletProcessor { readonly port: MessagePort }
export class Capture extends AudioWorkletProcessor {
  /** @hot */
  process(inputs: Float32Array[][]): boolean { return inputs[0][0].slice(0).length > 0; }
}
export class Plain {
  process(inputs: Float32Array[][]): boolean { return inputs[0][0].slice(0).length > 0; }
}
`;
  files["src/worklet.ts"] = worklet;
  files["src/waits.ts"] = `/** @hot Test root. */ export async function wait(job: Promise<number>) {
  return await job;
}
`;
  files["src/ecs/core.ts"] =
    "/** @hot */ export function read() { return [1]; }\n/** @hotIgnore Runs at module load. */ export function setup() { return [1]; }\n";
  problems = checkHotPaths(createTestProgram(files), options);
});

const problemsAt = (line) =>
  problems
    .filter((problem) => problem.fileName.endsWith("/checks.ts"))
    .filter((problem) => problem.line === line)
    .map((problem) => problem.messageId);

it.each(cases.map(([name, , expected], index) => ({ name, expected, index })))(
  "$name",
  ({ expected, index }) => {
    expect(problemsAt(lines + index)).toEqual(expected);
  },
);

it("follows calls from a system's run method", () => {
  const helper = problems.find((problem) => problem.chain.endsWith("ExampleSystem.run > helper"));
  expect(helper?.messageId).toBe("object");
});

const problemsOn = (text) => {
  const line = source.split("\n").findIndex((candidate) => candidate.includes(text)) + 1;
  return problemsAt(line);
};

it("stops at an ignored function and skips unreached functions", () => {
  expect(problemsOn("function cold(")).toEqual([]);
  expect(problemsOn("function unreached(")).toEqual([]);
});

it("requires a reason on an ignore tag", () => {
  expect(problemsOn("/** @hotIgnore */")).toEqual(["reason"]);
});

it("requires a tag on each function that a hot path reaches", () => {
  expect(problemsOn("function untagged(")).toEqual(["untagged"]);
});

it("reports a tag that no hot path needs", () => {
  expect(problemsOn("function staleHot(")).toEqual(["staleHot"]);
  expect(problemsOn("function staleIgnore(")).toEqual(["staleIgnore"]);
});

it("checks every function in the strict directory", () => {
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/ecs/core.ts"))
      .map((problem) => problem.messageId),
  ).toEqual(["array"]);
});

it("reports grown and stale baseline counts", () => {
  const problem = (file, messageId) => ({
    file,
    messageId,
    strict: file.startsWith("src/ecs/"),
  });
  const { grown, stale } = compareWithBaseline(
    [problem("src/a.ts", "new"), problem("src/a.ts", "new"), problem("src/ecs/World.ts", "object")],
    { "src/a.ts": { new: 1, hash: 2 }, "src/ecs/World.ts": { object: 1 } },
  );
  expect(grown.map((group) => [group.file, group.messageId])).toEqual([
    ["src/a.ts", "new"],
    ["src/ecs/World.ts", "object"],
  ]);
  expect(stale.map((group) => [group.file, group.messageId])).toEqual([["src/a.ts", "hash"]]);
});

it("requires defineQuery at module scope", () => {
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/queries.ts"))
      .map((problem) => [problem.line, problem.messageId]),
  ).toEqual([[3, "query"]]);
});

it("accepts an allowed line only with a reason", () => {
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/allowed.ts"))
      .map((problem) => [problem.line, problem.messageId]),
  ).toEqual([[5, "allow"]]);
});

it("follows a call through an interface to its implementations", () => {
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/callbacks.ts"))
      .map((problem) => [problem.line, problem.messageId]),
  ).toEqual([
    [2, "object"],
    [6, "object"],
    [10, "object"],
  ]);
});

it("reports an async function in a hot path", () => {
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/waits.ts"))
      .map((problem) => [problem.line, problem.messageId]),
  ).toEqual([[1, "async"]]);
});

it("starts at frame-loop listeners, self-scheduling frame callbacks, and passed functions", () => {
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/frames.tsx"))
      .map((problem) => [problem.line, problem.messageId]),
  ).toEqual([
    [15, "array"],
    [19, "array"],
  ]);
});

const reviewProblems = (text) => {
  const line = review.split("\n").findIndex((candidate) => candidate.includes(text)) + 1;
  return problems
    .filter((problem) => problem.fileName.endsWith("/review.ts"))
    .filter((problem) => problem.line === line)
    .map((problem) => problem.messageId);
};

it("starts at a system method that a class property holds", () => {
  expect(reviewProblems("const made = [context]")).toEqual(["array"]);
});

it("requires a tag on a function that a cold factory creates", () => {
  expect(reviewProblems("tick() {")).toEqual(["untagged", "array"]);
});

it("does not apply a class tag to its methods", () => {
  expect(reviewProblems("step() {")).toEqual(["untagged"]);
});

it("follows an interface read to the getter only", () => {
  expect(reviewProblems("get value()")).toEqual([]);
  expect(reviewProblems("@hotIgnore Runs when a save loads.")).toEqual(["staleIgnore"]);
});

it("reports a hot tag that is not on a function", () => {
  const line = review.split("\n").indexOf("const LIMIT = 3;");
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/review.ts"))
      .filter((problem) => problem.line === line)
      .map((problem) => problem.messageId),
  ).toEqual(["misplaced"]);
});

const edgeProblems = (text) => {
  const line = edges.split("\n").findIndex((candidate) => candidate.includes(text)) + 1;
  return problems
    .filter((problem) => problem.fileName.endsWith("/edges.ts"))
    .filter((problem) => problem.line === line)
    .map((problem) => problem.messageId);
};

it("sends a destructuring write to the setter only", () => {
  expect(edgeProblems("const written = [next]")).toEqual(["array"]);
  const getter = edges.split("\n").findIndex((line) => line.includes("get level()")) - 1;
  expect(
    problems
      .filter((problem) => problem.fileName.endsWith("/edges.ts"))
      .filter((problem) => problem.line === getter + 1)
      .map((problem) => problem.messageId),
  ).toEqual(["staleHot"]);
});

it("accepts a root tag on a default export and on a parenthesized arrow", () => {
  expect(edgeProblems("export default () => [2]")).toEqual(["array"]);
  expect(edgeProblems("const wrapped = (() => [3])")).toEqual(["array"]);
});

it("exempts a closure that hot code creates, in any scan order", () => {
  expect(edgeProblems("function makeTick()")).toEqual(["closure"]);
});

it("reads a generic receiver by its constraint", () => {
  expect(edgeProblems("readGeneric<T extends HTMLElement>")).toEqual(["layout"]);
});

it("reports world writes from frame code but not from a system it calls", () => {
  const line = (text) => worlds.split("\n").findIndex((candidate) => candidate.includes(text)) + 1;
  const at = (text) =>
    problems
      .filter((problem) => problem.fileName.endsWith("/worlds.tsx"))
      .filter((problem) => problem.line === line(text))
      .map((problem) => problem.messageId);
  expect(at("world.set(context, 1)")).toEqual([]);
  expect(at("world.set(2, 3)")).toEqual(["worldWrite"]);
});

it("checks parameter destructuring and generic mixed arrays", () => {
  expect(edgeProblems("readParameter({ offsetHeight }")).toEqual(["layout"]);
  expect(edgeProblems("readMixed<T extends")).toEqual(["mixed"]);
});

it("starts at the process method of an audio worklet processor", () => {
  const problemsFor = (line) =>
    problems
      .filter((problem) => problem.fileName.endsWith("/worklet.ts"))
      .filter((problem) => problem.line === line)
      .map((problem) => problem.messageId);
  const lines = worklet.split("\n");
  const [rootLine, plainLine] = lines
    .map((line, index) => (line.includes("process(") ? index + 1 : -1))
    .filter((line) => line > 0);
  expect(problemsFor(rootLine)).toEqual(["allocation"]);
  expect(problemsFor(plainLine)).toEqual([]);
});
