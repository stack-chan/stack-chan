export default Object.freeze({
  now() {
    return native('xs_io_now')()
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
