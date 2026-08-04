export let directModelOptions: { inputSampleRate?: number } | undefined

export default class DirectModel {
  constructor(options: { inputSampleRate?: number }) {
    directModelOptions = options
  }
}
