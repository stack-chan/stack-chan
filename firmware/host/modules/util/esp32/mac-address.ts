function getMacAddress(this: unknown): string {
  return native('xs_get_mac_address').call(this)
}
export default getMacAddress
