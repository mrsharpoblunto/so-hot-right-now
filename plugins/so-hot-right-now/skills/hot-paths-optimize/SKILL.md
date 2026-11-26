---
name: hot-paths-optimize
description: Make a program faster with the so-hot-right-now checker. Run a measured loop that changes the data model until the main loop runs through hot code, and drive the problem count, the `@hotIgnore` tags, and the allow comments down. Use when the user asks to optimize a hot path, to lower the baseline or the number of tags, or to make a frame, tick, parse, or request loop faster.
---

# Optimize a hot path

The checker reports the code that makes the main loop slow. Its problems are a signal about the design, not a list of lines to silence.

- **A group of problems has one cause.** Many `slice`, `compare`, and `string` problems in one module usually come from one data model. Examples are a model that keeps text where it could keep offsets, or that dispatches on strings where it could use integers.
- **Tags and allow comments give no speed.** They only hide the problems from the count.
- **A local fix to one line gives little speed.** The large gains come when the whole loop runs through code that obeys the rules. To get there, change the data model, and move the work that cannot obey the rules out of the loop.

Read the `hot-paths` skill for the tags, the rules, and the commands. This skill gives the loop that uses them.

## Before you start

1. **Roots.** Check that the roots in `hot-path.config.mjs` are the entry points of the loop that you will make faster. Examples are the frame callback, the system `run` method, or the `parse` function.
2. **Benchmark.** Find a benchmark that runs the loop on fixed inputs, or write one. Read `measure.md` in this skill folder. Make a process-separated A/B harness that compares a fixed start build with the current build. Each build runs in its own process.
3. **Output check.** Make a seeded comparison that runs the start build and the current build on many generated inputs, and compares their output. Read `measure.md`.
4. **Start build.** Save a copy of the start build. Measure it against itself in each mode, before you measure any change, so that you know the noise band of the benchmark.
5. **Profile.** Profile the start build, so that you know where the time goes. Use an unminified build, so that the names are real.

## The loop

Do these steps for each change:

1. **Sort the problems by cause.** Run `report --format json`, and group the problems by the code that causes them, not by line. A table of count, cause, and file shows which redesign removes the most problems.
2. **Choose a group.** Choose the group that removes the most problems in the functions with the most profile time.
3. **Redesign.** Change the data model so that the code no longer needs the slow operation. Read `redesign.md` in this skill folder for the usual causes and their redesigns.
4. **Commit.** Make one commit for each change that you measure.
5. **Check.** Run the tests, the seeded output comparison, and a functional check of the behavior that you changed. The tests and the harness do not show a silent loss of behavior. In planck.js, an event refactor stopped engine events from firing, and only a functional check found it.
6. **Measure.** Run the A/B harness against the start build and against the parent commit. Run the checker, and record the count.
7. **Decide.** Use the rules in "Keep or revert".

After each group, profile again. A redesign moves the cost, so the next large cost can be in a different place.

## Keep or revert

- **A change that removes problems, with no speed change:** keep it. It moves the code toward a loop that obeys the rules.
- **A change that is slower in two runs:** find a different fix. Revert it only if you cannot find a better fix.
- **A commit in the middle of a large redesign:** do not decide on it alone. It can be slower until the redesign is complete. Decide at the end point of the redesign.
- **A small result:** if the p25-p75 ranges overlap, run the harness again before you decide. If a result is larger than 3%, run it again to confirm it.
- **A change that helps one mode and hurts the other:** report both modes, and fix the cause. In planck.js, an event refactor helped the large mode but made the small mode 1.7% slower. The cause was a spread of the event map on each `World` creation.

## Do not take shortcuts

These shortcuts make the count go down and give no speed:

- **Tags on the current design.** Do not tag a function `@hotIgnore` or a line `// hot-path: allow` with a reason that describes what the code does now. "This check reads the syntax as text" and "The renderer builds a string" are not reasons. They describe the design that you must change.
- **`@hot` without a review.** Do not tag a function `@hot` until you have read it and fixed it.
- **A stop after a few commits.** One small commit is not a result. Continue until a stop condition is true.
- **A "not possible" without a redesign.** Before you say that a problem cannot be fixed, try a different data model for that module. If you still cannot fix it, leave the problem in the report, and give the file, the line, and the reason.
- **A blocker taken as the end.** A blocker often names the next change to the data model. For example, "the regex needs one contiguous string" means that the code needs scanners that read a line model. Profile, and if the blocker is in the slow code, make that change next.

