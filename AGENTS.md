# so-hot-right-now

This repo publishes a TypeScript hot path checker to npm, and agent skills for Claude Code and Codex.

# Layout

- `src/checker.mjs`: the call-graph walk and the tag rules.
- `src/backends/`: the classic backend (TypeScript 5 and 6) and the native backend (TypeScript 7). Each gives the same analysis interface.
- `src/project.mjs`: picks the backend for the TypeScript version that the project resolves.
- `src/rules/`: the core rules and the presets. Each one is a plugin.
- `src/cli.mjs`: the CLI commands.
- `src/index.d.ts`: the public types. Update them when the API changes.
- `plugins/so-hot-right-now/`: the plugin and its skills. The npm package and both agents use this folder.
- `examples/`: a project plugin and the junkship config. The tests use them.

# Rules

- Write docs, skills, and messages in ASD-STE100 simplified technical English.
- Do not change a message id. Projects use the ids as baseline keys.
- Keep the version in `package.json` and `plugins/so-hot-right-now/.claude-plugin/plugin.json` the same.
- Keep one manifest for both agents. Codex reads the Claude Code marketplace file.
- Do not import `typescript` in `src/`. Get `ts` and the checker from the analysis, so that the flags and kinds match the project.
- Use only the checker methods in the `Checker` type. The native backend has only these.
- Run each checker test on both backends.
- Write a comment only to explain why.

# Release

1. Set the same version in `package.json` and `plugins/so-hot-right-now/.claude-plugin/plugin.json`.
2. Commit, then push a tag such as `v0.2.0`. The release workflow stages the version on npm.
3. Approve the staged version on npmjs.com, or run `npm stage list` and `npm stage approve <stage-id>`.

# Commands

- `pnpm test`: run the unit tests.
- `pnpm lint`: run oxlint and the format check.
- `pnpm format`: format the code.
