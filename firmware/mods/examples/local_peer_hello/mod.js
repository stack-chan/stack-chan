import { extractReceivedText, sanitizeReceivedText } from 'local-peer-hello-text'
import config from 'mod/config'
import Timer from 'timer'

const SERVICE = 'tech.stackchan.examples.hello'
const MESSAGE_TYPE = 'text'
const RECEIVER_NAME = 'stackchan-receiver'
const SENDER_NAME = 'stackchan-sender'
const DEFAULT_SEND_INTERVAL_MS = 3000
const DISCOVERY_TIMEOUT_MS = 1000
const RETRY_INTERVAL_MS = 2000
const MAX_SEQUENCE = 999999

function report(robot, message) {
  const safeMessage = sanitizeReceivedText(message) ?? '表示できないメッセージです'
  trace(`[local-peer-hello] ${safeMessage}\n`)
  robot.ui.showBalloon(safeMessage)
}

function delay(durationMs) {
  return new Promise((resolve) => Timer.set(resolve, durationMs))
}

function readRole() {
  const role = config.localPeerHello?.role ?? 'receiver'
  if (role !== 'receiver' && role !== 'sender') {
    throw new Error(`localPeerHello.role must be "receiver" or "sender": ${role}`)
  }
  return role
}

function readSendIntervalMs() {
  const value = config.localPeerHello?.sendIntervalMs
  return Number.isInteger(value) && value >= 500 ? value : DEFAULT_SEND_INTERVAL_MS
}

async function runSender(robot, session) {
  let sequence = 1
  let receiver
  let waitingForReceiver = false
  const sendIntervalMs = readSendIntervalMs()

  report(robot, '送信機: 受信機を探しています')
  while (true) {
    try {
      if (!receiver) {
        const peers = await session.discover({ timeoutMs: DISCOVERY_TIMEOUT_MS })
        receiver = peers.find((peer) => peer.name === RECEIVER_NAME)
      }
      if (!receiver) {
        if (!waitingForReceiver) report(robot, '送信機: 受信機が見つかりません')
        waitingForReceiver = true
        await delay(RETRY_INTERVAL_MS)
        continue
      }

      waitingForReceiver = false
      const text = `hello world ${sequence}`
      await session.send(receiver.id, MESSAGE_TYPE, { text })
      report(robot, `送信: ${text}`)
      sequence = sequence >= MAX_SEQUENCE ? 1 : sequence + 1
      await delay(sendIntervalMs)
    } catch (error) {
      receiver = undefined
      report(robot, `送信失敗: ${error?.message ?? error}`)
      await delay(RETRY_INTERVAL_MS)
    }
  }
}

function runReceiver(robot, session) {
  session.subscribe(MESSAGE_TYPE, (message) => {
    const text = extractReceivedText(message.payload)
    if (text === undefined) {
      trace(`[local-peer-hello] rejected invalid text payload from ${message.peer.id}\n`)
      return
    }
    trace(`[local-peer-hello] received from ${message.peer.id}: ${text}\n`)
    robot.ui.showBalloon(text)
  })
  report(robot, '受信機: メッセージを待っています')
}

async function initialize(robot) {
  const localPeer = robot.connectivity.localPeer
  if (!localPeer) {
    report(robot, 'ローカル通信はこの機種で利用できません')
    return
  }

  const role = readRole()
  const session = await localPeer.open({
    service: SERVICE,
    displayName: role === 'sender' ? SENDER_NAME : RECEIVER_NAME,
  })

  if (role === 'sender') {
    await runSender(robot, session)
  } else {
    runReceiver(robot, session)
  }
}

export function onContextCreated(robot) {
  void initialize(robot).catch((error) => report(robot, `初期化失敗: ${error?.message ?? error}`))
}
