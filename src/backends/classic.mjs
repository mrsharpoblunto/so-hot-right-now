import { createHelpers } from "../helpers.mjs";

// TypeScript 5 and 6 have the compiler API in the `typescript` module itself.
export function createClassicAnalysis(ts, program) {
  const checker = program.getTypeChecker();
  // Each TypeScript version can number its type flags differently, so the module must be the one
  // that made the program.
  if (checker.getStringType?.().flags !== ts.TypeFlags.String)
    throw new Error(
      `The program comes from a different TypeScript version than the \`ts\` module (${ts.version}). Pass the module that made the program.`,
    );
  return {
    ts,
    checker,
    helpers: createHelpers(ts, checker),
    typescriptVersion: ts.version,
    sourceFiles: (include) =>
      program.getSourceFiles().filter((sourceFile) => include(sourceFile.fileName)),
    isExternalLibrary: (sourceFile) => program.isSourceFileFromExternalLibrary(sourceFile),
  };
}
