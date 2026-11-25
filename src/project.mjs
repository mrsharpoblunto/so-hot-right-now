import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClassicAnalysis } from "./backends/classic.mjs";
import { createNativeAnalysis } from "./backends/native.mjs";

// The project's own TypeScript reads the project, so the types match the project's compiler.
function resolveTypeScript(tsconfig) {
  const require = createRequire(path.join(path.dirname(tsconfig), "noop.js"));
  let manifest;
  try {
    manifest = require.resolve("typescript/package.json");
  } catch {
    throw new Error(
      `Found no typescript package for ${tsconfig}. Install typescript in the project.`,
    );
  }
  const { version } = JSON.parse(readFileSync(manifest, "utf8"));
  const load = async (specifier) => import(pathToFileURL(require.resolve(specifier)).href);
  return { version, major: Number(version.split(".")[0]), load };
}

function openClassic(ts, tsconfig) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return { analysis: createClassicAnalysis(ts, program), close: () => {} };
}

// TypeScript 7 has no compiler API in the `typescript` module. Its `unstable/sync` API runs the
// native compiler in a child process, which `close` stops.
function openNative(typescript, tsconfig) {
  const api = new typescript.sync.API({ cwd: path.dirname(tsconfig) });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
    const project = snapshot.getProject(tsconfig) ?? snapshot.getProjects()[0];
    if (!project) throw new Error(`TypeScript ${typescript.version} could not open ${tsconfig}.`);
    return { analysis: createNativeAnalysis(typescript, project), close: () => api.close() };
  } catch (error) {
    api.close();
    throw error;
  }
}

export async function openProject(tsconfig) {
  const file = path.resolve(tsconfig);
  const resolved = resolveTypeScript(file);
  if (resolved.major >= 7) {
    const [sync, ast] = await Promise.all([
      resolved.load("typescript/unstable/sync"),
      resolved.load("typescript/unstable/ast"),
    ]);
    return openNative({ sync, ast, version: resolved.version }, file);
  }
  const ts = (await resolved.load("typescript")).default;
  return openClassic(ts, file);
}
