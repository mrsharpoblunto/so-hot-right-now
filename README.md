# so-hot-right-now

A TypeScript checker for code that runs on each frame or tick.

The checker finds allocations, closures, string compares, and hash lookups in hot code. These cause garbage collection pauses and frame spikes in games, simulations, renderers, and audio code.
It reads the TypeScript types and follows each resolved call from your engine's entry points. You do not need to mark every function by hand.

```text
src/physics/step.ts: 2 "object" problem(s), 0 allowed. Do not create an object literal in a hot path. Reuse a preallocated object or write to typed arrays.
  src/physics/step.ts:41:12 (hot via PhysicsSystem.update > integrate > contact)
  src/physics/step.ts:58:20 (hot via PhysicsSystem.update > integrate)
```

The package also gives agent skills, so that a coding agent can write hot code, fix problems, and set up the checker.

## How it works

1. You give the **roots**: the methods and callbacks that your engine calls on each frame or tick.
2. The checker follows each resolved call, getter, setter, and interface implementation from the roots.
3. Each function that it reaches must have a tag:
   - `/** @hot */`: the function obeys the rules. The checker checks it and follows its calls.
   - `/** @hotIgnore <reason> */`: the function may break the rules. The walk stops there. The reason says when it runs or what it costs.
4. A **baseline** file counts the existing problems for each file. New problems fail the check, so you can add the checker to a large project.

The tags show which code is hot. A reviewer can see that a function runs on each frame without a trace in a profiler.

## Install

The npm name is `@thestraylight/so-hot-right-now`, and the command is `so-hot-right-now`.

```sh
pnpm add -D @thestraylight/so-hot-right-now typescript
npx so-hot-right-now init
```

`init` writes `hot-path.config.mjs`. Edit its roots, then record a baseline:

```sh
npx so-hot-right-now report     # Show each problem with its call chain.
npx so-hot-right-now baseline   # Write the current counts to hot-path-baseline.json.
npx so-hot-right-now            # Check against the baseline. Put this in your lint script.
```

Node 22.18 or newer is necessary.

## TypeScript versions

`typescript` is a peer dependency. The checker reads the project with the TypeScript version that the project installs, so the types match the project's compiler.

| Project TypeScript | How the checker reads the project |
| --- | --- |
| 5.x and 6.x | The compiler API in the `typescript` module. |
| 7.x and newer | The `typescript/unstable/sync` API. It runs the native compiler in a child process, and the check stops the process when it ends. |

Both backends give the same problems. On a large project, the TypeScript 7 backend can be slower, because each new type question is a call to the child process.
TypeScript 7 calls its API "unstable". A new TypeScript 7 release can change it before this package supports the change.

## Config

```js
// hot-path.config.mjs
import { defineConfig, presets } from "@thestraylight/so-hot-right-now";

export default defineConfig({
  tsconfig: "tsconfig.json",
  baseline: "hot-path-baseline.json",
  include: ["src/**"],
  // Every function in these files is a root, and the baseline accepts no problems in them.
  strict: ["src/engine/core/**"],
  plugins: [presets.browser, presets.webgpu, presets.react],
  roots: [
    { kind: "method", owner: { implements: "System" }, methods: ["update"], label: "simulation" },
    { kind: "method", owner: { name: /Renderer$/ }, methods: ["draw"], label: "frame" },
    { kind: "argument", callee: "useFrame", index: 0, label: "frame" },
  ],
});
```

The paths are relative to the config file's folder. The default `exclude` skips `node_modules` and test files.

### Roots

| Kind | Finds |
| --- | --- |
| `method` | A method or a function property on a class. The `owner` is `{ implements }`, `{ extends }`, or `{ name }` (a string or a RegExp). |
| `argument` | The function that the code gives to a call, such as `useFrame(callback)`. |
| `scheduler` | A callback that gives itself to a call from its own body, such as a `requestAnimationFrame` loop. |

For a root that a matcher cannot find, such as a worker message handler, tag the function `/** @hot <caller> */`.

### Presets

| Preset | Adds |
| --- | --- |
| `browser` | The `layout` rule for DOM layout reads. A root for each self-scheduling `requestAnimationFrame` callback. |
| `webgpu` | The `gpu` rule for WebGPU create calls, such as `createBindGroup` and `createView`. |
| `react` | Lets a tag on `const f = useCallback(...)` apply to the function. |
| `audioWorklet` | A root for `process` on each `AudioWorkletProcessor` class. |

The core rules always apply. [`plugins/so-hot-right-now/skills/hot-paths/rules.md`](plugins/so-hot-right-now/skills/hot-paths/rules.md) lists each rule and its fix.

### Allowed lines

A `// hot-path: allow <reason>` comment on the line above a problem accepts that one problem. Use it only when a platform API must allocate. The reason is necessary.

## Plugins

A plugin adds rules that only your project needs. For example, `examples/ecs-plugin.mjs` reports a world write from render code. Read [docs/plugins.md](docs/plugins.md).

## Agent skills

The package has two skills in the [Agent Skills](https://agentskills.io) format. Claude Code and Codex both read this format.

- `hot-paths`: write and fix hot code. It explains the tags, the fix for each problem, and the baseline.
- `hot-paths-setup`: add the checker to a project. It finds the roots, writes the config, and records the baseline.

### Copy the skills into the project

Use this way for a team. The skills go into version control, so each contributor and each agent gets the same version.

```sh
npx so-hot-right-now skills
```

The command copies the skills to these folders:

| Agent | Folder |
| --- | --- |
| Claude Code | `.claude/skills/` |
| Codex, and other Agent Skills tools | `.agents/skills/` |

Add `--target claude` or `--target codex` for one agent only, or give a folder. Add `--global` to copy into `~/.claude/skills/` and `~/.agents/skills/`.
Run the command again after you update the package. It replaces the old copies.

### Install the plugin

Use this way for one person. The plugin gives the same skills with the `so-hot-right-now:` prefix.

Claude Code:

```text
/plugin marketplace add mrsharpoblunto/so-hot-right-now
/plugin install so-hot-right-now@so-hot-right-now
```

Codex:

```sh
codex plugin marketplace add mrsharpoblunto/so-hot-right-now
codex plugin add so-hot-right-now@so-hot-right-now
```

Codex reads the Claude Code marketplace file in `.claude-plugin/`, so one manifest serves both agents.

## API

```js
import { checkHotPaths, openProject, presets } from "@thestraylight/so-hot-right-now";

const { analysis, close } = await openProject("tsconfig.json");
try {
  const problems = checkHotPaths(analysis, { root: process.cwd(), plugins: [presets.browser] });
} finally {
  close();
}
```

`openProject` picks the backend for the project's TypeScript version.
To share a TypeScript 5 or 6 program with other type-aware checks, call `createClassicAnalysis(ts, program)`. Pass the `typescript` module that made the program, because each TypeScript version numbers its type flags differently.
For a TypeScript 7 API project, call `createNativeAnalysis({ sync, ast, version }, project)`.

## Limits

- The checker reads only TypeScript and JavaScript that the `tsconfig.json` includes.
- It follows calls that the type checker can resolve. A call through an `any` value or a computed key stops the walk.

## License

MIT
