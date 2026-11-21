const silence = native('xs_muse_silence_wifi_logs')
export default function silenceWifiLogs() {
  silence.call(null)
}
