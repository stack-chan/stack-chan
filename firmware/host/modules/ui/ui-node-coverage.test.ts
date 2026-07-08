import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installUiNodeTestAliases } from './__tests__/node-piu-harness.js'

installUiNodeTestAliases()

const piuModule = 'piu/MC'
const piu = (await import(piuModule)) as unknown as PiuRuntime
const faceStateModule = await import('face-state')
const drawerModule = await import('drawer')
const commonViewModule = await import('common-view')
const faceViewModule = await import('face-view')
const multirowModule = await import('effects/multirow-balloon')
const emoticonModule = await import('effects/emoticon')
const blinkModule = await import('motions/blink')
const breathModule = await import('motions/breath')
const saccadeModule = await import('motions/saccade')
const faceBehaviorModule = await import('behaviors/face')

const { Container, Content } = piu
const BehaviorBase = (globalThis as typeof globalThis & { Behavior: new () => object }).Behavior
const { createFaceState, setColorRGB, toPiuColorNumber } = faceStateModule
const { Drawer } = drawerModule as unknown as { Drawer: new (data?: unknown) => PiuNode }
const { CommonView } = commonViewModule as unknown as { CommonView: new (data: Record<string, unknown>) => PiuNode }
const { FaceView } = faceViewModule as unknown as { FaceView: new (data: Record<string, unknown>) => PiuNode }
const { MultiRowBalloon } = multirowModule as unknown as { MultiRowBalloon: new (data?: unknown) => PiuNode }
const { Emoticon } = emoticonModule as unknown as { Emoticon: new (data?: unknown) => PiuNode }
const { createBlinkMotion } = blinkModule
const { createBreathMotion } = breathModule
const { createSaccadeMotion } = saccadeModule
const { FaceBehavior: BaseFaceBehavior } = faceBehaviorModule

type PiuNode = {
  name?: string
  first?: PiuNode | null
  last?: PiuNode | null
  next?: PiuNode | null
  previous?: PiuNode | null
  children?: PiuNode[]
  behavior?: BehaviorBag
  coordinates?: Record<string, number>
  active?: boolean
  visible?: boolean
  backgroundTouch?: boolean
  skin?: unknown
  style?: unknown
  string?: string
  interval?: number
  time?: number
  duration?: number
  running?: boolean
  invalidated?: number
  draws?: unknown[][]
  lastBubble?: unknown[]
  top?: number
}

type PiuRuntime = {
  Container: new (data?: unknown, options?: Record<string, unknown>) => PiuNode
  Content: new (data?: unknown, options?: Record<string, unknown>) => PiuNode
}

type BehaviorBag = Record<string, unknown> & {
  isOpen?: boolean
  faceMain?: PiuNode
  overlay?: PiuNode
  setOpen?: (node: PiuNode, open: boolean) => void
  onTimeChanged?: (node: PiuNode) => void
  setButtonState?: (node: PiuNode, key: string, active: boolean) => boolean
  addButton?: (node: PiuNode, button: unknown) => boolean
  removeButton?: (node: PiuNode, key: string) => boolean
  setButtons?: (node: PiuNode, buttons: unknown[]) => boolean
  setMain?: (node: PiuNode) => void
  setDrawerButtonState?: (key: string, active: boolean) => void
  openDrawer?: () => void
  setDrawerButtons?: (buttons: unknown[]) => void
  onFaceUpdate?: (node: PiuNode, faceState: ReturnType<typeof createFaceState>) => void
  showFace?: () => void
  onDisplaying?: (node: PiuNode) => void
  onUndisplaying?: (node: PiuNode) => void
  onFaceState?: (node: PiuNode, faceState: ReturnType<typeof createFaceState>) => void
  onDraw?: (node: PiuNode) => void
  setText?: (node: PiuNode, text: string) => void
  clear?: (node: PiuNode) => void
  onCreate?: (node: PiuNode) => void
  pause?: (node: PiuNode) => void
  resume?: (node: PiuNode) => void
  rehydrate?: (node: PiuNode, faceState: ReturnType<typeof createFaceState>) => void
}

