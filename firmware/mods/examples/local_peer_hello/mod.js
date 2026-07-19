import { extractReceivedText, sanitizeReceivedText } from 'local-peer-hello-text'
import Timer from 'timer'

const SERVICE = 'tech.stackchan.examples.hello'
const MESSAGE_TYPE = 'text'
const RECEIVER_NAME = 'stackchan-receiver'
const SENDER_NAME = 'stackchan-sender'
const DRAWER_KEY = 'localPeerRole'
const ROLE_STOPPED = 'stopped'
const ROLE_SENDER = 'sender'
const ROLE_RECEIVER = 'receiver'
const SEND_INTERVAL_MS = 3000
const DISCOVERY_TIMEOUT_MS = 1000
const RETRY_INTERVAL_MS = 2000
const MAX_SEQUENCE = 999999
const ROLE_OPTIONS = [
  { value: ROLE_STOPPED, label: '停止' },
  { value: ROLE_SENDER, label: '送信' },
  { value: ROLE_RECEIVER, label: '受信' },
]

function report(robot, message) {
  const safeMessage = sanitizeReceivedText(message) ?? '表示できないメッセージです'
  trace(`[local-peer-hello] ${safeMessage}\n`)
  robot.ui.showBalloon(safeMessage)
}

function createCancellableDelay() {
  let cancelCurrent

  return {
    cancel() {
      cancelCurrent?.()
    },
    wait(durationMs) {
      cancelCurrent?.()
      return new Promise((resolve) => {
        let pending = true
        const timer = Timer.set(() => {
          if (!pending) return
          pending = false
          cancelCurrent = undefined
          resolve(true)
        }, durationMs)
        cancelCurrent = () => {
          if (!pending) return
          pending = false
          Timer.clear(timer)
          cancelCurrent = undefined
          resolve(false)
        }
      })
    },
  }
}

async function runSender(robot, session, isActive, senderDelay) {
  let sequence = 1
  let receiver
  let waitingForReceiver = false

  report(robot, '送信機: 受信機を探しています')
  while (isActive()) {
    try {
      if (!receiver) {
        const peers = await session.discover({ timeoutMs: DISCOVERY_TIMEOUT_MS })
        if (!isActive()) return
        receiver = peers.find((peer) => peer.name === RECEIVER_NAME)
      }
      if (!receiver) {
        if (!waitingForReceiver) report(robot, '送信機: 受信機が見つかりません')
        waitingForReceiver = true
        if (!(await senderDelay.wait(RETRY_INTERVAL_MS))) return
        continue
      }

      waitingForReceiver = false
      const text = `hello world ${sequence}`
      await session.send(receiver.id, MESSAGE_TYPE, { text })
      if (!isActive()) return
      report(robot, `送信: ${text}`)
      sequence = sequence >= MAX_SEQUENCE ? 1 : sequence + 1
      if (!(await senderDelay.wait(SEND_INTERVAL_MS))) return
    } catch (error) {
      if (!isActive()) return
      receiver = undefined
      report(robot, `送信失敗: ${error?.message ?? error}`)
      if (!(await senderDelay.wait(RETRY_INTERVAL_MS))) return
    }
  }
}

function runReceiver(robot, session) {
  const unsubscribe = session.subscribe(MESSAGE_TYPE, (message) => {
    const text = extractReceivedText(message.payload)
    if (text === undefined) {
      trace(`[local-peer-hello] rejected invalid text payload from ${message.peer.id}\n`)
      return
    }
    trace(`[local-peer-hello] received from ${message.peer.id}: ${text}\n`)
    robot.ui.showBalloon(text)
  })
  report(robot, '受信機: メッセージを待っています')
  return unsubscribe
}

function createRoleController(robot, localPeer) {
  const senderDelay = createCancellableDelay()
  let activeSession
  let unsubscribe
  let revision = 0
  let transition = Promise.resolve()

  function stopActiveSession() {
    senderDelay.cancel()
    unsubscribe?.()
    unsubscribe = undefined
    const session = activeSession
    activeSession = undefined
    session?.close()
  }

  async function applyRole(role, selectedRevision) {
    if (selectedRevision !== revision || role === ROLE_STOPPED) return

    report(robot, role === ROLE_SENDER ? 'P2P: 送信を開始します' : 'P2P: 受信を開始します')
    const session = await localPeer.open({
      service: SERVICE,
      displayName: role === ROLE_SENDER ? SENDER_NAME : RECEIVER_NAME,
    })
    if (selectedRevision !== revision) {
      session.close()
      return
    }

    activeSession = session
    if (role === ROLE_RECEIVER) {
      unsubscribe = runReceiver(robot, session)
      return
    }

    const isActive = () => selectedRevision === revision && activeSession === session
    void runSender(robot, session, isActive, senderDelay).catch((error) => {
      if (isActive()) report(robot, `送信処理失敗: ${error?.message ?? error}`)
    })
  }

  return {
    select(role) {
      if (role !== ROLE_STOPPED && role !== ROLE_SENDER && role !== ROLE_RECEIVER) return transition

      revision += 1
      const selectedRevision = revision
      stopActiveSession()
      if (role === ROLE_STOPPED) report(robot, 'P2P: 停止')
      transition = transition
        .then(() => applyRole(role, selectedRevision))
        .catch((error) => {
          if (selectedRevision === revision) report(robot, `P2P開始失敗: ${error?.message ?? error}`)
        })
      return transition
    },
  }
}

function initialize(robot) {
  const localPeer = robot.connectivity.localPeer
  if (!localPeer) {
    report(robot, 'ローカル通信はこの機種で利用できません')
    return
  }

  const controller = createRoleController(robot, localPeer)
  robot.ui.drawer.addDrawerButton({
    key: DRAWER_KEY,
    label: 'P2P',
    kind: 'choice',
    value: ROLE_STOPPED,
    options: ROLE_OPTIONS,
    callback: (_context, role) => controller.select(role),
  })
  report(robot, 'P2P: 停止')
}

export function onContextCreated(robot) {
  initialize(robot)
}
