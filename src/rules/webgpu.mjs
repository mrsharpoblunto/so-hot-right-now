import ts from "typescript";

import { calledMethod } from "../syntax.mjs";
import { someType, typeName } from "../types.mjs";

// A renderer can make these objects once. A command encoder and a pass are made each frame.
const GPU_CREATE_METHODS = new Set([
  "createBindGroup",
  "createBindGroupLayout",
  "createBuffer",
  "createComputePipeline",
  "createComputePipelineAsync",
  "createPipelineLayout",
  "createQuerySet",
  "createRenderBundleEncoder",
  "createRenderPipeline",
  "createRenderPipelineAsync",
  "createSampler",
  "createShaderModule",
  "createTexture",
  "createView",
]);

function isGpuType(type) {
  return someType(type, (part) => /^GPU[A-Z]/.test(typeName(part)));
}

export const webgpu = {
  name: "webgpu",
  messages: {
    gpu: "Do not create a WebGPU object in a hot path. Create it once and reuse it.",
  },
  create(program) {
    const checker = program.getTypeChecker();
    return {
      checkNode(node, context) {
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        if (
          GPU_CREATE_METHODS.has(calledMethod(callee)) &&
          isGpuType(checker.getTypeAtLocation(callee.expression))
        )
          context.report(node, "gpu");
      },
    };
  },
};
