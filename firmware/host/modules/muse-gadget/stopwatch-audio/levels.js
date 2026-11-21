function computeLevel(bytes) @ "xs_computeLevel";
export function pcmLevel(bytes) { return bytes.length < 2 ? 0 : computeLevel(bytes) / 32768; }
