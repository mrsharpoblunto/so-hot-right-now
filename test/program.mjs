import ts6 from "typescript-6";
import { version as version7 } from "typescript-7";
import * as ast7 from "typescript-7/unstable/ast";
import * as sync7 from "typescript-7/unstable/sync";

import { createClassicAnalysis, createNativeAnalysis } from "@thestraylight/so-hot-right-now";

export const ROOT = "/project";
export const BACKENDS = ["classic", "native"];

const compilerOptions = { strict: true, noEmit: true };

// The project files stay in memory. Both hosts read only the TypeScript lib files from disk.
function classic(sources) {
  const host = ts6.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile;
  host.getCurrentDirectory = () => ROOT;
  host.fileExists = (name) => sources.has(name) || ts6.sys.fileExists(name);
  host.readFile = (name) => sources.get(name) ?? ts6.sys.readFile(name);
  host.getSourceFile = (name, version, onError, create) =>
    sources.has(name)
      ? ts6.createSourceFile(name, sources.get(name), version, true)
      : getSourceFile(name, version, onError, create);
  const program = ts6.createProgram([...sources.keys()], compilerOptions, host);
  return { analysis: createClassicAnalysis(ts6, program), close: () => {} };
}

function native(sources) {
  const tsconfig = `${ROOT}/tsconfig.json`;
  const files = new Map(sources);
  files.set(tsconfig, JSON.stringify({ compilerOptions, files: [...sources.keys()] }));
  const directories = new Set(
    [...files.keys()].map((name) => name.slice(0, name.lastIndexOf("/"))),
  );
  // `undefined` falls back to the real file system, where the native compiler keeps its lib files.
  const api = new sync7.API({
    cwd: ROOT,
    fs: {
      readFile: (name) => files.get(name),
      fileExists: (name) => (files.has(name) ? true : undefined),
      directoryExists: (name) => (directories.has(name) ? true : undefined),
    },
  });
  const project = api.updateSnapshot({ openProjects: [tsconfig] }).getProjects()[0];
  const typescript = { sync: sync7, ast: ast7, version: version7 };
  return { analysis: createNativeAnalysis(typescript, project), close: () => api.close() };
}

const open = [];

export function createTestAnalysis(files, backend) {
  const sources = new Map(Object.entries(files).map(([name, text]) => [`${ROOT}/${name}`, text]));
  const opened = backend === "native" ? native(sources) : classic(sources);
  open.push(opened);
  return opened.analysis;
}

export function closeTestAnalyses() {
  while (open.length > 0) open.pop().close();
}
