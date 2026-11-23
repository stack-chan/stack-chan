const send = native('xs_muse_pairing_notify')
export default function notify(connection, handle, value) {
  return send.call(null, connection, handle, value)
}
