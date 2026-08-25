import type { MiniAppContext } from 'mini-app'
import definitions from 'miniapp'
import { Application, type Container as PiuContainer, type Content as PiuContent, type Label as PiuLabel } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== mini-app UI sample test ===\n')

type TapBehavior = {
  onTouchBegan?(content: PiuContent, id: number, x: number, y: number, ticks: number): void
  onTouchEnded?(content: PiuContent, id: number, x: number, y: number, ticks: number): void
}

function tap(content: PiuContent): void {
  const behavior = content.behavior as TapBehavior
  behavior.onTouchBegan?.(content, 0, 1, 1, 0)
  if (!behavior.onTouchEnded) throw new Error(`${content.name} should be tappable`)
  behavior.onTouchEnded(content, 0, 1, 1, 0)
}

function findNamed(root: PiuContainer, name: string): PiuContent | undefined {
  for (let content = root.first; content; content = content.next) {
    if (content.name === name) return content
    const nested = findNamed(content as PiuContainer, name)
    if (nested) return nested
  }
}

function named(root: PiuContainer, name: string): PiuContent {
  const content = findNamed(root, name)
  if (!content) throw new Error(`${name} should exist`)
  return content
}

equal(definitions.length, 1, 'sample archive should expose one mini app')
equal(definitions[0].id, 'sample.ui-playground', 'sample should expose a stable id')

let closeCount = 0
const context: MiniAppContext = Object.freeze({
  width: 320,
  height: 196,
  close() {
    closeCount += 1
  },
})
const root = definitions[0].create(context) as PiuContainer
new Application(null, { displayListLength: 4096, contents: [root] })

const ocean = named(root, 'mark:Ocean')
const forest = named(root, 'mark:Forest')
assert(ocean.visible && !forest.visible, 'Ocean should be selected initially')

tap(named(root, 'choice:Forest'))
assert(!ocean.visible && forest.visible, 'tapping a choice should move the selected marker')
const notice = named(root, 'notice') as PiuLabel
assert(notice.visible, 'selection should show a notification')
equal(notice.string, 'Forest selected', 'notification should name the selected choice')
const noticeArea = named(root, 'notice-area')
const actions = named(root, 'actions')
assert(noticeArea.y + noticeArea.height <= actions.y, 'notification area should not cover actions at 196px')

const help = named(root, 'help')
tap(named(root, 'help:open'))
assert(help.visible, 'help action should show the overlay')
const helpClose = named(root, 'help:close')
assert(helpClose.width === 108 && helpClose.height === 30, 'help close action should retain its 108x30 size')
tap(helpClose)
assert(!help.visible, 'close action should hide the overlay')

tap(named(root, 'app:close'))
equal(closeCount, 1, 'exit action should delegate to the host context')

trace('ok\n')
