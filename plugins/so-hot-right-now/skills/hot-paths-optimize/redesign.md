# Causes and redesigns

Each row gives a cause of a group of problems, and a change in the data model that removes the cause.
The fix in `hot-paths/rules.md` is for one problem. These redesigns are for a module that has many problems with one cause.

## Text and strings

| Cause                                                                                                           | Problems               | Redesign                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The code moves forward with `src = src.slice(n)` or `substring`, and chains such as `trim().replace().slice()`. | `allocation`, `string` | Keep one source string and an integer offset. Read at the offset. Make each output string one time, from a start and an end offset, in one helper function.                      |
| The code tests the input with a regex, such as `rule.test(src)`, or with `startsWith`.                          | `compare`, `regex`     | Scan with `charCodeAt` at the offset, and compare integers. If a rule is too complex for a scanner, use a sticky (`y`) regex with `lastIndex`, and list the regex with a reason. |
| The code compares strings, such as `ch === "*"` or `token.type === "list"`.                                     | `compare`              | Compare character codes. Give each kind an integer, and dispatch with a `switch` or a table.                                                                                     |
| The code builds the output with `+`, template literals, or `join` in many functions.                            | `string`               | Send the output through one `emit` function, into one buffer for each call of the loop. Tag `emit` as an output function.                                                        |
| The code looks up values by string keys, such as `table[ch]`.                                                   | `hash`                 | Use a `switch` on the integer, or an array that a dense integer indexes. Keep a keyed map only for keys that come from user data, such as names.                                 |

## Dispatch and setup

| Cause                                                                                   | Problems                                                 | Redesign                                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The loop tries many handlers in order until one matches.                                | The checker does not see this cost. The profile is flat. | Read a key one time, such as the first character or the kind. Call only the handlers that can match that key. |
| The code tests the configuration or a replaced method on each call.                     | `compare`                                                | Choose the method one time, at setup, and put it in a slot. The loop calls the slot.                          |
| The code makes a closure or a callback for each call, such as `list.some(item => ...)`. | `closure`                                                | Write an indexed loop. Put the state in a long-lived object with a method.                                    |
| The code makes a new worker object for each call, such as a lexer or a parser.          | `new`                                                    | Make it one time for each instance, and reset its state at the start of each call.                            |

## Objects and arrays

| Cause                                                                                          | Problems              | Redesign                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| The code makes a temporary object or array to return two values or to hold state for one step. | `object`, `array`     | Return one value, and write the others into fields of a long-lived object. Or keep the state in a typed array.                         |
| The code makes an object that is the output, such as a token or a draw command.                | `object`              | Make each kind in one factory function. Tag the factory as an output function, and give the limit, such as "one token for each block". |
| The code copies an array to count or to search it, such as `[...text].length`.                 | `array`, `allocation` | Count or search with an indexed loop.                                                                                                  |
| The code makes many small objects with the same fields on each frame.                          | `object`              | Keep the fields in typed arrays, one array for each field, that an entity index indexes.                                               |

## Order of work

1. **The data model first.** Start with the redesign that removes the cause of the largest group, such as offsets in place of text copies. The other fixes are easier after that.
2. **Then the dispatch.** Change the dispatch and the setup, so that the loop calls only the code that it needs.
3. **Then the output.** Send the output through the output functions.
4. **The small groups last.** Fix closures, temporary objects, and lookups.
5. **The tags at the end.** Read each function that the checker reports as untagged. Fix it, and then tag it `@hot`.
