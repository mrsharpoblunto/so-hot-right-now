/**
 * A syntax node from the project's TypeScript. TypeScript 5 and 6 give classic nodes. TypeScript 7
 * gives nodes from `typescript/unstable/ast`. Both have `kind`, `parent`, and the classic fields.
 */
export type Node = any;
export type SourceFile = any;
export type HotFunction = Node;

export interface Symbol {
  name: string;
  flags: number;
  getName(): string;
  declarations: readonly Node[] | undefined;
  valueDeclaration: Node | undefined;
}

export interface Type {
  /** Compare with `analysis.ts.TypeFlags`. The numbers differ between TypeScript versions. */
  flags: number;
  isUnion(): boolean;
  isIntersection(): boolean;
  /** The parts of a union or an intersection. */
  types: readonly Type[];
  aliasSymbol: Symbol | undefined;
  getSymbol(): Symbol | undefined;
  getConstraint(): Type | undefined;
  getProperty(name: string): Symbol | undefined;
  getCallSignatures(): readonly unknown[];
}

/** The checker methods that each backend has. A plugin must use only these. */
export interface Checker {
  getTypeAtLocation(node: Node): Type;
  getSymbolAtLocation(node: Node): Symbol | undefined;
  getAliasedSymbol(symbol: Symbol): Symbol;
  getResolvedSignature(call: Node): { getDeclaration(): Node | undefined } | undefined;
  getContextualType(node: Node): Type | undefined;
  getShorthandAssignmentValueSymbol(node: Node): Symbol | undefined;
  getTypeOfSymbolAtLocation(symbol: Symbol, node: Node): Type;
  isArrayType(type: Type): boolean;
  isTupleType(type: Type): boolean;
  getTypeArguments(type: Type): readonly Type[];
  getStringType(): Type;
}

export interface Helpers {
  /** `READ` (1), `WRITE` (2), or both for a property access such as `count += 1`. */
  accessKind(node: Node): number;
  /** The method name of a call such as `a.b()` or `a["b"]()`, or "" for another callee. */
  calledMethod(callee: Node): string;
  hasMixedNumbers(type: Type): boolean;
  hasNumericLength(type: Type, node: Node): boolean;
  isAssignmentTarget(node: Node): boolean;
  isFunctionLike(node: Node): boolean;
  isIndexable(type: Type): boolean;
  /** True when a declaration comes from a `.d.ts` file, such as a built-in method. */
  isLibraryDeclaration(declaration: Node | undefined): boolean;
  /** True when the type, a part of a union, or a type parameter constraint has the name. */
  isNamedType(type: Type, name: string): boolean;
  isNumberType(type: Type): boolean;
  isStringLiteral(node: Node): boolean;
  isStringType(type: Type): boolean;
  literalName(name: Node): string;
  resolvedDeclaration(call: Node): Node | undefined;
  someType(type: Type, test: (part: Type) => boolean): boolean;
  /** The symbol at a node, with an import alias resolved. */
  symbolAt(node: Node): Symbol | undefined;
  typeName(type: Type): string;
  withoutParentheses(expression: Node): Node;
}

/** One project, read by one TypeScript version. */
export interface Analysis {
  /**
   * The syntax module: `typescript` for TypeScript 5 and 6, or `typescript/unstable/ast` with the
   * flag enums for TypeScript 7. Use its `is*` guards, `SyntaxKind`, and `TypeFlags`.
   */
  ts: any;
  checker: Checker;
  helpers: Helpers;
  typescriptVersion: string;
  /** Asks for the types and symbols that a function usually needs in one batch. Only the native backend does work. */
  prefetch(fn: HotFunction): void;
  sourceFiles(include: (fileName: string) => boolean): SourceFile[];
  isExternalLibrary(sourceFile: SourceFile): boolean;
}

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
  checker: Checker;
  owner: HotFunction;
  /** The call chain from a root to the owner, such as `Game.update > move`. */
  chain: string;
  isStrict: boolean;
  /** Reports a problem. A `// hot-path: allow <reason>` line above the node accepts it. */
  report(node: Node, messageId: string): void;
}

export interface SourceFileContext {
  checker: Checker;
  isStrict: boolean;
  report(node: Node, messageId: string): void;
}

export interface CallGraph {
  /** The roots for each label. The checker adds the labels "tagged" and "strict". */
  roots: ReadonlyMap<string, ReadonlySet<HotFunction>>;
  /** The functions that each hot function calls, including `@hotIgnore` functions. */
  callees: ReadonlyMap<HotFunction, ReadonlySet<HotFunction>>;
  chain(fn: HotFunction): string;
}

export interface FinishContext {
  checker: Checker;
  isStrict(sourceFile: SourceFile): boolean;
  report(node: Node, messageId: string, chain: string): void;
}

export interface PluginHooks {
  /** Runs once for each hot function. */
  checkFunction?(fn: HotFunction, context: FunctionContext): void;
  /** Runs for each node in the body of a hot function, except nested functions. */
  checkNode?(node: Node, context: FunctionContext): void;
  /** Runs once for each project source file, hot or not. */
  checkSourceFile?(sourceFile: SourceFile, context: SourceFileContext): void;
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
  create?(analysis: Analysis): PluginHooks;
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
/** Reads the project with the TypeScript that the project folder resolves. Call `close` after the check. */
export function openProject(tsconfig: string): Promise<{ analysis: Analysis; close(): void }>;
/** Makes an analysis from a TypeScript 5 or 6 program. Pass the `typescript` module that made it. */
export function createClassicAnalysis(ts: any, program: any): Analysis;
/** Makes an analysis from a TypeScript 7 API project. */
export function createNativeAnalysis(
  typescript: { sync: any; ast: any; version: string },
  project: any,
): Analysis;
export function readBaseline(baselinePath: string): Baseline;
export function checkHotPaths(analysis: Analysis, options: CheckOptions): Problem[];
export function countProblems(problems: Problem[]): Baseline;
export function compareWithBaseline(
  problems: Problem[],
  baseline: Baseline,
): { grown: BaselineGroup[]; stale: BaselineGroup[] };
