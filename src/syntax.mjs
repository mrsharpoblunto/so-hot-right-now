// A function hook such as React's `useCallback` returns the function that it receives, so a
// tag on the variable that holds the hook result applies to the function.
export function createSyntax(analysis, functionHooks) {
  const { ts, helpers } = analysis;
  const { isFunctionLike, symbolAt, withoutParentheses } = helpers;

  const tagText = (tag) => ts.getTextOfJSDocComment(tag.comment)?.trim() ?? "";

  const isNested = (node) => ts.findAncestor(node.parent, isFunctionLike) !== undefined;

  // The class member that a function implements: a method, or a property whose initializer is
  // the function.
  const classMember = (node) => {
    if (ts.isMethodDeclaration(node)) return node;
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.parent &&
      ts.isPropertyDeclaration(node.parent) &&
      node.parent.initializer === node
    )
      return node.parent;
    return null;
  };

  const memberName = (member) =>
    member.name && ts.isIdentifier(member.name) ? member.name.text : "";

  const heritageNames = (classNode, token) => {
    const names = [];
    for (const clause of classNode.heritageClauses ?? [])
      if (clause.token === token)
        for (const type of clause.types)
          if (ts.isIdentifier(type.expression)) names.push(type.expression.text);
    return names;
  };

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
    const target = symbolAt(initializer)?.valueDeclaration;
    return target ? resolveBody(target, seen) : null;
  };

  // A declaration whose initializer names a function, such as `prepare = allocate`, has the
  // body of that function.
  const bodyOf = (declaration) => resolveBody(declaration, new Set());

  const functionOf = (expression) => {
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
    if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) return null;
    const declaration = symbolAt(
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
    tagText,
    isNested,
    classMember,
    memberName,
    heritageNames,
    findTag,
    hasTag: (node, name) => findTag(node, name) !== null,
    bodyOf,
    functionOf,
    tagsFunction,
    functionName,
  };
}
