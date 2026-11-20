export default {
  setMode(mode) {
    native('xs_stackchan_set_wifi_power_save').call(this, mode)
  },
  getMode() {
    return native('xs_stackchan_get_wifi_power_save').call(this)
  },
}
