import type ts from "typescript";

export type HotFunction = ts.FunctionLikeDeclaration;

/** A class member that your engine calls on each frame or tick. Give exactly one owner key. */
export interface MethodRoot {
  kind: "method";
  owner: { implements: string } | { extends: string } | { name: string | RegExp };
  methods: string[];
  label: string;
}

/** A function that the code gives to a call, such as `useFrame(callback)`. */
export interface ArgumentRoot {
  kind: "argument";
  callee: string;
  index: number;
  label: string;
}

/** A callback that gives itself to a call from its own body, such as `requestAnimationFrame`. */
export interface SchedulerRoot {
  kind: "scheduler";
  callee: string;
  index: number;
  label: string;
}

export type Root = MethodRoot | ArgumentRoot | SchedulerRoot;

export interface FunctionContext {
  checker: ts.TypeChecker;
  owner: HotFunction;
  /** The call chain from a root to the owner, such as `Game.update > move`. */
  chain: string;
  isStrict: boolean;
  /** Reports a problem. A `// hot-path: allow <reason>` line above the node accepts it. */
  report(node: ts.Node, messageId: string): void;
}

export interface SourceFileContext {
  checker: ts.TypeChecker;
  isStrict: boolean;
  report(node: ts.Node, messageId: string): void;
}

export interface CallGraph {
  /** The roots for each label. The checker adds the labels "tagged" and "strict". */
  roots: ReadonlyMap<string, ReadonlySet<HotFunction>>;
  /** The functions that each hot function calls, including `@hotIgnore` functions. */
  callees: ReadonlyMap<HotFunction, ReadonlySet<HotFunction>>;
  chain(fn: HotFunction): string;
}

export interface FinishContext {
  checker: ts.TypeChecker;
  isStrict(sourceFile: ts.SourceFile): boolean;
  report(node: ts.Node, messageId: string, chain: string): void;
}

export interface PluginHooks {
  /** Runs once for each hot function. */
  checkFunction?(fn: HotFunction, context: FunctionContext): void;
  /** Runs for each node in the body of a hot function, except nested functions. */
  checkNode?(node: ts.Node, context: FunctionContext): void;
  /** Runs once for each project source file, hot or not. */
  checkSourceFile?(sourceFile: ts.SourceFile, context: SourceFileContext): void;
  /** Runs after the walk, with the call graph. */
  finish?(graph: CallGraph, context: FinishContext): void;
}

export interface Plugin {
  name: string;
  /** The message for each problem id. The ids are the baseline keys, so keep them stable. */
  messages?: Record<string, string>;
  roots?: Root[];
  /** Calls that return the function that they receive, such as React's `useCallback`. */
  functionHooks?: string[];
  /** Makes the hooks for one check. Keep the state of a check in the closure. */
  create?(program: ts.Program): PluginHooks;
}

export interface CheckOptions {
  /** The folder that the globs and the problem paths are relative to. */
  root: string;
  /** The default is every file. */
  include?: string[];
  /** The default is `DEFAULT_EXCLUDE`. */
  exclude?: string[];
  /** Every function in these files is a root, and the baseline accepts no problems in them. */
  strict?: string[];
  plugins?: Plugin[];
  roots?: Root[];
}

export interface Config extends Omit<CheckOptions, "root"> {
  /** The default is `tsconfig.json`. */
  tsconfig?: string;
  /** The default is `hot-path-baseline.json`. */
  baseline?: string;
}

export interface Problem {
  fileName: string;
  /** The path relative to the project root. */
  file: string;
  line: number;
  column: number;
  messageId: string;
  message: string;
  chain: string;
  strict: boolean;
}

export type Baseline = Record<string, Record<string, number>>;

export interface BaselineGroup {
  file: string;
  messageId: string;
  count: number;
  allowed: number;
}

export interface LoadedConfig {
  root: string;
  tsconfig: string;
  baseline: string;
  options: CheckOptions;
}

export const DEFAULT_EXCLUDE: string[];
export const walkerMessages: Record<string, string>;
export const core: Plugin;
export const presets: {
  browser: Plugin;
  webgpu: Plugin;
  react: Plugin;
  audioWorklet: Plugin;
};

export function defineConfig(config: Config): Config;
export function findConfig(directory: string): string | null;
export function loadConfig(configPath: string): Promise<LoadedConfig>;
export function createProgram(tsconfig: string): ts.Program;
export function readBaseline(baselinePath: string): Baseline;
export function checkHotPaths(program: ts.Program, options: CheckOptions): Problem[];
export function countProblems(problems: Problem[]): Baseline;
export function compareWithBaseline(
  problems: Problem[],
  baseline: Baseline,
): { grown: BaselineGroup[]; stale: BaselineGroup[] };
