// SPDX-License-Identifier: Apache-2.0
// IDs/defaults are the pinned AVDS v1 DrawContext + FaceTuning contract.
const emotion = new Uint8Array([0, 3, 2, 1, 5, 4, 0, 0])
export const DEFAULT_CONTEXT = Object.freeze([
  320, 240, 1, 0, 0, 1, 0, 0, 0, 0, 65535, 0, 65504, 0, 65535, 8, 0, 0, 0, 0, 0, 0, 50, 90, 4, 60, 1, 0, 10, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
])
const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo)
export function rgb565(rgb) {
  return ((clamp(rgb.r, 0, 255) >> 3) << 11) | ((clamp(rgb.g, 0, 255) >> 2) << 5) | (clamp(rgb.b, 0, 255) >> 3)
}
export function createContext({ width = 320, height = 240, circular = false, variables = {} } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024)
    throw new Error('AVDS: canvas size')
  const ctx = new Float32Array(DEFAULT_CONTEXT)
  ctx[0] = width
  ctx[1] = height
  ctx[2] = circular
    ? Math.fround(Math.fround(Math.min(width, height) / 400) * Math.fround(0.97))
    : Math.min(width / 320, height / 240)
  // A MOD-local override, indexed by AVDS variable ID; no host API added.
  for (const id of Object.keys(variables)) {
    const index = Number(id)
    if (!Number.isInteger(index) || index < 12 || index >= 41 || !Number.isFinite(variables[id]))
      throw new Error('AVDS: tuning override')
    ctx[index] = variables[id]
  }
  const mask = clamp(ctx[32], 0, 255) | 0
  ctx[32] = mask
  for (let i = 0; i < 8; i++) ctx[33 + i] = (mask >> i) & 1
  return ctx
}
export function updateContext(ctx, state, elapsed, blink, options = {}) {
  const l = state.eyes.left,
    r = state.eyes.right
  ctx[3] = elapsed >>> 0
  ctx[4] = options.breathSource === 'state' ? clamp(state.breath, -1, 1) : Math.sin((elapsed * 2 * Math.PI) / 4000)
  ctx[5] = Math.min(clamp(l.open, 0, 1), clamp(r.open, 0, 1)) * blink
  ctx[6] = (clamp(l.gazeX, -1, 1) + clamp(r.gazeX, -1, 1)) / 2
  ctx[7] = (clamp(l.gazeY, -1, 1) + clamp(r.gazeY, -1, 1)) / 2
  ctx[8] = clamp(state.mouth.open, 0, 1)
  ctx[31] = Number.isFinite(options.mouthForm) && options.mouthForm >= 0 ? clamp(options.mouthForm, 0, 1) : ctx[8]
  ctx[9] = emotion[state.emotion] ?? 0
  ctx[10] = rgb565(state.theme.primary)
  ctx[11] = rgb565(state.theme.secondary)
}
