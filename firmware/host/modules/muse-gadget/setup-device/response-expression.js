const sorrow =
  /悲し[いく]|つら[いく]|辛[いく]|寂し[いく]|さみし[いく]|残念|お悔やみ|ご愁傷|申し訳|\b(?:sorry|condolences|heartbreaking)\b/i
const joy =
  /おめでとう|嬉し[いく]|うれし[いく]|楽し[いく]|楽しかった|ありがとう|やった[！!]|\b(?:congratulations|wonderful|thank you)\b/i
const negated =
  /(?:悲しく|つらく|辛く|寂しく|さみしく|嬉しく|うれしく|楽しく)(?:は)?(?:ない|ありません)|(?:悲しい|つらい|辛い|寂しい|さみしい|嬉しい|うれしい|楽しい)(?:とは限ら|わけでは|とは言え)|残念(?:では|じゃ)(?:ない|ありません)|\bnot\s+(?:sorry|wonderful)\b/gi

export function expressionForResponse(text) {
  if (typeof text !== 'string') return 'neutral'
  const sample = text.slice(0, 512).replace(negated, '')
  if (/[「」『』“”"`]/.test(sample)) return 'neutral'
  if (sorrow.test(sample)) return 'sad'
  if (joy.test(sample)) return 'happy'
  return 'neutral'
}

export function createResponseExpressionController(setExpression) {
  let active = false,
    selected = false,
    current = 'neutral'
  const show = (expression) => {
    if (expression === current) return
    current = expression
    setExpression(expression)
  }
  const reset = () => {
    active = false
    selected = false
    show('neutral')
  }
  return {
    reset,
    handle(event) {
      if (event.type === 'turn.started') {
        reset()
        active = true
      } else if (
        event.type === 'output.text' &&
        active &&
        !selected &&
        typeof event.delta === 'string' &&
        event.delta.trim()
      ) {
        selected = true
        show(expressionForResponse(event.delta))
      } else if (event.type === 'turn.ended' || event.type === 'session.ended' || event.type === 'error') reset()
    },
  }
}
