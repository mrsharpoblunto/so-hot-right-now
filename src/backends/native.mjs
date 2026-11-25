import { createHelpers } from "../helpers.mjs";

function remember(map, key, compute) {
  if (map.has(key)) return map.get(key);
  const value = compute();
  map.set(key, value);
  return value;
}

// TypeScript 7 runs the compiler in a separate process. This shim gives the checker the names of
// the classic API. It remembers each answer, because each new question is a round trip.
export function createNativeAnalysis(typescript, project) {
  const { ast, sync, version } = typescript;
  const { SyntaxKind } = ast;
  const ts = {
    ...ast,
    TypeFlags: sync.TypeFlags,
    SymbolFlags: sync.SymbolFlags,
    version,
    isClassLike: (node) =>
      node.kind === SyntaxKind.ClassDeclaration || node.kind === SyntaxKind.ClassExpression,
    isPropertySignature: (node) => node.kind === SyntaxKind.PropertySignature,
    isMethodSignature: (node) => node.kind === SyntaxKind.MethodSignature,
    forEachChild: (node, visit) => node.forEachChild(visit),
    findAncestor: (node, test) => {
      for (let current = node; current; current = current.parent) if (test(current)) return current;
      return undefined;
    },
  };

  const native = project.checker;
  const types = new Map();
  const symbols = new Map();

  const wrapSymbol = (symbol) => {
    if (symbol === undefined) return undefined;
    return remember(symbols, symbol.id, () => {
      const cache = new Map();
      return {
        raw: symbol,
        name: symbol.name,
        flags: symbol.flags,
        getName: () => symbol.name,
        get declarations() {
          return remember(cache, "declarations", () =>
            symbol.declarations.map((handle) => handle.resolve()).filter(Boolean),
          );
        },
        get valueDeclaration() {
          return remember(cache, "value", () => symbol.valueDeclaration?.resolve());
        },
      };
    });
  };

  const wrapType = (type) => {
    if (type === undefined) return undefined;
    return remember(types, type.id, () => {
      const cache = new Map();
      const properties = new Map();
      return {
        raw: type,
        flags: type.flags,
        isUnion: () => type.isUnionType(),
        isIntersection: () => type.isIntersectionType(),
        get types() {
          return remember(cache, "types", () => (type.getTypes() ?? []).map(wrapType));
        },
        get aliasSymbol() {
          return remember(cache, "alias", () => wrapSymbol(type.getAliasSymbol()));
        },
        getSymbol: () => remember(cache, "symbol", () => wrapSymbol(type.getSymbol())),
        // A type parameter keeps its constraint in the checker, not in the type object.
        getConstraint: () =>
          remember(cache, "constraint", () =>
            wrapType(
              type.flags & sync.TypeFlags.TypeParameter
                ? native.getConstraintOfTypeParameter(type)
                : type.getConstraint(),
            ),
          ),
        getProperty: (name) =>
          remember(properties, name, () => wrapSymbol(native.getPropertyOfType(type, name))),
        getCallSignatures: () =>
          remember(cache, "calls", () => native.getSignaturesOfType(type, sync.SignatureKind.Call)),
      };
    });
  };

  const nodeTypes = new Map();
  const nodeSymbols = new Map();
  const callDeclarations = new Map();
  const contextualTypes = new Map();
  const arrays = new Map();
  const tuples = new Map();
  const typeArguments = new Map();
  // The classic checker gives an error type, not undefined, for a node that it cannot type.
  const typeOrAny = (type) => type ?? wrapType(native.getAnyType());

  const checker = {
    getTypeAtLocation: (node) =>
      typeOrAny(remember(nodeTypes, node, () => wrapType(native.getTypeAtLocation(node)))),
    getSymbolAtLocation: (node) =>
      remember(nodeSymbols, node, () => wrapSymbol(native.getSymbolAtLocation(node))),
    getAliasedSymbol: (symbol) => wrapSymbol(native.getAliasedSymbol(symbol.raw)),
    getResolvedSignature: (node) => {
      const declaration = remember(callDeclarations, node, () =>
        native.getResolvedSignature(node)?.declaration?.resolve(),
      );
      return { getDeclaration: () => declaration };
    },
    getContextualType: (node) =>
      remember(contextualTypes, node, () => wrapType(native.getContextualType(node))),
    getShorthandAssignmentValueSymbol: (node) =>
      wrapSymbol(native.getShorthandAssignmentValueSymbol(node)),
    getTypeOfSymbolAtLocation: (symbol, node) =>
      typeOrAny(wrapType(native.getTypeOfSymbolAtLocation(symbol.raw, node))),
    isArrayType: (type) => remember(arrays, type.raw.id, () => native.isArrayType(type.raw)),
    isTupleType: (type) => remember(tuples, type.raw.id, () => native.isTupleType(type.raw)),
    getTypeArguments: (type) =>
      remember(typeArguments, type.raw.id, () => native.getTypeArguments(type.raw).map(wrapType)),
    getStringType: () => wrapType(native.getStringType()),
  };

  const helpers = createHelpers(ts, checker);
  const K = SyntaxKind;
  // The rules ask for the type of a binary operand only for these operators.
  const typedOperators = new Set([
    K.PlusToken,
    K.PlusEqualsToken,
    K.EqualsEqualsEqualsToken,
    K.ExclamationEqualsEqualsToken,
    K.EqualsEqualsToken,
    K.ExclamationEqualsToken,
    K.LessThanToken,
    K.LessThanEqualsToken,
    K.GreaterThanToken,
    K.GreaterThanEqualsToken,
  ]);

  // One request for many nodes costs less than a request for each node. Ask for the types and
  // symbols that the walk and the rules usually read in a function, so that their single
  // questions find the answers in the cache. A node that this misses costs a single request.
  const prefetch = (fn) => {
    const typeNodes = [];
    const symbolNodes = [];
    const wantType = (node) => {
      if (node !== undefined && !nodeTypes.has(node)) typeNodes.push(node);
    };
    const wantSymbol = (node) => {
      if (node !== undefined && !nodeSymbols.has(node)) symbolNodes.push(node);
    };
    const visit = (node) => {
      if (helpers.isFunctionLike(node) || ts.isTypeNode(node)) return;
      if (ts.isCallExpression(node)) {
        for (const argument of node.arguments)
          if (ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument))
            wantType(argument);
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
          wantType(callee.expression);
        else if (ts.isIdentifier(callee)) wantSymbol(callee);
      } else if (ts.isElementAccessExpression(node)) {
        wantType(node.expression);
        wantType(node.argumentExpression);
      } else if (ts.isBinaryExpression(node)) {
        const operator = node.operatorToken.kind;
        if (typedOperators.has(operator)) {
          wantType(node.left);
          wantType(node.right);
        } else if (operator === K.EqualsToken) {
          const target = helpers.withoutParentheses(node.left);
          if (ts.isArrayLiteralExpression(target) || ts.isObjectLiteralExpression(target))
            wantType(node.right);
        }
      } else if (ts.isForOfStatement(node)) wantType(node.expression);
      else if (ts.isArrayBindingPattern(node) || ts.isObjectBindingPattern(node)) wantType(node);
      if (ts.isPropertyAccessExpression(node)) wantSymbol(node.name);
      node.forEachChild(visit);
    };
    fn.forEachChild(visit);
    if (typeNodes.length > 0) {
      const found = native.getTypeAtLocation(typeNodes);
      for (let index = 0; index < typeNodes.length; index++)
        nodeTypes.set(typeNodes[index], wrapType(found[index]));
    }
    if (symbolNodes.length > 0) {
      const found = native.getSymbolAtLocation(symbolNodes);
      for (let index = 0; index < symbolNodes.length; index++)
        nodeSymbols.set(symbolNodes[index], wrapSymbol(found[index]));
    }
  };

  const program = project.program;
  return {
    ts,
    checker,
    helpers,
    prefetch,
    typescriptVersion: version,
    sourceFiles: (include) =>
      program
        .getSourceFileNames()
        .filter(include)
        .map((fileName) => program.getSourceFile(fileName))
        .filter(Boolean),
    isExternalLibrary: (sourceFile) => program.isSourceFileFromExternalLibrary(sourceFile),
  };
}
