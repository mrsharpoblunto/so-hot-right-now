import ts from "typescript";

import {
  calledMethod,
  isAssignmentTarget,
  isStringLiteral,
  withoutParentheses,
} from "../syntax.mjs";
import {
  hasMixedNumbers,
  hasNumericLength,
  isIndexable,
  isLibraryDeclaration,
  isNamedType,
  isNumberType,
  isStringType,
  resolvedDeclaration,
  typeName,
} from "../types.mjs";

const ALLOCATING_METHODS = new Set([
  "map",
  "filter",
  "slice",
  "subarray",
  "concat",
  "flat",
  "flatMap",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
  "split",
  "join",
  "bind",
  "from",
  "of",
  "keys",
  "values",
  "entries",
  "fromEntries",
  "assign",
  "structuredClone",
  "stringify",
  "parse",
  "padStart",
  "padEnd",
  "toFixed",
  "toString",
  "trim",
  "replace",
  "replaceAll",
  "toLowerCase",
  "toUpperCase",
]);
const HASH_TYPES = new Set(["Map", "Set", "WeakMap", "WeakSet", "ReadonlyMap", "ReadonlySet"]);
const HASH_METHODS = new Set(["get", "set", "has", "delete", "add"]);
const STRING_COMPARE_METHODS = new Set([
  "startsWith",
  "endsWith",
  "includes",
  "indexOf",
  "lastIndexOf",
  "localeCompare",
  "match",
  "search",
  "test",
]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const ORDERING = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

function isHashType(type) {
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((part) => HASH_TYPES.has(typeName(part)));
}

export const core = {
  name: "core",
  messages: {
    new: "Do not call `new` in a hot path. Allocate once and reuse the object.",
    object:
      "Do not create an object literal in a hot path. Reuse a preallocated object or write to typed arrays.",
    array: "Do not create an array literal in a hot path. Reuse a preallocated array.",
    allocation:
      "Do not call an allocating built-in in a hot path. Write into a reused buffer instead.",
    string: "Do not build strings in a hot path. Use numeric keys or indexes.",
    compare: "Do not compare strings in a hot path. Use an integer enum instead.",
    hash: "Do not use a Map, Set, or string-keyed lookup in a hot path. Use an array indexed by a dense integer.",
    iterator:
      "Do not iterate a non-array in a hot path. Iterate an array or typed array with an index.",
    spread: "Do not spread arguments in a hot path. Pass fixed arguments.",
    rest: "Do not collect a rest parameter or a rest binding in a hot path. Pass fixed arguments and read the fields you need.",
    generator: "Do not use a generator in a hot path. Iterate arrays with an index.",
    async:
      "An async function allocates a promise on each call. Reuse a promise, or accept it with a `hot-path: allow` reason.",
    regex:
      "Do not use a regex literal in a hot path. It makes a new RegExp each time. Move it to module scope.",
    promise: "Do not chain a promise in a hot path. Each call allocates a promise.",
    console: "Do not call `console` in a hot path.",
    delete:
      "Do not use `delete` in a hot path. It puts the object in slow dictionary mode. Set the property to a sentinel value.",
    arguments: "Do not read `arguments` in a hot path. Use named parameters.",
    numberKey: "Do not use a plain object as an integer-keyed map in a hot path. Use an array.",
    mixed:
      "Do not mix numbers with null or undefined in an array that a hot path reads. Use a typed array with a sentinel value.",
  },
  create(program) {
    const checker = program.getTypeChecker();
    const typeAt = (node) => checker.getTypeAtLocation(node);

    const checkBinary = (node, report) => {
      const operator = node.operatorToken.kind;
      if (
        (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.PlusEqualsToken) &&
        (isStringType(typeAt(node.left)) || isStringType(typeAt(node.right)))
      )
        report(node, "string");
      if (EQUALITY.has(operator)) {
        const other = isStringLiteral(node.left)
          ? node.right
          : isStringLiteral(node.right)
            ? node.left
            : null;
        if (other) {
          if (!ts.isTypeOfExpression(other)) report(node, "compare");
        } else if (
          !ts.isTypeOfExpression(node.left) &&
          !ts.isTypeOfExpression(node.right) &&
          isStringType(typeAt(node.left)) &&
          isStringType(typeAt(node.right))
        )
          report(node, "compare");
      }
      if (
        ORDERING.has(operator) &&
        isStringType(typeAt(node.left)) &&
        isStringType(typeAt(node.right))
      )
        report(node, "compare");
      if (operator === ts.SyntaxKind.InKeyword) report(node, "hash");
      if (operator === ts.SyntaxKind.EqualsToken) {
        const target = withoutParentheses(node.left);
        if (ts.isArrayLiteralExpression(target) && hasMixedNumbers(checker, typeAt(node.right)))
          report(target, "mixed");
      }
    };

    const checkCall = (node, report) => {
      const callee = node.expression;
      const method = calledMethod(callee);
      if (method === "") return;
      const receiver = typeAt(callee.expression);
      if (PROMISE_METHODS.has(method) && isNamedType(receiver, "Promise")) report(node, "promise");
      if (isNamedType(receiver, "Console")) report(node, "console");
      const fromLibrary = isLibraryDeclaration(resolvedDeclaration(checker, node));
      if (HASH_METHODS.has(method) && isHashType(receiver)) report(node, "hash");
      else if (
        STRING_COMPARE_METHODS.has(method) &&
        fromLibrary &&
        (isStringType(receiver) || typeName(receiver) === "RegExp")
      )
        report(node, "compare");
      else if (ALLOCATING_METHODS.has(method) && fromLibrary) report(node, "allocation");
    };

    return {
      checkFunction(owner, context) {
        if (owner.asteriskToken) context.report(owner, "generator");
        for (const parameter of owner.parameters)
          if (parameter.dotDotDotToken) context.report(parameter, "rest");
        if (owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword))
          context.report(owner, "async");
      },
      checkNode(node, context) {
        const report = context.report;
        if (ts.isNewExpression(node)) report(node, "new");
        if (ts.isRegularExpressionLiteral(node)) report(node, "regex");
        if (ts.isDeleteExpression(node)) report(node, "delete");
        // The arguments object has no declaration. A property named `arguments` has one.
        if (ts.isIdentifier(node) && node.text === "arguments") {
          const symbol = checker.getSymbolAtLocation(node);
          if (symbol !== undefined && !symbol.declarations?.length) report(node, "arguments");
        }
        if (ts.isElementAccessExpression(node)) {
          const target = typeAt(node.expression);
          const key = typeAt(node.argumentExpression);
          if (
            isNumberType(key) &&
            !isIndexable(checker, target) &&
            !isStringType(target) &&
            !hasNumericLength(checker, target, node)
          )
            report(node, "numberKey");
          if (hasMixedNumbers(checker, target)) report(node, "mixed");
          if (
            !isStringLiteral(node.argumentExpression) &&
            isStringType(key) &&
            !isIndexable(checker, target)
          )
            report(node, "hash");
        }
        // A destructuring read is a read of each name.
        if (ts.isArrayBindingPattern(node) && hasMixedNumbers(checker, typeAt(node)))
          report(node, "mixed");
        if (
          (ts.isBindingElement(node) && node.dotDotDotToken) ||
          ((ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) && isAssignmentTarget(node))
        )
          report(node, "rest");
        if (ts.isObjectLiteralExpression(node) && !isAssignmentTarget(node)) report(node, "object");
        if (ts.isArrayLiteralExpression(node) && !isAssignmentTarget(node)) report(node, "array");
        if (ts.isTemplateExpression(node)) report(node, "string");
        if (ts.isBinaryExpression(node)) checkBinary(node, report);
        if (
          ts.isSwitchStatement(node) &&
          node.caseBlock.clauses.some(
            (clause) => ts.isCaseClause(clause) && isStringLiteral(clause.expression),
          )
        )
          report(node, "compare");
        if (ts.isForOfStatement(node)) {
          const type = typeAt(node.expression);
          if (!isIndexable(checker, type)) report(node.expression, "iterator");
          if (hasMixedNumbers(checker, type)) report(node.expression, "mixed");
        }
        if (
          ts.isSpreadElement(node) &&
          node.parent &&
          (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
        )
          report(node, "spread");
        if (ts.isCallExpression(node)) checkCall(node, report);
      },
    };
  },
};
