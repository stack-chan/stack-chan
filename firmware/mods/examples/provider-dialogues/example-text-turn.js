import { outputText } from 'stackchan/ai'

/**
 * @param {import('stackchan/ai').Agent} agent
 * @param {{id:string,nextTurn:number,history:import('stackchan/ai').InputItem[][]}} state
 * @param {string} text
 * @param {import('stackchan/voice/contracts').Scope} scope
 */
export async function runTextTurn(agent, state, text, scope) {
  if (typeof text !== 'string' || text.length > 4096) throw RangeError('invalid text input')
  /** @type {import('stackchan/ai').InputItem} */
  const input = { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
  const result = await agent.run(
    { sessionId: state.id, turnId: String(++state.nextTurn), input: [...state.history.flat(), input] },
    scope,
  )
  state.history.push([input, ...result.appended])
  while (state.history.length > 8 || JSON.stringify(state.history).length > 16384) state.history.shift()
  if ('error' in result) throw Object.assign(new Error(result.error.message), { code: result.error.code })
  if (result.status === 'incomplete') throw Error('incomplete response')
  return outputText(result.response)
}
