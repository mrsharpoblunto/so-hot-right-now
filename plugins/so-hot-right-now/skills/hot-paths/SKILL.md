---
name: hot-paths
description: Write and fix code that runs on each frame or tick in a project that uses the so-hot-right-now checker. Use when you change a function tagged `@hot` or `@hotIgnore`, when the checker reports a hot path problem, when you add a call from hot code, or when you lower the hot path baseline.
---

# Hot paths

A hot path is code that runs on each simulation tick or each displayed frame.
Hot code must not make garbage or do slow lookups. Garbage collection pauses cause frame spikes.

The `so-hot-right-now` checker finds the hot code. It starts at the roots in `hot-path.config.mjs` and follows each resolved call.
Each function that it reaches must have a tag, and each tagged function must obey the rules.

## Commands

Find the command in the `package.json` scripts first. These are the direct commands:

```sh
# Check against the baseline. The lint script usually runs this.
npx so-hot-right-now

# Show each problem whose path contains the text, with the call chain that makes it hot.
npx so-hot-right-now report src/physics/

# Write the current counts after you fix problems.
npx so-hot-right-now baseline
```

Add `--format json` to get the problems as data.

## Tags

- `/** @hot */`: the function is fast enough to run on each tick or frame. The checker applies the rules to it and follows its calls.
- `/** @hot <caller> */`: the function is a root that the call graph cannot find, such as a worker message handler. Name the caller.
- `/** @hotIgnore <reason> */`: hot code calls the function, but the function may break the rules. The checker does not examine it or its calls. The reason says when it runs or what it costs.

Read a function before you tag it:

- Tag it `@hot` only when its work for each call is small and bounded.
- Do not tag a slow function `@hot` to make the check pass.
- Make a slow function faster, or tag it `@hotIgnore` and give its cost.

Use `@hotIgnore` for these functions:

- A function that runs on a rare event behind a guard in the hot caller. Examples are spawn, load, save, and a version-gated rebuild.
- A function that does more work than the tick needs, such as a search that a cache could replace. `git grep "@hotIgnore"` lists these candidates for a speed-up.
- Code that runs only while a developer records a trace. Guard each call with a flag check.

Put the tag on the function, or on the declaration that holds the function. A class tag or an object tag does not apply to its members.
A closure that hot code creates needs no tag, because the checker already reports the closure.

## Fixes

Read `rules.md` in this skill folder for the fix for each message id.
These are the most frequent fixes:

- `new`, `object`, `array`: allocate once at module scope or in the constructor. Reuse the object on each call.
- `closure`: make a method on a long-lived object, or write a loop.
- `allocation`: write into a reused buffer. Copy each field by hand.
- `string`, `compare`: use integer constants. Compute the integer once, when the data loads.
- `hash`: use an array indexed by a dense integer, such as an entity index.
- `iterator`: iterate an array or a typed array with an index.
- `untagged`: read the function, then tag it `@hot` or `@hotIgnore <reason>`.
- `staleHot`, `staleIgnore`: remove the tag. No hot path calls the function now.

Code inside a `throw` statement or a `catch` block is not hot. It runs only on a failure.

## Allowed lines

A `// hot-path: allow <reason>` comment on the line above a problem accepts that one problem.

- Use it only when a platform API must allocate, for example a mapped GPU read.
- Give the reason. The checker reports an allow comment without a reason.
- Do not use it to skip a fix that you can make.

## The baseline

The baseline file records the problems that existed when the project started the check. It counts each message for each file.

- The check fails when a count increases. Fix the new problem. Do not raise the count.
- The check fails when a count decreases. Run the `baseline` command so that the count cannot increase again.
- The baseline never accepts a problem in a strict file. The config lists the strict files.
- Do not edit the baseline file by hand.

## Workflow

1. Run the check. Read each problem and its call chain.
2. Read the function at the end of the chain before you change it.
3. Fix the problem in the hot function, or move the slow work behind a guard into a `@hotIgnore` function.
4. Run the check again until it passes.
5. If counts went down, run the `baseline` command and commit the baseline with the fix.
