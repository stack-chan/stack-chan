export default class NativeReader {
  constructor() {
    throw Object.assign(new Error('Native speech transport unavailable'), { code: 'unsupported_capability' })
  }
}
