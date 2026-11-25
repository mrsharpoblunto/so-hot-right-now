// `useCallback` returns the function that it receives, so a tag on the variable applies.
export const react = {
  name: "react",
  functionHooks: ["useCallback"],
};

// The audio thread calls `process` on each worklet processor for each block of 128 samples.
export const audioWorklet = {
  name: "audio-worklet",
  roots: [
    {
      kind: "method",
      owner: { extends: "AudioWorkletProcessor" },
      methods: ["process"],
      label: "audio",
    },
  ],
};