function childArray(node: PiuNode): PiuNode[] {
  const children: PiuNode[] = []
  let current = node.first ?? null
  while (current) {
    children.push(current)
    current = current.next ?? null
  }
  return children
}

function childAt(node: PiuNode, index: number): PiuNode {
  const child = childArray(node)[index]
  assert.ok(child, `child ${index} should exist`)
  return child
}

function findNamed(root: PiuNode, name: string): PiuNode | null {
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.name === name) return node
    stack.push(...childArray(node))
  }
  return null
}

function themedFace(primary: number, secondary = 0x000000): ReturnType<typeof createFaceState> {
  const face = createFaceState()
  setColorRGB(face.theme.primary, (primary >> 16) & 0xff, (primary >> 8) & 0xff, primary & 0xff)
  setColorRGB(face.theme.secondary, (secondary >> 16) & 0xff, (secondary >> 8) & 0xff, secondary & 0xff)
  return face
}

test('Drawer opens/closes, mutates buttons, and syncs toggle state', () => {
  const drawer = new Drawer({
    buttons: [
      { key: 'speech', label: 'Speech', kind: 'toggle', active: false },
      { key: 'settings', label: 'Settings' },
    ],
  }) as PiuNode
  const behavior = drawer.behavior
  assert.ok(behavior)
  assert.equal(behavior.isOpen, false)
  assert.equal(drawer.coordinates?.right, -113)

  behavior.setOpen?.(drawer, true)
  assert.equal(behavior.isOpen, true)
  drawer.time = drawer.duration
  behavior.onTimeChanged?.(drawer)
  assert.equal(drawer.coordinates?.right, 0)

  behavior.setOpen?.(drawer, false)
  assert.equal(behavior.isOpen, false)
  drawer.time = drawer.duration
  behavior.onTimeChanged?.(drawer)
  assert.equal(drawer.coordinates?.right, -113)

  const list = childAt(childAt(drawer, 0), 0)
  const firstToggle = childAt(list, 0)
  const toggleIcon = childAt(firstToggle, 0)
  const offSkin = toggleIcon.skin
  assert.equal(behavior.setButtonState?.(drawer, 'speech', true), true)
  assert.notEqual(toggleIcon.skin, offSkin)

  assert.equal(behavior.addButton?.(drawer, { key: 'extra', label: 'Extra' }), true)
  assert.ok(findNamed(list, 'extra'))
  assert.equal(behavior.removeButton?.(drawer, 'extra'), true)
  assert.equal(findNamed(list, 'extra'), null)
})

test('CommonView preserves z-order and rebuilds Drawer only on fallback branches', () => {
  const main = new Container(null, { name: 'main' }) as PiuNode
  const appBar = new Content(null, { name: 'appBar' }) as PiuNode
  const view = new CommonView({
    main,
    appBar,
    drawerButtons: [{ key: 'speech', label: 'Speech', kind: 'toggle' }],
  }) as PiuNode
  const behavior = view.behavior
  assert.ok(behavior)

  const initialDrawer = findNamed(view, 'drawer')
  assert.ok(initialDrawer)
  assert.deepEqual(
    childArray(view).map((child) => child.name),
    ['main', 'appBar', undefined, 'drawer'],
  )

  let shown = 0
  let hidden = 0
  const replacement = new Container(null, {
    name: 'replacement',
    Behavior: class extends BehaviorBase {
      onShow() {
        shown += 1
      }
      onHide() {
        hidden += 1
      }
    },
  }) as PiuNode
  behavior.setMain?.(replacement)
  assert.equal(shown, 1)
  assert.equal(hidden, 0)
  assert.deepEqual(
    childArray(view).map((child) => child.name),
    ['replacement', 'appBar', undefined, 'drawer'],
  )
  behavior.setMain?.(main)
  assert.equal(hidden, 1)
  assert.deepEqual(
    childArray(view).map((child) => child.name),
    ['main', 'appBar', undefined, 'drawer'],
  )

  behavior.setDrawerButtonState?.('speech', true)
  behavior.openDrawer?.()
  assert.equal(behavior.drawerOpen, true)
  assert.equal((behavior.overlay as PiuNode).active, true)

  const drawerBehavior = (initialDrawer as PiuNode).behavior
  assert.ok(drawerBehavior)
  drawerBehavior.setButtons = () => false
  behavior.setDrawerButtons?.([
    { key: 'speech', label: 'Speech', kind: 'toggle' },
    { key: 'camera', label: 'Camera' },
  ])
  const replacementDrawer = findNamed(view, 'drawer')
  assert.ok(replacementDrawer)
  assert.notEqual(replacementDrawer, initialDrawer)
  assert.equal(behavior.drawerOpen, true)
  assert.equal((replacementDrawer.behavior as Record<string, unknown>).isOpen, true)
  assert.equal((behavior.overlay as PiuNode).active, true)
  assert.ok(findNamed(replacementDrawer, 'camera'))

  const speechButton = findNamed(replacementDrawer, 'speech')
  assert.ok(speechButton)
  const speechIcon = childAt(speechButton, 0)
  assert.equal(speechIcon.skin, childAt(speechButton, 0).skin, 'stored toggle state should be applied after replace')
})

