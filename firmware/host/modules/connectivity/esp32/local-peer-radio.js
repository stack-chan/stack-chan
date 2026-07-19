import WiFi from 'ecma-wifi'

const nativeConstruct = native('xs_local_peer_radio_constructor')
const nativeClose = native('xs_local_peer_radio_close')
const nativeGetLocalID = native('xs_local_peer_get_id')
const nativeGetID = native('xs_local_peer_radio_get_id')
const nativeAddPeer = native('xs_local_peer_radio_add_peer')
const nativeRemovePeer = native('xs_local_peer_radio_remove_peer')
const nativeSend = native('xs_local_peer_radio_send')

class ESP32LocalPeerRadio extends Native('xs_local_peer_radio_destructor') {
  #wifi
  #receive
  #queue = []
  #current
  #closed = false

  constructor(options) {
    super()
    this.#receive = options.onReceive
    this.#wifi = new WiFi({ onChanged() {} })
    const connected = this.#wifi.connection >= 300
    let nativeReady = false
    try {
      nativeConstruct.call(this, {
        connected,
        offlineChannel: options.offlineChannel,
        sharedKey: options.sharedKey,
      })
      nativeReady = true
      this.id = nativeGetID.call(this)
    } catch (error) {
      try {
        if (nativeReady) nativeClose.call(this)
      } finally {
        this.#wifi.close()
      }
      throw error
    }
  }

  addPeer(peerId, secure) {
    if (this.#closed) throw new Error('local peer radio is closed')
    nativeAddPeer.call(this, peerId, secure)
  }

  removePeer(peerId) {
    if (this.#closed) return
    nativeRemovePeer.call(this, peerId)
  }

  send(peerId, data) {
    if (this.#closed) return Promise.reject(new Error('local peer radio is closed'))
    return new Promise((resolve, reject) => {
      this.#queue.push({ peerId, data, resolve, reject })
      this.#drain()
    })
  }

  #drain() {
    if (this.#closed || this.#current || this.#queue.length === 0) return
    this.#current = this.#queue.shift()
    try {
      nativeSend.call(this, this.#current.peerId ?? null, this.#current.data)
    } catch (error) {
      const current = this.#current
      this.#current = undefined
      current.reject(error)
      this.#drain()
    }
  }

  onLocalPeerSent(success) {
    const current = this.#current
    if (!current) return
    this.#current = undefined
    if (success) current.resolve()
    else current.reject(new Error('local peer frame was not delivered'))
    this.#drain()
  }

  onLocalPeerReceive(peerId, data, secure) {
    if (!this.#closed) this.#receive({ peerId, data, secure })
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    const error = new Error('local peer radio is closed')
    this.#current?.reject(error)
    this.#current = undefined
    for (const item of this.#queue) item.reject(error)
    this.#queue.length = 0
    nativeClose.call(this)
    this.#wifi.close()
  }
}

export function getLocalPeerId() {
  return nativeGetLocalID.call()
}

export default function createLocalPeerRadio(options) {
  return new ESP32LocalPeerRadio(options)
}
