import ts from "typescript";

export const ROOT = "/project";

// The project files stay in memory. The host reads only the TypeScript lib files from disk.
export function createTestProgram(files) {
  const options = { strict: true, noEmit: true };
  const host = ts.createCompilerHost(options);
  const sources = new Map(Object.entries(files).map(([name, text]) => [`${ROOT}/${name}`, text]));
  const getSourceFile = host.getSourceFile;
  host.getCurrentDirectory = () => ROOT;
  host.fileExists = (name) => sources.has(name) || ts.sys.fileExists(name);
  host.readFile = (name) => sources.get(name) ?? ts.sys.readFile(name);
  host.getSourceFile = (name, version, onError, create) =>
    sources.has(name)
      ? ts.createSourceFile(name, sources.get(name), version, true)
      : getSourceFile(name, version, onError, create);
  return ts.createProgram([...sources.keys()], options, host);
}