test('FaceView showFace restores the face main layer and rehydrates the cached state', () => {
  const seenUpdates: number[] = []
  const rehydrated: number[] = []
  const face = new Container(null, {
    left: 16,
    top: 24,
    width: 80,
    height: 48,
    Behavior: class extends BehaviorBase {
      get breathPixels() {
        return 4
      }
      onFaceUpdate(_content: PiuNode, faceState: ReturnType<typeof createFaceState>) {
        seenUpdates.push(toPiuColorNumber(faceState.theme.primary))
      }
      rehydrate(_content: PiuNode, faceState: ReturnType<typeof createFaceState>) {
        rehydrated.push(toPiuColorNumber(faceState.theme.primary))
      }
      getBaseCoordinates() {
        return { left: 4, top: 4 }
      }
    },
  }) as PiuNode
  const view = new FaceView({ face }) as PiuNode
  const behavior = view.behavior
  assert.ok(behavior)
  const faceMain = behavior.faceMain as PiuNode
  assert.equal(childAt(view, 0), faceMain)

  const first = themedFace(0x123456, 0x111111)
  const second = themedFace(0xabcdef, 0x222222)
  behavior.onFaceUpdate?.(view, first)
  const modal = new Container(null, { name: 'modal' }) as PiuNode
  behavior.setMain?.(modal)
  assert.equal(childAt(view, 0), modal)

  behavior.onFaceUpdate?.(view, second)
  assert.deepEqual(seenUpdates, [0x123456], 'non-face main should pause MOD-facing face updates')

  behavior.showFace?.()
  assert.equal(childAt(view, 0), faceMain)
  assert.equal(rehydrated.at(-1), 0x123456, 'showFace should restore the cached face state from before pause')
})

test('MultiRowBalloon initializes parts, updates palette, and keeps text controls live', () => {
  const balloon = new MultiRowBalloon({ text: 'hello', width: 120, height: 32 }) as PiuNode
  const behavior = balloon.behavior
  assert.ok(behavior)

  behavior.onDisplaying?.(balloon)
  const background = childAt(balloon, 0)
  const bodyText = childAt(balloon, 1)
  assert.equal(bodyText.string, 'hello')
  assert.ok(background.invalidated)

  const defaultStyle = bodyText.style
  behavior.onFaceState?.(balloon, themedFace(0x336699, 0x111111))
  assert.notEqual(bodyText.style, defaultStyle)
  assert.ok((background.invalidated ?? 0) > 1)

  behavior.setText?.(balloon, 'updated')
  assert.equal(bodyText.string, 'updated')
  behavior.clear?.(balloon)
  assert.equal(bodyText.string, '')
})

