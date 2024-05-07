declare module 'keyboardService' {
  type ConstructorOption = {
    onKeyboardBound?: () => void
    onKeyboardUnbound?: () => void
  }
  type Payload = {
    character: string
  }
  export default class KeyboardService {
    constructor(option: ConstructorOption)
    onKeyTap(payload: Payload)
  }
}
