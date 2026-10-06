import 'host-main'
import { setLocalizationLanguage } from 'localization'
import type { Application as PiuApplication, Content as PiuContent } from 'piu/MC'
import { Label } from 'piu/MC'
import type { TestState } from 'startup-error-ports'
import {
  showStartupError,
  showStartupSplash,
  showWiFiConnectionStatus,
  showWiFiRecoveryChoice,
  startupErrorClass,
} from 'startup-splash'
import { equal } from 'testing/assert'
import Timer from 'timer'

const environment = globalThis as unknown as { application?: PiuApplication; startupErrorTestState?: TestState }
function visibleStrings(content: PiuContent | null | undefined): string {
  if (!content) return ''
  const node = content as PiuContent & { string?: string; first?: PiuContent }
  return [node.string ?? '', visibleStrings(node.first), visibleStrings(node.next)].join('\n')
}
function screenStrings(): string {
  return visibleStrings(environment.application?.first)
}
function find(content: PiuContent | null | undefined, name: string): PiuContent | undefined {
  if (!content) return undefined
  const node = content as PiuContent & { name?: string; first?: PiuContent }
  return node.name === name ? node : (find(node.first, name) ?? find(node.next, name))
}
function tap(content: PiuContent | undefined) {
  equal(!!content, true, 'recovery action must exist in the attached view')
  const behavior = content?.behavior as {
    onTouchBegan(content: PiuContent, id: number, x: number, y: number): void
    onTouchEnded(content: PiuContent): void
  }
  behavior.onTouchBegan(content as PiuContent, 0, 0, 0)
  behavior.onTouchEnded(content as PiuContent)
}

setLocalizationLanguage('en')
showStartupSplash()
// Each manifest is a fresh boot through the real entry. Wait for the attached
// view instead of racing startup promises with a fixed assertion timer.
let startupChecks = 0
const startupTimer = Timer.repeat(() => {
  const state = environment.startupErrorTestState as TestState
  const ready = screenStrings().includes(state?.replaceOnClose ? 'New screen' : 'Startup failed')
  if (++startupChecks < 100 && !ready) return
  Timer.clear(startupTimer)
  // Cleanup can attach the replacement screen before main's catch resumes.
  // Drain those continuations so the stale-screen assertion observes main too.
  void Promise.resolve()
    .then(() => Promise.resolve())
    .then(run)
}, 10)

function run() {
  const state = environment.startupErrorTestState as TestState
  equal(!!state, true, 'real host entry must initialize the fixture dependencies')
  if (state.replaceOnClose) {
    equal(screenStrings().includes('New screen'), true, 'cleanup must retain a newer screen')
    equal(screenStrings().includes('Startup failed'), false, 'older startup must not resurrect its failure view')
  } else {
    equal(screenStrings().includes('Startup failed'), true, '#250: actual startup failure must be visible')
    equal(
      screenStrings().includes(state.phase === 'behavior' ? 'Behavior startup' : 'Robot initialization'),
      true,
      'actual entry must identify its failed phase',
    )
    equal(screenStrings().includes('RangeError'), true, 'cleanup failure must not replace the original error class')
    equal(
      screenStrings().includes('fixture-secret'),
      false,
      'entry failure must not expose credentials from its message',
    )
    equal(screenStrings().includes('cleanup-secret'), false, 'cleanup failure must not expose its message')
  }
  equal(state.closeCount, state.phase === 'behavior' ? 1 : 0, 'created context must close on behavior failure')
  equal(state.dockCloseCount, state.phase === 'context' ? 1 : 0, 'pre-context failure must close its dock')

  let restarts = 0
  const restart = () => restarts++
  for (const [phase, label] of [
    ['initialization', 'System initialization'],
    ['launch', 'Application launch'],
    ['network', 'Network connection'],
    ['context', 'Robot initialization'],
    ['behavior', 'Behavior startup'],
  ] as const) {
    const error = new TypeError('password=private-secret token=private-token')
    Object.defineProperty(error, 'name', { value: 'private-custom-name' })
    showStartupError({ phase, error, onRestart: restart })
    equal(screenStrings().includes(label), true, 'every failure view must identify its startup phase')
    equal(screenStrings().includes('TypeError'), true, 'display a recognized error class')
    equal(screenStrings().includes('private-'), false, 'exception messages and custom names must stay off-screen')
  }
  showStartupError({ phase: 'context', error: 'password=string-secret', onRestart: restart })
  equal(screenStrings().includes('string-secret'), false, 'string rejections must not leak arbitrary content')
  const unknownError = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new Error('password=proxy-secret')
      },
    },
  )
  equal(startupErrorClass(unknownError), 'Error', 'uninspectable rejections must not break error handling')
  showStartupError({ phase: 'context', error: unknownError, onRestart: restart })
  equal(screenStrings().includes('proxy-secret'), false, 'uninspectable rejections must not expose diagnostics')

  const restartButton = find(environment.application?.first, 'startup:restart')
  tap(restartButton)
  tap(restartButton)
  equal(restarts, 1, 'restart recovery must run once even after repeated taps')
  showWiFiConnectionStatus({ attempt: 2, maxAttempts: 3 })
  showWiFiRecoveryChoice({ message: 'Late result' })
  equal(screenStrings().includes('Startup failed'), true, 'late Wi-Fi callbacks must not replace the failure')

  showStartupError({ phase: 'context', error: new Error('device error'), onRestart: restart })
  const detachedButton = find(environment.application?.first, 'startup:restart')
  environment.application?.empty()
  environment.application?.add(new Label(null, { string: 'New screen', top: 0, left: 0, width: 320, height: 40 }))
  tap(detachedButton)
  equal(restarts, 1, 'detached recovery actions must not restart a newer screen')

  environment.application = undefined
  showStartupError({ phase: 'initialization', error: new Error('early failure'), onRestart: restart })
  equal(screenStrings().includes('Startup failed'), true, 'failure before any splash must still create an error view')
  trace('ok\n')
}
