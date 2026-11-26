# Measure a change

A small speed change is easy to measure wrongly. Use an A/B harness, a known noise level, and an output check.

## The A/B harness

Run each build in its own process. Do not load two builds in one process to decide.

Two builds in one process can share state. The first build that loads can run faster than the second build. In planck.js, the first-loaded build measured about 20% faster than an identical second build. That is not a result. It is a fault in the harness. Do not use an in-process harness to decide.

Use two files. The worker times one build in one mode. The driver runs the worker for each build, and it changes the order of the runs.

```js
// bench-one.mjs: time ONE build in ONE mode. Usage: node bench-one.mjs <build> <mode> [rounds]
// Prints: <median> <p25> <p75> (ms per round)
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadInputs } from "./inputs.mjs";

const [buildPath, mode, roundsArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 25);
const module = await import(pathToFileURL(resolve(buildPath)).href);
const inputs = loadInputs(mode);

function time(run) {
  const start = process.hrtime.bigint();
  for (let n = 0; n < 200; n++) for (const input of inputs) run(input);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

time(module.run); // Warm up, then discard the result.
const times = [];
for (let round = 0; round < rounds; round++) times.push(time(module.run));
const at = (values, q) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * q)];
console.log(`${at(times, 0.5).toFixed(1)} ${at(times, 0.25).toFixed(1)} ${at(times, 0.75).toFixed(1)}`);
```

```js
// ab-proc.mjs: run each build in its own process. Usage: node ab-proc.mjs <base build> <candidate build> [runs] [rounds]
// Prints the median of the run medians for each build and mode, and the change.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const [basePath, candidatePath, runsArg, roundsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const rounds = Number(roundsArg ?? 25);

async function bench(build, mode) {
  const { stdout } = await exec(process.execPath, ["bench-one.mjs", build, mode, String(rounds)], {
    cwd: new URL(".", import.meta.url).pathname,
  });
  const [median, p25, p75] = stdout.trim().split(/\s+/).map(Number);
  return { median, p25, p75 };
}

const med = (values) => {
  const s = values.toSorted((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

for (const mode of ["large", "small"]) {
  const baseRuns = [];
  const candidateRuns = [];
  for (let i = 0; i < runs; i++) {
    baseRuns.push(await bench(basePath, mode));
    candidateRuns.push(await bench(candidatePath, mode));
  }
  const base = med(baseRuns.map((r) => r.median));
  const candidate = med(candidateRuns.map((r) => r.median));
  console.log(
    `${mode}: base ${base.toFixed(1)} ms, candidate ${candidate.toFixed(1)} ms, ` +
      `change ${(((candidate - base) / base) * 100).toFixed(1)}%`,
  );
}
```

Change `loadInputs` and `module.run` for the project. Set the number of repeats so that each round takes about 200 ms.

## Two input modes

Measure two modes when the loop runs on inputs of different sizes:

- **Many small inputs.** This mode shows the setup cost of each call.
- **One large input.** This mode shows the cost of the loop itself. It usually has less noise.

A change can help one mode and not the other. Report both.

## Noise

- **Know the noise.** Run the start build against itself before you measure any change. Do this in each mode. Record the band. A change that is smaller than the band is not a result. In planck.js, the noise band was about 1%: the large mode took about 222 ms per round, and the small mode took about 91 ms per round.
- **Know the bias.** Run a build against an exact copy of itself 3 times. If the median change is not near 0, the harness favors one slot. Do not subtract the bias from each result. A large bias means that the harness measures its own fault, not the code. Fix the harness. In planck.js, the in-process harness showed about 20% for identical builds. The cause was two module instances in one process. The fix was to run each build in its own process.
- **A quiet machine.** Do not run builds, tests, or other agents while the harness runs. A busy machine can move the median by 10%.
- **Overlapping ranges.** If the p25-p75 ranges of the two builds overlap, run the harness again before you decide.
- **Confirmation.** If a result is larger than 3%, run it again to confirm it.
- **The same build.** A change to comments or tags cannot change the speed. If such a change gives a large result, compare the built files byte for byte. If they are the same, the result is noise.
- **Two baselines.** Measure each commit against its parent commit to get its own effect. Measure it against the start build to get the total effect.

## The output check

The tests can miss a change in the output. A seeded comparison finds more. Run this check for each change, before you read the A/B result. A change that fails this check is not a candidate, no matter what the harness says. In planck.js, the check ran 225 seeded worlds, and the worst difference was 0.

1. Generate many inputs from a fixed seed. Use the characters and structures that the code handles, in random mixes. Use at least 100,000 inputs for a parser.
2. Run the start build and the current build on each input.
3. Compare the full output and the internal data that the public API gives, such as the tokens.
4. Run the comparison in each option set or mode of the program.
5. Print the seed and the first input that differs.

## Replaced methods and the public types

When users can replace methods or add extensions:

- **Calls:** make a seeded check that replaces a method in both builds. Record the arguments of each call, and compare the calls and the output.
- **Nested calls:** add a check for a replaced method that calls back into the library.
- **Types:** build the public type declarations of both builds, and compare the public method signatures. Internal parameters must not appear.

## The profile

- **Names:** profile an unminified build, so that the function names are real.
- **Self time:** sort the functions by self time.
- **A flat profile:** if no function has more than about 7% of the time, the cost is in the structure, for example a trial dispatch. Read the loop, not the functions.
