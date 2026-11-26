import { READ, WRITE, normalize } from "./helpers.mjs";
import { resolveOptions } from "./options.mjs";
import { createSyntax } from "./syntax.mjs";

// The walk owns these messages. The plugins own the rest.
export const walkerMessages = {
  closure: "Do not create a closure in a hot path. Use a loop or a method on a long-lived object.",
  reason:
    "Give a reason after `@hotIgnore`: say when the function runs or why it may break the rules.",
  untagged:
    "This function runs in a hot path. Read it, then tag it `@hot` if it is fast, or `@hotIgnore <reason>` if it is not.",
  staleHot:
    "No hot path calls this function. Remove `@hot`, or name its caller after `@hot` if it is a root.",
  staleIgnore: "No hot path calls this function. Remove `@hotIgnore`.",
  misplaced:
    "Put `@hot` and `@hotIgnore` on a function, or on the declaration that holds a function.",
  allow: "Give a reason after `hot-path: allow`: name the API that must allocate.",
};

// `// hot-path: allow <reason>` on the line above a problem accepts it. The reason is necessary.
function allowance(sourceFile, node) {
  const text = sourceFile.text;
  const lineStart = text.lastIndexOf("\n", node.getStart(sourceFile) - 1) + 1;
  if (lineStart === 0) return null;
  const previous = text.slice(text.lastIndexOf("\n", lineStart - 2) + 1, lineStart).trim();
  const match = /^\/\/ hot-path: allow\b(.*)$/.exec(previous);
  return match ? match[1].trim() : null;
}

