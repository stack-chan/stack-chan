/**
 * Simulator stub for MAC address.
 * `net` module isn't available on sim targets, so just return a fixed value.
 */
function getMacAddress(): string {
  return '00:11:22:33:44:55'
}
export default getMacAddress
