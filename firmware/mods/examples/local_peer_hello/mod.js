const SERVICE = 'tech.stackchan.examples.hello'

function report(robot, message) {
  trace(`[local-peer-hello] ${message}\n`)
  robot.ui.showBalloon(message)
}

async function sendHello(robot, session) {
  const peers = await session.discover()
  if (peers.length === 0) {
    report(robot, '近くのｽﾀｯｸﾁｬﾝが見つかりません')
    return
  }
  await session.send(peers[0].id, 'hello', { text: 'こんにちは！' })
  report(robot, `${peers[0].name ?? peers[0].id} に送信しました`)
}

async function initialize(robot) {
  const localPeer = robot.connectivity.localPeer
  if (!localPeer) {
    report(robot, 'ローカル通信はこの機種で利用できません')
    return
  }

  const session = await localPeer.open({
    service: SERVICE,
    displayName: 'stackchan',
    // 暗号化する場合は、通信する全端末に同じ sharedKey を設定します。
    // sharedKey: 'replace-with-a-shared-passphrase',
  })

  session.subscribe('hello', (message) => {
    report(robot, `${message.peer.name ?? message.peer.id} からこんにちは`)
    void session.send(message.peer.id, 'hello.reply', { text: 'こんにちは！' }).catch((error) => {
      report(robot, `返信失敗: ${error.message ?? error}`)
    })
  })
  session.subscribe('hello.reply', (message) => {
    report(robot, `${message.peer.name ?? message.peer.id} から返信が届きました`)
  })
  session.subscribe('wave', (message) => {
    report(robot, `${message.peer.name ?? message.peer.id} が手を振っています`)
  })

  if (robot.input.button?.a) {
    robot.input.button.a.onEvent = (event) => {
      if (!event.pressed) return
      void sendHello(robot, session).catch((error) => report(robot, `送信失敗: ${error.message ?? error}`))
    }
  }

  if (robot.input.button?.b) {
    robot.input.button.b.onEvent = (event) => {
      if (!event.pressed) return
      void session
        .broadcast('wave', { gesture: 'wave' })
        .then(() => report(robot, '近くのｽﾀｯｸﾁｬﾝへ手を振りました'))
        .catch((error) => report(robot, `一斉送信失敗: ${error.message ?? error}`))
    }
  }

  const peers = await session.discover()
  report(robot, `ローカル通信準備完了: ${peers.length}台を発見`)
}

export function onContextCreated(robot) {
  void initialize(robot).catch((error) => report(robot, `初期化失敗: ${error.message ?? error}`))
}
