import { runMiniAppSmoke } from 'mini-app-smoke-behavior'
import Timer from 'timer'

type SmokeContext = Parameters<typeof runMiniAppSmoke>[0] & {
  lifecycle: { close(): Promise<void> }
}

let closeGate: Promise<void> | undefined
let closeCount = 0
let closingContext: SmokeContext | undefined
let reentrantClose: Promise<void> | undefined

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[MiniApp Lin Smoke] ${message}`)
}

const behavior = {
  onLaunch() {
    trace('[MiniApp Lin Smoke] combined archive MOD loaded\n')
    return true
  },
  async onContextCreated(context: SmokeContext) {
    await runMiniAppSmoke(context)
    let releaseClose: () => void = () => {}
    closeGate = new Promise((resolve) => {
      releaseClose = resolve
    })
    closingContext = context
    const first = context.lifecycle.close()
    const second = context.lifecycle.close()
    assert(first === second, 'concurrent context close must share its completion')
    let firstFinished = false
    let secondFinished = false
    void first.then(() => {
      firstFinished = true
    })
    void second.then(() => {
      secondFinished = true
    })
    await new Promise<void>((resolve) => Timer.set(() => resolve(), 10))
    assert(closeCount === 1, 'real context must invoke its MOD cleanup once')
    assert(reentrantClose === first, 'cleanup reentry must wait for the same resource release')
    assert(!firstFinished && !secondFinished, 'every close caller must wait for MOD resource release')
    releaseClose()
    await Promise.all([first, second])
    assert(firstFinished && secondFinished, 'resource release must complete every close caller')
    assert(context.lifecycle.close() === first, 'closed context must retain the same completion')
    assert(closeCount === 1, 'repeated close must not release the MOD resource twice')
    trace('[MiniApp Lin Smoke] ok\n')
  },
  onClose() {
    closeCount++
    reentrantClose = closingContext?.lifecycle.close()
    return closeGate
  },
}

export default behavior
