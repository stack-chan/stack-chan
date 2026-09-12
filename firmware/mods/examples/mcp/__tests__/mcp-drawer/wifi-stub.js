let address = '192.168.7.146'
/** Set the network address reported to the MCP endpoint drawer. */
export function setIPAddress(value) {
  address = value
}
export default class WiFi {
  get address() {
    return address
  }
  close() {}
}
