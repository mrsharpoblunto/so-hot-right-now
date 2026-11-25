# Hot path rules

Each section is a message id. The baseline file uses these ids, so they do not change.

## Core

These rules apply in each project.

| Id | Problem | Fix |
| --- | --- | --- |
| `new` | A `new` expression. | Allocate once and reuse the object. |
| `object` | An object literal or an object spread. | Reuse a preallocated object, or write to typed arrays. |
| `array` | An array literal or an array spread. | Reuse a preallocated array. |
| `closure` | A function made inside a hot function. | Use a loop, or a method on a long-lived object. |
| `allocation` | A built-in that returns a new value, such as `map`, `filter`, `slice`, `Object.keys`, or `toFixed`. | Write into a reused buffer. Copy each field by hand. |
| `string` | A template literal or a `+` with a string. | Use numeric keys or indexes. |
| `compare` | A string comparison, a string `switch`, or a string method such as `startsWith` or `test`. | Use an integer enum. Compute it once when the data loads. |
| `hash` | A `Map` or `Set` call, a string-keyed lookup, or `in`. | Use an array indexed by a dense integer. |
| `iterator` | A `for...of` on a value that is not an array. | Iterate an array or a typed array with an index. |
| `spread` | An argument spread, such as `f(...values)`. | Pass fixed arguments. |
| `rest` | A rest parameter or a rest element in a destructuring pattern. | Pass fixed arguments, and read the fields that you need. |
| `generator` | A generator function. | Iterate arrays with an index. |
| `async` | An async function. Each call makes a promise. | Reuse a promise, or accept the line with a `hot-path: allow` reason. |
| `regex` | A regex literal. Each evaluation makes a new `RegExp`. | Move it to module scope. |
| `promise` | A `then`, `catch`, or `finally` call on a promise. | Do not chain promises in hot code. |
| `console` | A `console` call. | Remove it, or put it behind a debug flag in a `@hotIgnore` function. |
| `delete` | A `delete` expression. The object goes into slow dictionary mode. | Set the property to a sentinel value. |
| `arguments` | A read of `arguments`. | Use named parameters. |
| `numberKey` | A plain object used as an integer-keyed map. | Use an array. |
| `mixed` | An array of numbers that also holds `null` or `undefined`. The engine loses the packed number storage. | Use a typed array with a sentinel value. |

## Tag rules

| Id | Problem | Fix |
| --- | --- | --- |
| `untagged` | A hot path reaches a function that has no tag. | Read it. Tag it `@hot`, or `@hotIgnore <reason>`. |
| `reason` | A `@hotIgnore` tag without a reason. | Say when the function runs or what it costs. |
| `staleHot` | A `@hot` tag on a function that no hot path calls. | Remove the tag, or name the caller after `@hot` if it is a root. |
| `staleIgnore` | A `@hotIgnore` tag on a function that no hot code calls. | Remove the tag. Strict files do not get this problem. |
| `misplaced` | A tag that is not on a function or on a declaration that holds a function. | Move the tag to the function. |
| `allow` | A `hot-path: allow` comment without a reason. | Name the API that must allocate. |

## Presets

A project adds these rules with a preset in `hot-path.config.mjs`.

| Preset | Id | Problem | Fix |
| --- | --- | --- | --- |
| `browser` | `layout` | A DOM layout read, such as `getBoundingClientRect` or `offsetWidth`. The browser computes the layout in the middle of a frame. | Read it on a resize or an event, and keep the value. |
| `webgpu` | `gpu` | A WebGPU create call, such as `createBindGroup`, `createView`, or `createBuffer`. | Create the object once and reuse it. A command encoder and a pass are made each frame. |

The `browser` preset also makes a root of each `requestAnimationFrame` callback that schedules itself again.
The `react` preset lets a tag on `const f = useCallback(...)` apply to the function.
The `audioWorklet` preset makes a root of `process` on each `AudioWorkletProcessor` class.

A project plugin can add more ids. Read the project's `hot-path.config.mjs` to find them.
