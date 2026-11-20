// SPDX-License-Identifier: Apache-2.0
// Reference-only clip planning. Production evaluates and draws entirely in C.
import { Op } from 'avatar-dsl/vendor/compiler/opcodes'
export function commandClips(commands, count, width, height) {
  const stack = [{ x: 0, y: 0, w: width, h: height }],
    clips = []
  for (let i = 0; i < count; i++) {
    const n = i * 8,
      op = commands[n]
    if (op === Op.BeginGroup) {
      const a = stack[stack.length - 1],
        x = Math.max(a.x, commands[n + 1]),
        y = Math.max(a.y, commands[n + 2])
      const right = Math.min(a.x + a.w, commands[n + 1] + commands[n + 3])
      const bottom = Math.min(a.y + a.h, commands[n + 2] + commands[n + 4])
      if (stack.length > 16 || commands[n + 3] < 0 || commands[n + 4] < 0) throw new Error('AVDS: group')
      stack.push(right <= x || bottom <= y ? { x: 0, y: 0, w: 0, h: 0 } : { x, y, w: right - x, h: bottom - y })
    } else if (op === Op.EndGroup) {
      if (stack.length === 1) throw new Error('AVDS: group underflow')
      stack.pop()
    } else clips[i] = stack[stack.length - 1]
  }
  if (stack.length !== 1) throw new Error('AVDS: unclosed group')
  return clips
}
