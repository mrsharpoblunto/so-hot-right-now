---
name: hot-paths-setup
description: Add the so-hot-right-now hot path checker to a TypeScript project. Find the code that runs on each frame or tick, write hot-path.config.mjs with its roots and presets, tag the reached functions, and record a baseline. Use when the user asks to set up, adopt, or configure hot path checks, or to add roots or a project plugin.
---

# Set up the hot path checker

The checker finds allocations and slow lookups in code that runs on each frame or tick.
It needs roots: the functions that the engine calls on each frame or tick.
It follows each call from a root, so the roots decide which code it checks.

## 1. Install

Install the package as a dev dependency with the project's package manager. It includes its own TypeScript 6, so the project can compile with any TypeScript version.
The package is not on npm yet, so install it from GitHub:

```sh
pnpm add -D github:mrsharpoblunto/so-hot-right-now
npx so-hot-right-now init
```

`init` writes a starter `hot-path.config.mjs` in the current folder. Put it in the folder that holds `tsconfig.json`.

## 2. Find the roots

Read the engine loop before you write roots. Search for these entry points:

- A `requestAnimationFrame` loop. The `browser` preset finds a callback that schedules itself.
- An update, tick, step, or render method that the loop calls on each object of a class or an interface.
- A hook that takes a per-frame callback, such as `useFrame` in react-three-fiber.
- A worker `onmessage` handler that runs for each frame or tick.
- An `AudioWorkletProcessor.process` method. The `audioWorklet` preset finds it.

Write one root for each entry point:

```js
roots: [
  // Each class that implements `System` has its `update` called on each tick.
  { kind: "method", owner: { implements: "System" }, methods: ["update"], label: "simulation" },
  // Each class that extends `Entity` has its `tick` called on each tick.
  { kind: "method", owner: { extends: "Entity" }, methods: ["tick"], label: "simulation" },
  // A class name pattern.
  { kind: "method", owner: { name: /Renderer$/ }, methods: ["draw"], label: "frame" },
  // The callback that the code gives as argument 0 of `useFrame`.
  { kind: "argument", callee: "useFrame", index: 0, label: "frame" },
],
```

The `owner` names match the text in the `implements` or `extends` clause, or the class name.
A label groups roots. A project plugin can read the labels.
For a root that a matcher cannot find, tag the function `/** @hot <caller> */` and name the caller.

## 3. Pick the presets and the strict files

- Add `presets.browser` for DOM code. Add `presets.webgpu` for WebGPU code.
- Add `presets.react` when the code tags functions made with `useCallback`.
- Add `presets.audioWorklet` for audio worklet processors.
- Put a folder in `strict` when each of its functions must obey the rules, such as an engine core.

## 4. Run and tag

1. Run `npx so-hot-right-now report`. The first run usually reports many `untagged` problems.
2. Read each untagged function. Tag it `@hot` if its work for each call is small and bounded.
3. Tag a function `@hotIgnore <reason>` if it runs on a rare event or does slow work. Give the cost in the reason.
4. Do not tag a slow function `@hot` to make the report shorter.
5. Run the report again. Tags on new functions find more calls, so repeat until no `untagged` problem stays.

Use the `hot-paths` skill for the meaning of each tag and the fix for each problem.

## 5. Record the baseline

Run `npx so-hot-right-now baseline`. It writes the current problem counts to `hot-path-baseline.json`.
Commit the config and the baseline. After this, the check fails when a count goes up or down.

## 6. Add the skills to the project

Run `npx so-hot-right-now skills`. It copies the skills to `.claude/skills/` for Claude Code and to `.agents/skills/` for Codex.
Commit the copies, so that each agent that works in the project gets them.

## 7. Run it in the lint script

Add the check to the lint script, so that each pull request runs it:

```json
"scripts": {
  "lint": "tsc --noEmit && so-hot-right-now"
}
```

Then add these lines to the project's agent instructions file, such as `CLAUDE.md` or `AGENTS.md`:

```md
# Hot paths

Code that runs on each frame or tick must not allocate, create closures, compare strings, or use hash maps.
Use the `hot-paths` skill before you change a function tagged `@hot` or `@hotIgnore`.
Do not add problems to `hot-path-baseline.json`. Lower the counts when you fix problems.
```

## Project plugins

A plugin adds rules that only one project needs, such as "do not write to the world from render code".
Read `node_modules/so-hot-right-now/docs/plugins.md` before you write a plugin.
