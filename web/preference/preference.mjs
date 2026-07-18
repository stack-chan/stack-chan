import SimpleBLEClient from './ble-client.mjs'

function errorDetail(error) {
  if (error instanceof Error) return error.message
  if (error != null && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

/** Initializes the preference page and permits an injected BLE client for runtime tests. */
export function initializePreferencePage({
  document: pageDocument = globalThis.document,
  confirm: confirmAction = globalThis.confirm,
  client: suppliedClient,
} = {}) {
  const requiredElement = (id) => {
    const element = pageDocument.getElementById(id)
    if (element == null) throw new Error(`Missing preference element: ${id}`)
    return element
  }
  const form = requiredElement('form-preference')
  const connectButton = requiredElement('ble-connect-button')
  const disconnectButton = requiredElement('ble-disconnect-button')
  const submitButton = requiredElement('preference-submit-button')
  const clearWiFiButton = requiredElement('wifi-clear-button')
  const connectionStatus = requiredElement('connection-status')
  const saveStatus = requiredElement('save-status')
  const controls = [...form.querySelectorAll('input, select, textarea, button')]
  let submitting = false
  const currentValues = new Map()

  const setStatus = (element, text, state = '') => {
    element.textContent = text
    element.dataset.state = state
  }
  const onCharacteristicValueChanged = ({ prop, value }) => {
    currentValues.set(prop, String(value))
    const element = pageDocument.querySelector(`[name="${prop}"]`)
    if (element != null) element.value = value
  }
  const client =
    suppliedClient ??
    new SimpleBLEClient({
      deviceName: 'STK',
      onCharacteristicValueChanged,
    })
  const updateView = () => {
    const connected = client.isConnected()
    connectButton.hidden = connected
    disconnectButton.hidden = !connected
    controls.forEach((control) => {
      control.disabled = !connected
    })
    setStatus(connectionStatus, connected ? '接続済み' : '未接続', connected ? 'success' : '')
  }

  connectButton.addEventListener('click', async () => {
    connectButton.disabled = true
    setStatus(connectionStatus, '接続中…')
    try {
      await client.connect()
    } catch (error) {
      console.error(error)
      setStatus(connectionStatus, `接続できませんでした: ${errorDetail(error)}`, 'error')
    } finally {
      connectButton.disabled = false
      if (client.isConnected()) updateView()
    }
  })
  disconnectButton.addEventListener('click', async () => {
    disconnectButton.disabled = true
    try {
      await client.disconnect()
    } catch (error) {
      console.error(error)
      setStatus(connectionStatus, `切断できませんでした: ${errorDetail(error)}`, 'error')
    } finally {
      disconnectButton.disabled = false
      if (!client.isConnected()) updateView()
    }
  })

  clearWiFiButton.addEventListener('click', async () => {
    if (!client.isConnected() || submitting) return
    if (
      typeof confirmAction !== 'function' ||
      !confirmAction('保存済みのSSIDとパスワードを消去しますか？次回はオフラインで起動します。')
    )
      return
    clearWiFiButton.disabled = true
    submitButton.disabled = true
    submitting = true
    setStatus(saveStatus, 'Wi-Fi設定を消去中…')
    try {
      const payload = { 'wifi.ssid': '', 'wifi.password': '' }
      await client.send({ _batch: payload })
      for (const [prop, value] of Object.entries(payload)) {
        currentValues.set(prop, value)
        const element = pageDocument.getElementById(prop)
        if (element != null) element.value = value
      }
      setStatus(saveStatus, 'Wi-Fi設定を消去しました。再起動後はオフラインになります。', 'success')
    } catch (error) {
      console.error(error)
      setStatus(saveStatus, `Wi-Fi設定を消去できませんでした: ${errorDetail(error)}`, 'error')
    } finally {
      submitting = false
      clearWiFiButton.disabled = !client.isConnected()
      submitButton.disabled = !client.isConnected()
    }
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!client.isConnected() || submitting) return
    const props = [
      'wifi.ssid',
      'wifi.password',
      'driver.type',
      'driver.offsetPan',
      'driver.offsetTilt',
      'ui.type',
      'tts.type',
      'tts.host',
      'tts.port',
      'tts.token',
      'tts.voice',
      'tts.volume',
      'ai.token',
      'ai.context',
    ]
    const payload = {}
    for (const prop of props) {
      const value = pageDocument.getElementById(prop)?.value
      if (value != null && value.trimEnd().length > 0 && currentValues.get(prop) !== value) {
        payload[prop] = value
      }
    }
    if (Object.keys(payload).length === 0) {
      setStatus(saveStatus, '変更する項目がありません。')
      return
    }
    submitButton.disabled = true
    setStatus(saveStatus, '保存中…')
    submitting = true
    try {
      await client.send({ _batch: payload })
      for (const [prop, value] of Object.entries(payload)) currentValues.set(prop, value)
      setStatus(saveStatus, '設定を送信しました。', 'success')
    } catch (error) {
      console.error(error)
      setStatus(saveStatus, `保存できませんでした: ${errorDetail(error)}`, 'error')
    } finally {
      submitting = false
      submitButton.disabled = !client.isConnected()
    }
  })

  client.onDisconnected = () => {
    submitting = false
    currentValues.clear()
    setStatus(saveStatus, '接続が切れました。保存されていない項目を確認してください。', 'warning')
    updateView()
  }

  updateView()
  globalThis.lucide?.createIcons()
  return { client, onCharacteristicValueChanged }
}

if (globalThis.document != null) {
  globalThis.document.addEventListener('DOMContentLoaded', () => initializePreferencePage())
}