export function checkHotPaths(analysis, options) {
  const settings = resolveOptions(options, walkerMessages);
  const { ts, checker, helpers } = analysis;
  const {
    accessKind,
    isFunctionLike,
    isLibraryDeclaration,
    resolvedDeclaration,
    symbolAt,
    withoutParentheses,
  } = helpers;
  const syntax = createSyntax(analysis, settings.functionHooks);
  const { classMember, heritageNames, isNested, memberName, tagText } = syntax;
  const hooks = settings.plugins.map((plugin) => plugin.create?.(analysis) ?? {});
  const problems = [];
  const sourceFiles = analysis.sourceFiles((fileName) =>
    settings.isProjectFile(settings.relative(fileName)),
  );

  const ownerMatches = (classNode, owner) => {
    if (owner.implements !== undefined)
      return heritageNames(classNode, ts.SyntaxKind.ImplementsKeyword).includes(owner.implements);
    if (owner.extends !== undefined)
      return heritageNames(classNode, ts.SyntaxKind.ExtendsKeyword).includes(owner.extends);
    const name = classNode.name?.text ?? "";
    return owner.name instanceof RegExp ? owner.name.test(name) : owner.name === name;
  };

  const memberOf = (declaration) =>
    ts.isFunctionTypeNode(declaration) && ts.isPropertySignature(declaration.parent)
      ? declaration.parent
      : declaration;

  const projectFiles = new Map();
  const isProjectSource = (sourceFile) => {
    let result = projectFiles.get(sourceFile);
    if (result === undefined) {
      result =
        !sourceFile.isDeclarationFile &&
        !analysis.isExternalLibrary(sourceFile) &&
        settings.isProjectFile(settings.relative(sourceFile.fileName));
      projectFiles.set(sourceFile, result);
    }
    return result;
  };
  const isStrict = (sourceFile) => settings.isStrictFile(settings.relative(sourceFile.fileName));

  const report = (sourceFile, node, messageId, chain) => {
    const message = settings.messages[messageId];
    if (message === undefined) throw new Error(`No plugin defines the message "${messageId}".`);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    problems.push({
      fileName: normalize(sourceFile.fileName),
      file: settings.relative(sourceFile.fileName),
      line: line + 1,
      column: character + 1,
      messageId,
      message,
      chain,
      strict: isStrict(sourceFile),
    });
  };
  const reportAllowed = (sourceFile, node, messageId, chain) => {
    const allowed = allowance(sourceFile, node);
    if (allowed === null) report(sourceFile, node, messageId, chain);
    else if (allowed === "") report(sourceFile, node, "allow", chain);
  };

  const memberRoots = settings.roots.filter((root) => root.kind === "method");
  const callRoots = new Map();
  for (const root of settings.roots)
    if (root.kind !== "method") {
      if (!callRoots.has(root.callee)) callRoots.set(root.callee, []);
      callRoots.get(root.callee).push(root);
    }
  const memberRootLabel = (member) => {
    const owner = member.parent;
    if (!owner || !ts.isClassLike(owner)) return null;
    const name = memberName(member);
    for (const root of memberRoots)
      if (root.methods.includes(name) && ownerMatches(owner, root.owner)) return root.label;
    return null;
  };

  const rootsByLabel = new Map();
  const addRoot = (found, node, label) => {
    found.push(node);
    if (!rootsByLabel.has(label)) rootsByLabel.set(label, new Set());
    rootsByLabel.get(label).add(node);
  };

  const rootFunctions = (sourceFile) => {
    const found = [];
    const strict = isStrict(sourceFile);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        for (const root of callRoots.get(node.expression.text) ?? []) {
          const argument = node.arguments[root.index];
          const target = argument && syntax.functionOf(argument);
          // A scheduler root is a callback that schedules itself again from its own body.
          if (
            target &&
            (root.kind === "argument" || ts.findAncestor(node, (current) => current === target))
          )
            addRoot(found, target, root.label);
        }
      if (isFunctionLike(node)) {
        const ignore = syntax.findTag(node, "hotIgnore");
        if (ignore && !tagText(ignore))
          report(sourceFile, ignore, "reason", syntax.functionName(node));
      }
      // A root property such as `run = step` has the body of the function that it names.
      if (
        ts.isPropertyDeclaration(node) &&
        node.initializer &&
        ts.isIdentifier(withoutParentheses(node.initializer))
      ) {
        const label = memberRootLabel(node);
        const target = label && syntax.bodyOf(node);
        if (target) addRoot(found, target, label);
      }
      if (isFunctionLike(node) && node.body) {
        const member = classMember(node);
        const label = member && memberRootLabel(member);
        const hot = syntax.findTag(node, "hot");
        // A root that names its caller, such as a worker message handler.
        const tagged = hot !== null && tagText(hot) !== "";
        if (label) addRoot(found, node, label);
        if (tagged) addRoot(found, node, "tagged");
        if (
          !label &&
          !tagged &&
          strict &&
          !isNested(node) &&
          !ts.isConstructorDeclaration(node) &&
          !syntax.hasTag(node, "hotIgnore")
        )
          addRoot(found, node, "strict");
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  };

  // Only a property that can hold a function can implement a member that hot code calls. So a
  // literal of data, such as `{ x: 1 }`, needs no contextual type.
  const mayHoldFunction = (property) => {
    if (!property.name || !ts.isIdentifier(property.name)) return false;
    if (ts.isShorthandPropertyAssignment(property) || isFunctionLike(property)) return true;
    if (!ts.isPropertyAssignment(property)) return false;
    const value = withoutParentheses(property.initializer);
    return ts.isIdentifier(value) || ts.isCallExpression(value) || isFunctionLike(value);
  };

  // An interface or type member has no body. Map each project member to the object literal
  // properties and class members that implement it, so a call through the member reaches them.
  const implementations = () => {
    const found = new Map();
    const add = (type, name, implementation) => {
      const target = implementation && syntax.bodyOf(implementation);
      if (!target) return;
      for (const member of type.getProperty(name)?.declarations ?? [])
        if (
          !syntax.bodyOf(member) &&
          (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
          isProjectSource(member.getSourceFile())
        ) {
          if (!found.has(member)) found.set(member, []);
          found.get(member).push(target);
        }
    };
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node) && node.properties.some(mayHoldFunction)) {
        const type = checker.getContextualType(node);
        if (type)
          for (const property of node.properties) {
            if (!mayHoldFunction(property)) continue;
            const implementation = ts.isShorthandPropertyAssignment(property)
              ? checker.getShorthandAssignmentValueSymbol(property)?.valueDeclaration
              : property;
            add(type, property.name.text, implementation);
          }
      }
      if (ts.isClassLike(node))
        for (const clause of node.heritageClauses ?? [])
          for (const heritage of clause.types) {
            const type = checker.getTypeAtLocation(heritage);
            for (const member of node.members)
              if (member.name && ts.isIdentifier(member.name)) add(type, member.name.text, member);
          }
      ts.forEachChild(node, visit);
    };
    for (const sourceFile of sourceFiles) if (isProjectSource(sourceFile)) visit(sourceFile);
    return found;
  };

  const callers = new Map();
  const callees = new Map();
  const ignoredCalls = new Set();
  // A closure that a hot function creates is already a problem, so it needs no tag.
  const inlineClosures = new Set();
  const untagged = [];
  const queue = [];

  const chain = (node) => {
    const names = [];
    for (let current = node; current; current = callers.get(current))
      names.push(syntax.functionName(current));
    return names.reverse().join(" > ");
  };

  const enqueue = (node, caller) => {
    if (!isProjectSource(node.getSourceFile())) return;
    if (caller) {
      if (!callees.has(caller)) callees.set(caller, new Set());
      callees.get(caller).add(node);
    }
    if (syntax.hasTag(node, "hotIgnore")) {
      ignoredCalls.add(node);
      return;
    }
    if (callers.has(node)) return;
    callers.set(node, caller);
    queue.push(node);
  };

  for (const sourceFile of sourceFiles) {
    if (!isProjectSource(sourceFile)) continue;
    const context = {
      checker,
      isStrict: isStrict(sourceFile),
      report: (node, messageId) => reportAllowed(sourceFile, node, messageId, "module"),
    };
    for (const hook of hooks) hook.checkSourceFile?.(sourceFile, context);
    for (const root of rootFunctions(sourceFile)) enqueue(root, null);
  }

  const implemented = implementations();
  // A call to an overloaded function resolves to an overload signature, which has no body.
  const implementationOf = (declaration) =>
    isFunctionLike(declaration) && !declaration.body && declaration.name
      ? symbolAt(declaration.name)?.declarations?.find((candidate) => candidate.body)
      : undefined;

  const followDeclarations = (declarations, caller) => {
    for (const declaration of declarations ?? []) {
      const target = syntax.bodyOf(implementationOf(declaration) ?? declaration);
      if (target) enqueue(target, caller);
      for (const implementation of implemented.get(memberOf(declaration)) ?? [])
        enqueue(implementation, caller);
    }
  };

  const isUnionReceiver = (expression) => checker.getTypeAtLocation(expression).isUnion();

  const calleeName = (expression) =>
    ts.isPropertyAccessExpression(expression)
      ? expression.name
      : ts.isElementAccessExpression(expression)
        ? expression.argumentExpression
        : expression;

  const scan = (owner) => {
    const sourceFile = owner.getSourceFile();
    const path = chain(owner);
    const context = {
      checker,
      owner,
      chain: path,
      isStrict: isStrict(sourceFile),
      report: (node, messageId) => reportAllowed(sourceFile, node, messageId, path),
    };

    analysis.prefetch(owner);
    if (!syntax.hasTag(owner, "hot")) untagged.push(owner);
    for (const hook of hooks) hook.checkFunction?.(owner, context);

    const visit = (node) => {
      // A throw and a catch block run only on a failure.
      if (ts.isTypeNode(node) || ts.isThrowStatement(node) || ts.isCatchClause(node)) return;
      if (node !== owner && isFunctionLike(node)) {
        context.report(node, "closure");
        inlineClosures.add(node);
        enqueue(node, owner);
        return;
      }
      for (const hook of hooks) hook.checkNode?.(node, context);
      if (ts.isCallExpression(node)) {
        // A function that hot code passes to a call can run in the hot path.
        for (const argument of node.arguments)
          if (
            (ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument)) &&
            checker.getTypeAtLocation(argument).getCallSignatures().length > 0
          )
            followDeclarations(symbolAt(calleeName(argument))?.declarations, owner);
        const declaration = resolvedDeclaration(node);
        const callee = calleeName(node.expression);
        // An interface member such as `level.draw` reaches its implementations.
        if (declaration && !isLibraryDeclaration(declaration)) {
          followDeclarations([declaration], owner);
          // A call on an `A | B` receiver resolves to the signature of one member only.
          if (callee !== node.expression && isUnionReceiver(node.expression.expression))
            followDeclarations(symbolAt(callee)?.declarations, owner);
        } else followDeclarations(symbolAt(callee)?.declarations, owner);
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        !(node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node)
      ) {
        const access = accessKind(node);
        for (const declaration of symbolAt(node.name)?.declarations ?? [])
          for (const accessor of [declaration, ...(implemented.get(declaration) ?? [])])
            if (
              accessor.body &&
              ((access & READ && ts.isGetAccessorDeclaration(accessor)) ||
                (access & WRITE && ts.isSetAccessorDeclaration(accessor)))
            )
              enqueue(accessor, owner);
      }
      ts.forEachChild(node, visit);
    };
    for (const parameter of owner.parameters) visit(parameter);
    if (owner.body) visit(owner.body);
  };

  while (queue.length > 0) scan(queue.pop());
  for (const owner of untagged)
    if (!inlineClosures.has(owner))
      report(owner.getSourceFile(), owner.name ?? owner, "untagged", chain(owner));

  const graph = { roots: rootsByLabel, callees, chain };
  const finishContext = {
    checker,
    isStrict,
    report: (node, messageId, path) => reportAllowed(node.getSourceFile(), node, messageId, path),
  };
  for (const hook of hooks) hook.finish?.(graph, finishContext);

  for (const sourceFile of sourceFiles) {
    if (!isProjectSource(sourceFile)) continue;
    const strict = isStrict(sourceFile);
    const visit = (node) => {
      for (const doc of node.jsDoc ?? [])
        for (const tag of doc.tags ?? [])
          if (
            (tag.tagName.text === "hot" || tag.tagName.text === "hotIgnore") &&
            !syntax.tagsFunction(node)
          )
            report(sourceFile, tag, "misplaced", syntax.functionName(node));
      if (isFunctionLike(node) && node.body) {
        const hot = syntax.findTag(node, "hot");
        if (hot && !tagText(hot) && !callers.has(node))
          report(sourceFile, hot, "staleHot", syntax.functionName(node));
        // In a strict file, each function needs a tag, so no ignore tag is stale.
        const ignore = syntax.findTag(node, "hotIgnore");
        if (ignore && !strict && !ignoredCalls.has(node))
          report(sourceFile, ignore, "staleIgnore", syntax.functionName(node));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return problems.sort(
    (first, second) =>
      first.file.localeCompare(second.file) ||
      first.line - second.line ||
      first.column - second.column,
  );
}
