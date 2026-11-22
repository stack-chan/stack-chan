import { ChatCompletionsLLM, ClaudeLLM, GeminiLLM, OpenAIResponsesLLM } from 'stackchan/ai'

for (const llm of [
  ClaudeLLM.create({ model: 'fixture' }),
  GeminiLLM.create({ model: 'fixture' }),
  OpenAIResponsesLLM.create({ model: 'fixture' }),
  ChatCompletionsLLM.create({ model: 'fixture', endpoint: 'https://example.invalid/chat/completions' }),
]) {
  if (!llm.capabilities.image || !llm.capabilities.tools || typeof llm.createResponse !== 'function')
    throw Error('invalid LLM')
}
for (const create of [OpenAIResponsesLLM.create, ClaudeLLM.create, GeminiLLM.create]) {
  let rejected = false
  try {
    create({ model: 'fixture', timeoutMs: 0 })
  } catch {
    rejected = true
  }
  if (!rejected) throw Error('invalid transport budget accepted')
}
trace('@@STACKCHAN_TEST:PASS@@\n')
