import { ts } from "@thestraylight/so-hot-right-now";

import { calledMethod, isFunctionLike, isNamedType } from "@thestraylight/so-hot-right-now/helpers";

// These World methods change the world version, so each cache keyed on it rebuilds.
const WORLD_WRITES = new Set([
  "add",
  "bump",
  "bumpEntity",
  "despawn",
  "remove",
  "set",
  "spawn",
  "submit",
]);

// A project plugin. It reports two problems that the core does not know about:
// - a `defineQuery` call inside a function, in any file;
// - a World write that a frame root reaches without a simulation system between them.
export const ecs = {
  name: "ecs",
  messages: {
    query:
      "Call `defineQuery` once at module scope. Each call makes a new query that the world keeps.",
    worldWrite:
      "Do not change the world from render or input code on each frame. Each change bumps the world version, and each cache keyed on it rebuilds. Change it only when the value changes.",
  },
  create(program) {
    const checker = program.getTypeChecker();
    const writes = [];
    return {
      checkSourceFile(sourceFile, context) {
        const visit = (node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "defineQuery" &&
            ts.findAncestor(node.parent, isFunctionLike)
          )
            context.report(node, "query");
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
      },
      checkNode(node, context) {
        if (
          ts.isCallExpression(node) &&
          WORLD_WRITES.has(calledMethod(node.expression)) &&
          isNamedType(checker.getTypeAtLocation(node.expression.expression), "World")
        )
          writes.push({ owner: context.owner, node, chain: context.chain });
      },
      finish(graph, context) {
        const frameCode = new Set();
        const simulation = graph.roots.get("simulation") ?? new Set();
        const queue = [...(graph.roots.get("frame") ?? []), ...(graph.roots.get("tagged") ?? [])];
        while (queue.length > 0) {
          const node = queue.pop();
          if (frameCode.has(node) || simulation.has(node)) continue;
          frameCode.add(node);
          for (const callee of graph.callees.get(node) ?? []) queue.push(callee);
        }
        for (const write of writes)
          if (frameCode.has(write.owner) && !context.isStrict(write.owner.getSourceFile()))
            context.report(write.node, "worldWrite", write.chain);
      },
    };
  },
};
