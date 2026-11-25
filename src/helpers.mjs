export const READ = 1;
export const WRITE = 2;

export function normalize(fileName) {
  return fileName.replaceAll("\\", "/");
}

// The helpers read the syntax kinds and type flags of one TypeScript version, so each analysis
// makes its own set.
export function createHelpers(ts, checker) {
  const isFunctionLike = (node) =>
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node);

  const isStringLiteral = (node) =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

  const withoutParentheses = (expression) => {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
  };

  const isAssignmentTarget = (node) => {
    let current = node;
    while (
      current.parent &&
      (ts.isArrayLiteralExpression(current.parent) ||
        ts.isObjectLiteralExpression(current.parent) ||
        ts.isPropertyAssignment(current.parent) ||
        ts.isShorthandPropertyAssignment(current.parent) ||
        ts.isSpreadElement(current.parent) ||
        ts.isSpreadAssignment(current.parent))
    )
      current = current.parent;
    const parent = current.parent;
    return (
      (parent &&
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.left === current) ||
      (parent && ts.isForOfStatement(parent) && parent.initializer === current)
    );
  };

  // A property access reads the property, writes it, or both, as in `count += 1`.
  const accessKind = (node) => {
    let target = node;
    while (target.parent && ts.isParenthesizedExpression(target.parent)) target = target.parent;
    const parent = target.parent;
    if (
      parent &&
      ts.isBinaryExpression(parent) &&
      parent.left === target &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ? WRITE : READ | WRITE;
    if (
      parent &&
      (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken)
    )
      return READ | WRITE;
    return isAssignmentTarget(target) ? WRITE : READ;
  };

  // The text of a property name such as `a`, `"a"`, or `["a"]`, or "" for a computed name.
  const literalName = (name) => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression))
      return name.expression.text;
    return "";
  };

  // The method name of a call such as `a.b()` or `a["b"]()`, or "" for another callee.
  const calledMethod = (callee) => {
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    if (ts.isElementAccessExpression(callee) && isStringLiteral(callee.argumentExpression))
      return callee.argumentExpression.text;
    return "";
  };

  const symbolAt = (node) => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };

  const typeName = (type) => type.getSymbol()?.getName() ?? type.aliasSymbol?.getName() ?? "";

  // A receiver such as `texture?.` or `A | B` matches when one of its parts matches.
  const someType = (type, test) => {
    if (type.isUnion() || type.isIntersection())
      return type.types.some((part) => someType(part, test));
    // A generic receiver such as `T extends HTMLElement` matches by its constraint.
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = type.getConstraint();
      return constraint !== undefined && someType(constraint, test);
    }
    return test(type);
  };

  const isNamedType = (type, name) => someType(type, (part) => typeName(part) === name);

  const isNullish = (type) => (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0;

  const isNumberType = (type) => {
    if (type.isUnion()) return type.types.every(isNumberType);
    // A branded number such as `number & { brand }` is a number.
    if (type.isIntersection()) return type.types.some(isNumberType);
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = type.getConstraint();
      return constraint !== undefined && isNumberType(constraint);
    }
    return (type.flags & ts.TypeFlags.NumberLike) !== 0;
  };

  const isStringType = (type) => {
    const parts = type.isUnion() ? type.types : [type];
    return parts.some((part) => (part.flags & ts.TypeFlags.StringLike) !== 0);
  };

  const isIndexable = (type) => {
    const parts = type.isUnion() ? type.types : [type];
    return parts.every(
      (part) =>
        checker.isArrayType(part) ||
        checker.isTupleType(part) ||
        /^(?:Float|Int|Uint|BigInt|BigUint)\d+(?:Clamped)?Array$/.test(typeName(part)) ||
        isNullish(part),
    );
  };

  // An array-like type has a numeric `length`.
  const hasNumericLength = (type, node) => {
    const length = type.getProperty("length");
    return length !== undefined && isNumberType(checker.getTypeOfSymbolAtLocation(length, node));
  };

  const unionParts = (types) => types.flatMap((type) => (type.isUnion() ? type.types : [type]));
  const mixesNumbers = (parts) => parts.some(isNumberType) && parts.some(isNullish);

  // An array or tuple of numbers that also holds null or undefined loses the packed-double
  // storage in V8.
  const hasMixedNumbers = (type) => {
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = type.getConstraint();
      return constraint !== undefined && hasMixedNumbers(constraint);
    }
    if (type.isUnion()) return type.types.some((part) => !isNullish(part) && hasMixedNumbers(part));
    if (checker.isArrayType(type)) {
      const element = checker.getTypeArguments(type)[0];
      return element !== undefined && element.isUnion() && mixesNumbers(element.types);
    }
    if (checker.isTupleType(type)) return mixesNumbers(unionParts(checker.getTypeArguments(type)));
    return false;
  };

  const isLibraryDeclaration = (declaration) => {
    const file = declaration?.getSourceFile();
    return !file || file.isDeclarationFile;
  };

  const resolvedDeclaration = (call) => checker.getResolvedSignature(call)?.getDeclaration();

  return {
    accessKind,
    calledMethod,
    hasMixedNumbers,
    hasNumericLength,
    isAssignmentTarget,
    isFunctionLike,
    isIndexable,
    isLibraryDeclaration,
    isNamedType,
    isNumberType,
    isStringLiteral,
    isStringType,
    literalName,
    resolvedDeclaration,
    someType,
    symbolAt,
    typeName,
    withoutParentheses,
  };
}
