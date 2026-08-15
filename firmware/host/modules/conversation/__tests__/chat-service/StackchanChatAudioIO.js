export default class StackchanChatAudioIO {
  constructor(options) {
    this.error = ''
    StackchanChatAudioIO.lastOptions = options
  }

  close() {}
}

StackchanChatAudioIO.lastOptions = null