test('Emoticon variants invalidate, draw atlas frames, and react to theme changes', () => {
  for (const key of ['heart', 'angry', 'sweat', 'tear', 'sleepy'] as const) {
    const effect = new Emoticon({ key, width: 64, height: 64, count: 2 }) as PiuNode
    assert.equal(effect.name, `Emoticon:${key}`)
    const port = childAt(effect, 0)
    const behavior = port.behavior
    assert.ok(behavior)

    behavior.onDisplaying?.(port)
    assert.equal(port.running, true)
    assert.ok(port.invalidated)
    behavior.onTimeChanged?.(port)
    assert.ok((port.invalidated ?? 0) > 1)
    behavior.onFaceState?.(port, themedFace(0xff00aa, 0x003355))
    behavior.onDraw?.(port)
    assert.ok(
      port.draws?.some((entry) => entry[0] === 'drawTexture'),
      `${key} should draw from the atlas`,
    )
    behavior.onUndisplaying?.(port)
    assert.equal(port.running, false)
  }
})

test('Face motions cover blink, breath, and saccade state transitions', () => {
  const blink = createBlinkMotion({ openMin: 10, openMax: 10, closeMin: 10, closeMax: 10 })
  const blinkingFace = createFaceState()
  blink(10, blinkingFace)
  blink(5, blinkingFace)
  blinkingFace.eyes.left.open = 1
  blinkingFace.eyes.right.open = 1
  blink(0, blinkingFace)
  assert.ok(blinkingFace.eyes.left.open < 1)
  assert.equal(blinkingFace.eyes.left.open, blinkingFace.eyes.right.open)

  const breath = createBreathMotion({ duration: 1000 })
  const breathingFace = createFaceState()
  breath(250, breathingFace)
  assert.equal(breathingFace.breath, 1)
  breath(500, breathingFace)
  assert.equal(breathingFace.breath, -1)

  const originalRandom = Math.random
  const values = [0.5, 0.5, 0.75, 0.5, 0.5, 0.75]
  Math.random = () => values.shift() ?? 0.5
  try {
    const saccade = createSaccadeMotion({ updateMin: 0, updateMax: 0, gain: 0.2 })
    const saccadeFace = createFaceState()
    saccade(1, saccadeFace)
    assert.notEqual(saccadeFace.eyes.left.gazeX, 0)
    assert.equal(saccadeFace.eyes.left.gazeX, saccadeFace.eyes.right.gazeX)
    assert.equal(saccadeFace.eyes.left.gazeY, saccadeFace.eyes.right.gazeY)
  } finally {
    Math.random = originalRandom
  }
})

test('FaceBehavior breath, pause, resume, and rehydrate paths preserve distributed state', () => {
  const recorded: number[] = []
  const child = new Content(null, {
    Behavior: class extends BehaviorBase {
      onFaceState(_content: PiuNode, faceState: ReturnType<typeof createFaceState>) {
        recorded.push(toPiuColorNumber(faceState.theme.primary))
      }
    },
  }) as PiuNode
  const face = new Container(null, {
    left: 10,
    top: 20,
    contents: [child],
    Behavior: class extends BaseFaceBehavior {
      constructor() {
        super({
          intervalMs: 33,
          motions: [
            (_tick: number, faceState: ReturnType<typeof createFaceState>) => {
              faceState.breath = 1
            },
          ],
        })
      }
    },
  }) as PiuNode
  const behavior = face.behavior
  assert.ok(behavior)
  behavior.onCreate?.(face)
  behavior.onDisplaying?.(face)
  const initialTop = face.coordinates?.top
  behavior.onTimeChanged?.(face)
  assert.equal(face.coordinates?.top, (initialTop ?? 20) + 6)

  behavior.pause?.(face)
  assert.equal(face.running, false)
  assert.equal(face.visible, false)
  assert.equal(face.active, false)
  behavior.onTimeChanged?.(face)
  assert.equal(face.coordinates?.top, (initialTop ?? 20) + 6)

  const restored = themedFace(0x445566, 0x010203)
  behavior.rehydrate?.(face, restored)
  behavior.resume?.(face)
  assert.equal(face.running, true)
  assert.equal(face.visible, true)
  assert.equal(face.active, true)
  assert.equal(recorded.at(-1), 0x445566)
  assert.deepEqual(face.lastBubble?.slice(0, 2), ['onFaceState', restored])
})
