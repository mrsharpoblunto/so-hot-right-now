import ts from "typescript";

export function typeName(type) {
  return type.getSymbol()?.getName() ?? type.aliasSymbol?.getName() ?? "";
}

// A receiver such as `texture?.` or `A | B` matches when one of its parts matches.
export function someType(type, test) {
  if (type.isUnion() || type.isIntersection())
    return type.types.some((part) => someType(part, test));
  // A generic receiver such as `T extends HTMLElement` matches by its constraint.
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = type.getConstraint();
    return constraint !== undefined && someType(constraint, test);
  }
  return test(type);
}

export function isNamedType(type, name) {
  return someType(type, (part) => typeName(part) === name);
}

export function isNullish(type) {
  return (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0;
}

export function isNumberType(type) {
  if (type.isUnion()) return type.types.every(isNumberType);
  // A branded number such as `number & { brand }` is a number.
  if (type.isIntersection()) return type.types.some(isNumberType);
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = type.getConstraint();
    return constraint !== undefined && isNumberType(constraint);
  }
  return (type.flags & ts.TypeFlags.NumberLike) !== 0;
}

export function isStringType(type) {
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((part) => (part.flags & ts.TypeFlags.StringLike) !== 0);
}

export function isIndexable(checker, type) {
  const parts = type.isUnion() ? type.types : [type];
  return parts.every(
    (part) =>
      checker.isArrayType(part) ||
      checker.isTupleType(part) ||
      /^(?:Float|Int|Uint|BigInt|BigUint)\d+(?:Clamped)?Array$/.test(typeName(part)) ||
      isNullish(part),
  );
}

// An array-like type has a numeric `length`.
export function hasNumericLength(checker, type, node) {
  const length = type.getProperty("length");
  return length !== undefined && isNumberType(checker.getTypeOfSymbolAtLocation(length, node));
}

function mixesNumbers(element) {
  if (!element?.isUnion()) return false;
  return element.types.some(isNumberType) && element.types.some(isNullish);
}

// An array or tuple of numbers that also holds null or undefined loses the packed-double
// storage in V8.
export function hasMixedNumbers(checker, type) {
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = type.getConstraint();
    return constraint !== undefined && hasMixedNumbers(checker, constraint);
  }
  if (type.isUnion())
    return type.types.some((part) => !isNullish(part) && hasMixedNumbers(checker, part));
  if (checker.isArrayType(type)) return mixesNumbers(checker.getTypeArguments(type)[0]);
  if (checker.isTupleType(type))
    return mixesNumbers(checker.getUnionType(checker.getTypeArguments(type)));
  return false;
}

export function isLibraryDeclaration(declaration) {
  const file = declaration?.getSourceFile();
  return !file || file.isDeclarationFile;
}

export function resolvedDeclaration(checker, call) {
  return checker.getResolvedSignature(call)?.getDeclaration();
}
