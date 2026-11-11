import { createClaudeLLM, createGeminiLLM, OpenAIResponsesLLM } from 'stackchan/ai'

for (const llm of [
  createClaudeLLM({ model: 'fixture' }),
  createGeminiLLM({ model: 'fixture' }),
  new OpenAIResponsesLLM({ model: 'fixture' }),
]) {
  if (!llm.capabilities.image || !llm.capabilities.tools || typeof llm.createResponse !== 'function')
    throw Error('invalid LLM')
}
trace('@@STACKCHAN_TEST:PASS@@\n')
