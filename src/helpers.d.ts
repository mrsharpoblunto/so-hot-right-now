import type ts from "typescript";

export const READ: 1;
export const WRITE: 2;
/** `READ`, `WRITE`, or both for a property access such as `count += 1`. */
export function accessKind(node: ts.Node): number;
/** The method name of a call such as `a.b()` or `a["b"]()`, or "" for another callee. */
export function calledMethod(callee: ts.Expression): string;
export function isAssignmentTarget(node: ts.Node): boolean;
export function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration;
export function isStringLiteral(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
export function literalName(name: ts.PropertyName): string;
/** The symbol at a node, with an import alias resolved. */
export function symbolAt(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined;
export function withoutParentheses(expression: ts.Expression): ts.Expression;

export function hasMixedNumbers(checker: ts.TypeChecker, type: ts.Type): boolean;
export function isIndexable(checker: ts.TypeChecker, type: ts.Type): boolean;
/** True when a declaration comes from a `.d.ts` file, such as a built-in method. */
export function isLibraryDeclaration(declaration: ts.Declaration | undefined): boolean;
/** True when the type, a part of a union, or a type parameter constraint has the name. */
export function isNamedType(type: ts.Type, name: string): boolean;
export function isNumberType(type: ts.Type): boolean;
export function isStringType(type: ts.Type): boolean;
export function resolvedDeclaration(
  checker: ts.TypeChecker,
  call: ts.CallLikeExpression,
): ts.Declaration | undefined;
export function someType(type: ts.Type, test: (part: ts.Type) => boolean): boolean;
export function typeName(type: ts.Type): string;
