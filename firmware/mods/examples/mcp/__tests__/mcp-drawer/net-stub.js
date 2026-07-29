let address = '192.168.7.146'

export function setIPAddress(value) {
  address = value
}

export default {
  get() {
    return address
  },
}
