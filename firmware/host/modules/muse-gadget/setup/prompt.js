import { CONNECT_LABEL, SAVE_LABEL } from './coordinator.js'

export function describeSetupPrompt(coordinator) {
  const state = coordinator.snapshot()
  if (state.phase === 'review')
    return Object.freeze({
      title: '設定情報の保存',
      description: 'WiFiとMuseの資格情報をこの端末に保存します。接続はまだ開始しません。',
      metadata: Object.freeze({ provisionReady: true, saved: false }),
      buttonLabel: SAVE_LABEL,
      confirm: () => coordinator.approveSave(state.revision),
    })
  if (state.phase === 'saved')
    return Object.freeze({
      title: 'Museへの接続',
      description: '保存したWiFi設定とMuse資格情報を使って接続します。',
      metadata: Object.freeze({ provisionReady: false, saved: true }),
      buttonLabel: CONNECT_LABEL,
      confirm: () => coordinator.approveConnect(state.revision),
    })
  return Object.freeze({
    title:
      state.phase === 'connected'
        ? 'Museに接続済み'
        : state.phase === 'closed'
          ? '設定を終了しました'
          : '設定の確認待ち',
    description: '操作可能になるまで確認ボタンは表示しません。',
    metadata: Object.freeze({ provisionReady: state.provisionReady, saved: state.saved }),
  })
}
