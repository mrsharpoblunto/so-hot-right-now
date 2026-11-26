# Measure a change

A small speed change is easy to measure wrongly. Use an A/B harness, a known noise level, and an output check.

## The A/B harness

The harness loads two builds in one process. In each round, it times both builds, and it changes their order. It gives the median and the p25-p75 range for each build.

```js
// Usage: node ab.mjs <base build> <candidate build> [rounds]
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadInputs } from "./inputs.mjs";

const [basePath, candidatePath, roundsArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 25);
const inputs = loadInputs();

async function load(path) {
  // A query string gives each build its own module instance.
  const module = await import(`${pathToFileURL(resolve(path)).href}?${Math.random()}`);
  return (input) => module.run(input);
}

const builds = { base: await load(basePath), candidate: await load(candidatePath) };
for (const input of inputs)
  if (JSON.stringify(builds.candidate(input)) !== JSON.stringify(builds.base(input)))
    throw new Error("The candidate output differs from the base output.");

function time(run) {
  const start = process.hrtime.bigint();
  for (let n = 0; n < 200; n++) for (const input of inputs) run(input);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

for (const name in builds) time(builds[name]);
const results = { base: [], candidate: [] };
for (let round = 0; round < rounds; round++) {
  const order = round % 2 === 0 ? ["base", "candidate"] : ["candidate", "base"];
  for (const name of order) results[name].push(time(builds[name]));
}
const at = (values, q) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * q)];
const range = (values) => `${at(values, 0.25).toFixed(1)}-${at(values, 0.75).toFixed(1)}`;
const base = at(results.base, 0.5);
const candidate = at(results.candidate, 0.5);
console.log(
  `base ${base.toFixed(1)} ms (${range(results.base)}), ` +
    `candidate ${candidate.toFixed(1)} ms (${range(results.candidate)}), ` +
    `change ${(((candidate - base) / base) * 100).toFixed(1)}%`,
);
```

Change `loadInputs` and `module.run` for the project. Set the number of repeats so that each round takes about 200 ms.

## Two input modes

Measure two modes when the loop runs on inputs of different sizes:

- **Many small inputs.** This mode shows the setup cost of each call.
- **One large input.** This mode shows the cost of the loop itself. It usually has less noise.

A change can help one mode and not the other. Report both.

## Noise

- **Know the noise.** Run the start build against itself. The change must be larger than that result.
- **A quiet machine.** Do not run builds, tests, or other agents while the harness runs. A busy machine can move the median by 10%.
- **Overlapping ranges.** If the p25-p75 ranges of the two builds overlap, run the harness again before you decide.
- **Confirmation.** If a result is larger than 3%, run it again to confirm it.
- **The same build.** A change to comments or tags cannot change the speed. If such a change gives a large result, compare the built files byte for byte. If they are the same, the result is noise.
- **Two baselines.** Measure each commit against its parent commit to get its own effect. Measure it against the start build to get the total effect.

## The output check

The tests can miss a change in the output. A seeded comparison finds more:

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