## Where a tag is correct

A tag is correct only for code that the loop must run and that cannot obey the rules. Give the limit of the cost in the reason.

- **An output function.** It makes the result that the caller needs, such as a token, a draw command, or the output string. Send all output through a few small functions, so that a few tags cover it. Example: `/** @hotIgnore Output: one token for each block. */`
- **A user adapter.** It connects user code, or a public API, to the internal model. Example: `/** @hotIgnore User adapter: one string copy for each replaced method call. */`
  A built-in option, such as a strict or a legacy mode, is not user code. Before you tag an adapter, check which built-in options use it. Give each built-in option its own hot code.
- **A rare event.** Examples are a load, a resize, or an error, behind a guard in the hot caller.
- **A platform API that must allocate.** Use an allow comment on that line.

## A public API

The internal model can change even when the public API cannot.

- **One path.** Keep one internal path. Do not keep the old path beside the new one for some callers.
- **Adapters for replaced parts.** When a user can replace a method or add an extension, wrap it in an adapter that converts between the public API and the internal model. The adapter can be slower than the default code. Tag it as a user adapter. The internal code stays `@hot`.
- **Choose at setup.** Choose the default method or the adapter one time, at setup. Put it in a slot. Do not test for a replaced method on each call.
- **Check the API.** Compare the public type declarations of the start build and the current build. Keep internal parameters, such as an offset, out of the public types.
- **Check serializers and stored formats.** When you change an internal representation, check each place that reads the internal value, such as a serializer, a deserializer, or a saved file. In planck.js, storing the body type as an integer broke the serializer, which wrote the internal integer where the format needs the public string. The round-trip test caught it.
- **Check the adapters.** Add a seeded check that a replaced method still gets the same calls and gives the same output.

## When to stop

Stop when one of these is true:

- **Only correct problems are left.** Each problem is in an output function, a user adapter, a rare event, or an exception that you listed with a reason.
- **No more progress.** Three structural changes in a row give no speed gain and remove no problems.

Then run the A/B harness 3 times in each mode, run the checker, and profile again.

## What the checker cannot see

The checker reads one function at a time. It cannot see these costs:

- **Trial dispatch.** The code tries many handlers in order until one matches. Each handler can obey the rules, but the loop still does work that it does not need. Dispatch on a key, such as the first character or an integer kind.
- **Repeated work.** Examples are a scan of the same data two times, or a copy for each step.

Use the profile for these costs. A problem count that does not change is not a sign that a change gave no speed. A count that goes down is not a sign of speed.

The checker can also lose a call. Suspect a checker gap in these cases:

- **The profile shows a slow function that is not in the report.** Run `report`, and look for the function in the call chains.
- **A change of the dispatch gives `staleHot` or `staleIgnore` problems.** The checker can no longer follow the call to that function. Treat this as a red flag, not a win. In planck.js, a stored callback removed a closure problem but made 6 hot functions invisible to the checker, so the fix was reverted. If functions that were hot become `staleHot` after your change, revert the change and find a fix that keeps the call visible.
- **The count goes down by much more than the change explains.** Compare the functions in the call chains before and after the change.

Do not take a lower count as a fix until you have done these checks. Report a checker gap to the so-hot-right-now project, with a small example.

## Report

Report both measures for each commit: the A/B change with the p25-p75 ranges, and the problem count. At the end, give these items:

- Each tag that is left, with its file, its line, and its reason.
- Each problem that is left, with the reason.
- Each change to the public API or to the tests.
- The costs that the profile showed and the checker did not report.

## When you give the work to another agent

- Give it the commands for the build, the tests, the output check, the harness, and the checker.
- Give it an end point and the stop conditions.
- Tell it not to end its turn before the end point, unless it finds a blocker.
- Give a large redesign as separate steps, each with its own end point.
- Measure its result yourself on a quiet machine before you report it.
- Keep the output check in a file that you own, and give the agent its path. Run it yourself on each result. An agent that writes its own generator tests the cases that it thought of, and it can miss a regression for many rounds.
- Give the agent the setting for a long task, such as a high reasoning effort. At a low effort, an agent can stop early and keep the old code as a fallback.
