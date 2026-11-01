import Time from 'time'

export default Object.freeze({
  now() {
    return Time.microseconds / 1000
  },
  reset() {
    native('xs_io_reset')()
  },
  mark(kind, at) {
    native('xs_io_mark')(kind, at)
  },
  stats() {
    return native('xs_io_stats')()
  },
  levels() {
    return native('xs_io_audio_levels')()
  },
  setMainPriority(priority) {
    native('xs_io_main_priority')(priority)
  },
})
