# Plugins

A plugin adds rules, roots, or function hooks to the checker. The presets are plugins.
Write a project plugin for a rule that only your project needs.

## Shape

```js
export const myPlugin = {
  name: "my-plugin",
  // The message for each problem id. The baseline uses the ids, so keep them stable.
  messages: { slowCall: "Do not call `slowCall` in a hot path." },
  // More roots. They have the same format as the `roots` in the config.
  roots: [],
  // Calls that return the function that they receive, such as `useCallback`.
  functionHooks: [],
  // Makes the hooks for one check.
  create(program) {
    const checker = program.getTypeChecker();
    return {
      checkFunction(fn, context) {},
      checkNode(node, context) {},
      checkSourceFile(sourceFile, context) {},
      finish(graph, context) {},
    };
  },
};
```

Each field except `name` is optional. Two plugins cannot use the same message id.
Give your ids a prefix if you publish the plugin, for example `myPluginSlowCall`.

## Hooks

The checker calls the hooks in this order:

1. `checkSourceFile(sourceFile, context)` runs once for each project file, hot or not. Use it for a rule about module structure.
2. `checkFunction(fn, context)` runs once for each hot function. Use it for a rule about the signature.
3. `checkNode(node, context)` runs for each node in the body of a hot function. It does not run in a nested function, because the core reports the closure.
4. `finish(graph, context)` runs once after the walk. Use it for a rule that needs the call graph.

The checker does not enter type nodes, `throw` statements, or `catch` blocks.

## Context

- `context.checker` is the TypeScript type checker.
- `context.report(node, messageId)` records a problem. A `// hot-path: allow <reason>` line above the node accepts it.
- `context.isStrict` is `true` in a strict file.
- In `checkFunction` and `checkNode`, `context.owner` is the hot function, and `context.chain` is its call chain from a root.
- In `finish`, `context.report(node, messageId, chain)` takes the chain, and `context.isStrict(sourceFile)` is a function.

## The call graph

`finish` gets a graph with these fields:

- `roots`: a map from each label to its root functions. The checker adds the label `tagged` for `@hot <caller>` roots and `strict` for the roots in strict files.
- `callees`: a map from each hot function to the functions that it calls. It includes calls to `@hotIgnore` functions.
- `chain(fn)`: the call chain from a root to a hot function.

## State

`create` runs once for each check. Keep the state of a check in its closure, so that two checks do not share it.

## Helpers

`@thestraylight/so-hot-right-now/helpers` exports the type and syntax tests that the presets use. Some examples:

- `calledMethod(callee)` gives the method name of `a.b()` or `a["b"]()`.
- `isNamedType(type, name)` finds the name in a union or a type parameter constraint.
- `isLibraryDeclaration(declaration)` is `true` for a built-in from a `.d.ts` file.

## Example

`examples/ecs-plugin.mjs` in the repository has two project rules:

- `query`: a `defineQuery` call inside a function, in any file.
- `worldWrite`: a `World` write that a `frame` or `tagged` root reaches without a `simulation` root between them.
