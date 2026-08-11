export default function disableWiFiPowerSave() {
  native('xs_stackchan_disable_wifi_power_save').call(this)
}
