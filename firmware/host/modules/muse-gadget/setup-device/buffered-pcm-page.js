class PcmPage @ "xs_pcm_page_destructor" {
  constructor() @ "xs_pcm_page";
  put(buffer, bufferOffset, pageOffset, length) @ "xs_pcm_page_put";
  get(buffer, bufferOffset, pageOffset, length) @ "xs_pcm_page_get";
  close() @ "xs_pcm_page_close";
}

export default PcmPage
