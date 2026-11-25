import { READ } from "../helpers.mjs";

// A read of these makes the browser compute the layout in the middle of a frame.
const LAYOUT_METHODS = new Set(["getBoundingClientRect", "getClientRects", "getComputedStyle"]);
const LAYOUT_PROPERTIES = new Set([
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "clientWidth",
  "clientHeight",
  "clientTop",
  "clientLeft",
  "scrollWidth",
  "scrollHeight",
  "scrollTop",
  "scrollLeft",
  "innerText",
]);

export const browser = {
  name: "browser",
  messages: {
    layout:
      "Do not read the DOM layout in a hot path. It makes the browser compute the layout in the middle of a frame. Read it on a resize or an event.",
  },
  // A frame callback that schedules itself again runs on each frame.
  roots: [
    {
      kind: "scheduler",
      callee: "requestAnimationFrame",
      index: 0,
      label: "frame",
    },
  ],
  create(analysis) {
    const { ts, checker, helpers } = analysis;
    const {
      accessKind,
      calledMethod,
      isLibraryDeclaration,
      isStringLiteral,
      literalName,
      resolvedDeclaration,
      someType,
      typeName,
      withoutParentheses,
    } = helpers;
    const isDomType = (type) =>
      someType(type, (part) => {
        const name = typeName(part);
        return (
          name === "Window" || name === "Element" || name === "Document" || name.endsWith("Element")
        );
      });
    const isDom = (node) => isDomType(checker.getTypeAtLocation(node));
    return {
      checkNode(node, context) {
        const report = context.report;
        if (
          ts.isElementAccessExpression(node) &&
          isStringLiteral(node.argumentExpression) &&
          LAYOUT_PROPERTIES.has(node.argumentExpression.text) &&
          accessKind(node) & READ &&
          isDom(node.expression)
        )
          report(node, "layout");
        if (ts.isObjectBindingPattern(node) && isDom(node))
          for (const element of node.elements)
            if (
              !element.dotDotDotToken &&
              LAYOUT_PROPERTIES.has(literalName(element.propertyName ?? element.name))
            )
              report(element, "layout");
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const target = withoutParentheses(node.left);
          if (ts.isObjectLiteralExpression(target) && isDom(node.right))
            for (const property of target.properties)
              if (
                (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
                LAYOUT_PROPERTIES.has(literalName(property.name))
              )
                report(property, "layout");
        }
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if (
            ts.isIdentifier(callee) &&
            LAYOUT_METHODS.has(callee.text) &&
            isLibraryDeclaration(resolvedDeclaration(node))
          )
            report(node, "layout");
          if (LAYOUT_METHODS.has(calledMethod(callee)) && isDom(callee.expression))
            report(node, "layout");
        }
        if (
          ts.isPropertyAccessExpression(node) &&
          !(node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node) &&
          accessKind(node) & READ &&
          LAYOUT_PROPERTIES.has(node.name.text) &&
          isDom(node.expression)
        )
          report(node, "layout");
      },
    };
  },
};
