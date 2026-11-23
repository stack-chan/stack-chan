const allocate = native('xs_pcm_page')
const put = native('xs_pcm_page_put')
const get = native('xs_pcm_page_get')
const close = native('xs_pcm_page_close')

export default class PcmPage extends Native('xs_pcm_page_destructor') {
  constructor() {
    super()
    allocate.call(this)
  }
  put(buffer, bufferOffset, pageOffset, length) {
    put.call(this, buffer, bufferOffset, pageOffset, length)
  }
  get(buffer, bufferOffset, pageOffset, length) {
    get.call(this, buffer, bufferOffset, pageOffset, length)
  }
  close() {
    close.call(this)
  }
}
