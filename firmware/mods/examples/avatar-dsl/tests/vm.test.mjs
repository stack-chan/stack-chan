// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createContext, updateContext } from 'avatar-dsl/context'
import { FaceDriver } from 'avatar-dsl/driver'
import { Op } from 'avatar-dsl/vendor/compiler/opcodes'
import { AvatarVM, decode } from 'avatar-dsl/vm'
import { compile } from '../../../../tools/avatar-dsl/compiler/compile.js'

const load = (name) => readFileSync(new URL(`../assets/${name}.avbc`, import.meta.url))
const fixture = JSON.parse(readFileSync(new URL('./oracle.json', import.meta.url)))
const output = (vm) => Array.from({ length: vm.count }, (_, i) => Array.from(vm.commands.subarray(i * 8, i * 8 + 8)))
test('pinned provenance hashes preserve upstream compiler/preset sources', () => {
  const p = JSON.parse(readFileSync(new URL('../vendor/PROVENANCE.json', import.meta.url)))
  assert.equal(p.commit, fixture.upstream)
  for (const f of p.files) {
    const text = readFileSync(new URL(`../${f.local}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.equal(createHash('sha256').update(text).digest('hex'), f.sha256, f.local)
  }
})
test('unmodified sources compile to bundled resources', () => {
  for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
    const src = readFileSync(new URL(`../assets/${name}.avdsl`, import.meta.url), 'utf8')
    assert.deepEqual(Buffer.from(compile(src)), load(name))
  }
})
test('192 pinned C++ RecordingCanvas command sequences: presets, six expressions, contexts and numeric edges', () => {
  assert.equal(fixture.upstream, '419385ef1b875137140085bd50d34dee331f30c2')
  assert.equal(fixture.fixtures.length, 192)
  const vms = new Map()
  for (const f of fixture.fixtures) {
    if (!vms.has(f.name))
      vms.set(
        f.name,
        new AvatarVM(f.name === 'numeric' ? readFileSync(new URL('./numeric.avbc', import.meta.url)) : load(f.name)),
      )
    const vm = vms.get(f.name)
    vm.run(new Float32Array(f.context))
    assert.deepEqual(output(vm), f.commands, `${f.name} expression=${f.context[9]} context=${f.context}`)
  }
})
function raw(code, { locals = 0 } = {}) {
  const data = new Uint8Array(22 + code.length),
    view = new DataView(data.buffer)
  view.setUint32(0, 0x53445641, true)
  view.setUint16(4, 1, true)
  view.setUint16(10, 1, true)
  view.setUint16(12, code.length, true)
  data[19] = locals
  data.set(code, 22)
  return data.buffer
}
test('decoder rejects malformed header, sections, references, operands and jump targets', () => {
  const original = load('default_face')
  assert.throws(() => decode(new ArrayBuffer(70001)), /file size/)
  for (const size of [0, 15, 16, original.length - 1]) assert.throws(() => decode(original.subarray(0, size)))
  for (const [offset, value] of [
    [0, 0],
    [4, 2],
    [6, 1],
    [10, 0],
    [14, 255],
  ]) {
    const bytes = Uint8Array.from(original)
    bytes[offset] = value
    assert.throws(() => decode(bytes))
  }
  assert.throws(() => decode(Buffer.concat([original, Buffer.from([0])])), /sections/)
  for (const code of [
    [255],
    [Op.PushF32, 0],
    [Op.PushConst, 0, Op.Ret],
    [Op.PushVar, 41, Op.Ret],
    [Op.Call, 1, Op.Ret],
    [Op.PushLocal, 0, Op.Ret],
    [Op.Jmp, 255, 127, Op.Ret],
    [Op.Jmp, 254, 255, Op.Ret],
  ])
    assert.throws(() => decode(raw(code)))
  const bc = raw([Op.PushF32, 0, 0, 128, 127, Op.Pop, Op.Ret])
  assert.throws(() => decode(bc), /non-finite/)
  const source = load('default_face'),
    vm = new AvatarVM(source)
  source.fill(0)
  assert.ok(vm.run(createContext()) > 0, 'VM owns validated bytecode snapshot')
})
test('bounded execution, draw counts, recursive calls, stack and locals fail atomically', () => {
  for (const [source, pattern, budget] of [
    ['fn draw() while true do end end', /instruction budget/],
    ['fn draw() while true do fill_rect(0,0,1,1,primary) end end', /draw budget/, { instructions: 50000, draws: 10 }],
    ['fn f() f() end fn draw() f() end', /call depth/],
    ['fn draw() fill_rect(0,0,1 / 0,1,primary) end', /divide by zero/],
    ['fn draw() fill_rect(0,0,sqrt(-1),1,primary) end', /non-finite/],
    ['fn draw() fill_rect(40000,0,1,1,primary) end', /coordinate range/],
    ['fn draw() fill_rect(0,0,-1,1,primary) end', /negative extent/],
    ['fn draw() fill_rect(0,0,1,1,65536) end', /color range/],
    ['fn draw() begin_group(0,0,1,1) end', /unclosed group/],
    ['fn draw() end_group() end', /group underflow/],
    ['fn draw() let a = 1e38 * 1e38 fill_rect(0,0,a,1,primary) end', /non-finite/],
  ]) {
    const vm = new AvatarVM(compile(source), budget)
    assert.throws(() => vm.run(createContext()), pattern)
    assert.equal(vm.count, 0)
  }
  for (const [code, pattern, locals] of [
    [[Op.Pop, Op.Ret], /stack underflow/, 0],
    [[...Array.from({ length: 65 }, () => [Op.PushI8, 1]).flat(), Op.Ret], /stack overflow/, 0],
    [[Op.Call, 0, Op.Ret], /locals overflow/, 200],
  ])
    assert.throws(() => new AvatarVM(raw(code, { locals })).run(createContext()), pattern)
})
test('predecoded forward/backward branches preserve control flow and exact instruction budgets', () => {
  // Decrement a local three times. Mixed operand widths make byte offsets
  // different from instruction indices; Jnz must return to PushLocal.
  const loop = raw(
    [
      Op.PushI8,
      3,
      Op.StoreLocal,
      0,
      Op.PushLocal,
      0,
      Op.PushI8,
      1,
      Op.Sub,
      Op.Dup,
      Op.StoreLocal,
      0,
      Op.Jnz,
      245,
      255,
      Op.Ret,
    ],
    { locals: 1 },
  )
  const vm = new AvatarVM(loop, { instructions: 21 })
  assert.equal(vm.run(createContext()), 0)
  assert.equal(vm.steps, 21)
  assert.equal(vm.locals[0], 0)
  const bounded = new AvatarVM(loop, { instructions: 20 })
  assert.throws(() => bounded.run(createContext()), /instruction budget/)
  assert.equal(bounded.count, 0)
  assert.equal(bounded.steps, 21)
  // Maximum AVDS code section; reach instruction indices above signed int16
  // through two valid relative jumps, without executing the unreachable Nops.
  const code = new Uint8Array(65535)
  code.set([Op.Jmp, 255, 127])
  code.set([Op.Jmp, 249, 127], 32770)
  code[65534] = Op.Ret
  const large = new AvatarVM(raw(code), { instructions: 3 })
  assert.equal(large.run(createContext()), 0)
  assert.equal(large.steps, 3)
})
test('mapping preserves RGB565/background, common gaze, min eye openness, mouth fallback and emotion order', () => {
  const state = {
    emotion: 0,
    breath: -0.5,
    eyes: { left: { open: 0.8, gazeX: 1, gazeY: -1 }, right: { open: 0.4, gazeX: -1, gazeY: 0 } },
    mouth: { open: 0.75 },
    theme: { primary: { r: 255, g: 0, b: 0 }, secondary: { r: 0, g: 255, b: 0 } },
  }
  const ctx = createContext({ variables: { 32: 129 } })
  for (const [host, dsl] of [0, 3, 2, 1, 5, 4, 0, 0].entries()) {
    state.emotion = host
    updateContext(ctx, state, 1000, 0.5, { breathSource: 'state' })
    assert.equal(ctx[9], dsl)
  }
  assert.equal(ctx[10], 0xf800)
  assert.equal(ctx[11], 0x07e0)
  assert.equal(ctx[12], 0xffe0)
  assert.equal(ctx[5], Math.fround(0.2))
  assert.equal(ctx[6], 0)
  assert.equal(ctx[7], -0.5)
  assert.equal(ctx[31], ctx[8])
  assert.equal(ctx[4], -0.5)
  assert.equal(ctx[33], 1)
  assert.equal(ctx[40], 1)
  assert.equal(ctx[34], 0)
  updateContext(ctx, state, 1000, 1, { mouthForm: 0.125 })
  assert.equal(ctx[4], 1)
  assert.equal(ctx[31], 0.125)
  assert.equal(ctx[3], 1000)
})
test('explicit accessory slots override the mask and produce the same preset drawing as matching mask bits', () => {
  for (let slot = 0; slot < 8; slot++) {
    const id = 33 + slot
    const explicit = createContext({ variables: { [id]: 1 } })
    const masked = createContext({ variables: { 32: 1 << slot } })
    assert.deepEqual(explicit.subarray(33), masked.subarray(33))
    assert.equal(createContext({ variables: { 32: 255, [id]: 0 } })[id], 0)
    assert.equal(createContext({ variables: { 32: 0, [id]: 1 } })[id], 1)
    for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
      const vm = new AvatarVM(load(name))
      vm.run(explicit)
      const commands = output(vm)
      vm.run(masked)
      assert.deepEqual(output(vm), commands, `${name} accessory ${id}`)
    }
  }
  assert.equal(createContext({ variables: { '034': 1 } })[34], 1)
})
test('clock/blink/breath stop on hide, motion stop, face removal and disposal; restore has no hidden-time jump', () => {
  let frames = 0
  const d = new FaceDriver(() => frames++)
  const c = {
    time: 0,
    visible: true,
    active: true,
    running: false,
    start() {
      this.running = true
    },
    stop() {
      this.running = false
    },
  }
  d.display(c)
  assert.ok(c.running)
  c.time = 33
  d.tick(c)
  assert.equal(d.elapsed, 33)
  d.pause(c)
  assert.equal(c.running, false)
  const before = frames
  c.time = 10000
  d.tick(c)
  assert.equal(d.elapsed, 33)
  assert.equal(frames, before)
  d.resume(c)
  c.time += 33
  d.tick(c)
  assert.equal(d.elapsed, 66)
  d.motions(c, false)
  assert.equal(c.running, false)
  assert.equal(d.openness(), 1)
  c.time += 1000
  d.tick(c)
  assert.equal(d.elapsed, 66)
  d.motions(c, true)
  c.time += 33
  d.tick(c)
  assert.equal(d.elapsed, 99)
  d.undisplay(c)
  assert.equal(c.running, false)
  c.time += 5000
  d.display(c)
  c.time += 33
  d.tick(c)
  assert.equal(d.elapsed, 132)
  c.visible = false
  d.tick(c)
  assert.equal(c.running, false)
  c.visible = true
  c.container = { visible: false }
  d.resume(c)
  assert.equal(c.running, false, 'hidden parent prevents starting timer')
  c.container.visible = true
  d.resume(c)
  assert.equal(c.running, true, 'visible parent allows explicit restoration')
  d.dispose(c)
  d.resume(c)
  d.display(c)
  assert.equal(c.running, false)
  d.elapsed = 2910
  assert.equal(d.openness(), 0)
})
test('VM storage identities stay fixed across 2000 frames; preset mouth sweeps fit Piu primitive capacity', (t) => {
  const vm = new AvatarVM(load('omega_mouth')),
    ctx = createContext()
  const storage = () => [
    vm.stack,
    vm.locals,
    vm.frames,
    vm.commands,
    vm.program.opcodes,
    vm.program.operands,
    vm.program.functions,
  ]
  const buffers = storage()
  for (let i = 0; i < 2000; i++) {
    ctx[8] = ctx[31] = (i % 100) / 100
    vm.run(ctx)
  }
  for (let i = 0; i < buffers.length; i++) assert.equal(storage()[i], buffers[i])
  let maximum = 0
  for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
    const preset = new AvatarVM(load(name)),
      context = createContext({ variables: { 27: 1, 32: 1 } })
    for (let emotion = 0; emotion < 6; emotion++) {
      context[9] = emotion
      for (let mouth = 0; mouth <= 100; mouth++) {
        context[8] = context[31] = mouth / 100
        preset.run(context)
        let primitives = 0
        for (let i = 0; i < preset.count; i++) if (preset.commands[i * 8] < Op.BeginGroup) primitives++
        maximum = Math.max(maximum, primitives)
        assert.ok(primitives <= 32, `${name}: emotion=${emotion}, mouth=${mouth}, primitives=${primitives}`)
      }
    }
  }
  t.diagnostic(`3 presets × 6 expressions × 101 mouth levels: max drawable primitives=${maximum}`)
})
test('500 deterministic byte mutations either validate and terminate within budget or reject', () => {
  const original = load('omega_mouth'),
    ctx = createContext()
  let seed = 0x13579bdf
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  for (let i = 0; i < 500; i++) {
    const bytes = Uint8Array.from(original)
    for (let j = 0; j < 1 + (i % 4); j++) bytes[random() % bytes.length] = random() & 255
    let vm
    try {
      vm = new AvatarVM(bytes, { instructions: 1000, draws: 40 })
      vm.run(ctx)
      assert.ok(vm.count <= 40 && vm.steps <= 1000)
    } catch (error) {
      assert.match(String(error), /AVDS:/)
      if (vm) assert.equal(vm.count, 0)
    }
  }
})
