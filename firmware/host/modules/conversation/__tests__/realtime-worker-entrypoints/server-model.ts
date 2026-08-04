export let serverModelOptions: { inputSampleRate?: number } | undefined

export default class ServerModel {
  constructor(options: { inputSampleRate?: number }) {
    serverModelOptions = options
  }
}
