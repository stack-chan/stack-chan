import type { ConversationPipeline } from 'stackchan/voice'

export async function runTextConversation(pipeline: ConversationPipeline, prompts: readonly string[]) {
  try {
    if (pipeline.capabilities.submitCompletion !== 'playback')
      throw new Error('This example requires per-request playback completion')
    await pipeline.setMicrophoneMuted(true)
    await pipeline.start()
    for (const text of prompts) {
      const turn = await pipeline.submit({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      })
      if (turn.completion !== 'playback') throw new Error('Playback completion is unavailable')
      const result = await turn.done
      if (result.status !== 'completed') throw new Error(`Turn ${result.turnId}: ${result.status}`)
    }
    return await pipeline.close({ mode: 'drain', timeoutMs: 5000 })
  } finally {
    await pipeline.close()
  }
}
