import ts from "typescript";

export const READ = 1;
export const WRITE = 2;

export function normalize(fileName) {
  return fileName.replaceAll("\\", "/");
}

export function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

export function tagText(tag) {
  return ts.getTextOfJSDocComment(tag.comment)?.trim() ?? "";
}

export function isNested(node) {
  return ts.findAncestor(node.parent, isFunctionLike) !== undefined;
}

// The class member that a function implements: a method, or a property whose initializer is
// the function.
export function classMember(node) {
  if (ts.isMethodDeclaration(node)) return node;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.parent &&
    ts.isPropertyDeclaration(node.parent) &&
    node.parent.initializer === node
  )
    return node.parent;
  return null;
}

export function memberName(member) {
  return member.name && ts.isIdentifier(member.name) ? member.name.text : "";
}

export function heritageNames(classNode, token) {
  const names = [];
  for (const clause of classNode.heritageClauses ?? [])
    if (clause.token === token)
      for (const type of clause.types)
        if (ts.isIdentifier(type.expression)) names.push(type.expression.text);
  return names;
}

// The text of a property name such as `a`, `"a"`, or `["a"]`, or "" for a computed name.
export function literalName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression))
    return name.expression.text;
  return "";
}

export function withoutParentheses(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

export function isStringLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

export function isAssignmentTarget(node) {
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
}

// A property access reads the property, writes it, or both, as in `count += 1`.
export function accessKind(node) {
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
}

export function symbolAt(checker, node) {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

// A function hook such as React's `useCallback` returns the function that it receives, so a
// tag on the variable that holds the hook result applies to the function.
export function createSyntax(checker, functionHooks) {
  const isFunctionHook = (node) =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    functionHooks.has(node.expression.text);

  const holdsFunction = (node) =>
    ts.isParenthesizedExpression(node) ||
    ts.isExportAssignment(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isVariableDeclarationList(node) ||
    ts.isVariableStatement(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    isFunctionHook(node);

  // A tag belongs to the function, or to the declaration whose initializer is the function.
  // A class or an object tag does not apply to its members.
  const findTag = (node, name) => {
    for (let current = node; current; current = current.parent) {
      if (current !== node && !holdsFunction(current)) return null;
      const tag = ts.getJSDocTags(current).find((candidate) => candidate.tagName.text === name);
      if (tag) return tag;
    }
    return null;
  };

  // `seen` stops a cycle of names such as `var a = b; var b = a;`.
  const resolveBody = (declaration, seen) => {
    if (seen.has(declaration)) return null;
    seen.add(declaration);
    if (isFunctionLike(declaration) && declaration.body) return declaration;
    if (
      !ts.isVariableDeclaration(declaration) &&
      !ts.isPropertyDeclaration(declaration) &&
      !ts.isPropertyAssignment(declaration)
    )
      return null;
    let initializer = declaration.initializer;
    while (initializer && ts.isParenthesizedExpression(initializer))
      initializer = initializer.expression;
    if (initializer && isFunctionHook(initializer)) initializer = initializer.arguments[0];
    if (!initializer) return null;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer;
    if (!ts.isIdentifier(initializer)) return null;
    const target = symbolAt(checker, initializer)?.valueDeclaration;
    return target ? resolveBody(target, seen) : null;
  };

  // A declaration whose initializer names a function, such as `prepare = allocate`, has the
  // body of that function.
  const bodyOf = (declaration) => resolveBody(declaration, new Set());

  const functionOf = (expression) => {
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
    if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) return null;
    const declaration = symbolAt(
      checker,
      ts.isPropertyAccessExpression(expression) ? expression.name : expression,
    )?.valueDeclaration;
    return declaration ? bodyOf(declaration) : null;
  };

  const tagsFunction = (node) => {
    if (isFunctionLike(node)) return true;
    if (ts.isVariableStatement(node))
      return node.declarationList.declarations.some((declaration) => bodyOf(declaration) !== null);
    if (
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertyAssignment(node)
    )
      return bodyOf(node) !== null;
    if (ts.isExportAssignment(node)) return isFunctionLike(withoutParentheses(node.expression));
    return false;
  };

  const functionName = (node) => {
    const own = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
    const owner = node.parent && ts.isClassLike(node.parent) ? node.parent : null;
    if (ts.isConstructorDeclaration(node)) return `${owner?.name?.text ?? "class"}.constructor`;
    if (own && owner?.name) return `${owner.name.text}.${own}`;
    if (own) return own;
    const holder = node.parent && isFunctionHook(node.parent) ? node.parent.parent : node.parent;
    if (
      holder &&
      (ts.isVariableDeclaration(holder) ||
        ts.isPropertyDeclaration(holder) ||
        ts.isPropertyAssignment(holder))
    )
      return holder.name.getText();
    return "function";
  };

  return {
    findTag,
    hasTag: (node, name) => findTag(node, name) !== null,
    bodyOf,
    functionOf,
    tagsFunction,
    functionName,
  };
}

// The method name of a call such as `a.b()` or `a["b"]()`, or "" for another callee.
export function calledMethod(callee) {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && isStringLiteral(callee.argumentExpression))
    return callee.argumentExpression.text;
  return "";
}
