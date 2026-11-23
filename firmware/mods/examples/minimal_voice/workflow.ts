import { type AsyncResult, ensure, err, fromPromise, isErr, ok, withResourceScope } from 'stackchan-result'
import type { CloseResult, ConversationPipeline, TurnResult } from 'stackchan/voice'

export type VoiceExampleError =
  | { readonly kind: 'playback-completion-unsupported' }
  | { readonly kind: 'startup-failed'; readonly cause: unknown }
  | { readonly kind: 'submit-failed'; readonly text: string; readonly cause: unknown }
  | { readonly kind: 'turn-incomplete'; readonly turnId: string; readonly status: TurnResult['status'] }
  | { readonly kind: 'close-failed'; readonly cause: unknown }

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function formatVoiceExampleError(error: VoiceExampleError): string {
  switch (error.kind) {
    case 'playback-completion-unsupported':
      return 'This example requires per-request playback completion'
    case 'startup-failed':
      return causeMessage(error.cause)
    case 'submit-failed':
      return causeMessage(error.cause)
    case 'turn-incomplete':
      return `Turn ${error.turnId}: ${error.status}`
    case 'close-failed':
      return causeMessage(error.cause)
    default: {
      const _exhaustive: never = error
      return String(_exhaustive)
    }
  }
}

export async function runTextConversation(
  pipeline: ConversationPipeline,
  prompts: readonly string[],
): AsyncResult<CloseResult, VoiceExampleError> {
  let closeStarted = false
  const scoped = await withResourceScope<CloseResult, VoiceExampleError>(async (scope) => {
    const acquired = await scope.acquire<ConversationPipeline, VoiceExampleError>(
      () => ok(pipeline),
      async (activePipeline) => {
        if (closeStarted) return
        closeStarted = true
        await activePipeline.close()
      },
    )
    if (isErr(acquired)) return acquired
    const active = acquired.value

    const capable = ensure(
      active.capabilities.submitCompletion === 'playback' ? active : undefined,
      (): VoiceExampleError => ({ kind: 'playback-completion-unsupported' }),
    )
    if (isErr(capable)) return capable

    const muted = await fromPromise(
      capable.value.setMicrophoneMuted(true),
      (cause): VoiceExampleError => ({ kind: 'startup-failed', cause }),
    )
    if (isErr(muted)) return muted

    const started = await fromPromise(
      capable.value.start(),
      (cause): VoiceExampleError => ({ kind: 'startup-failed', cause }),
    )
    if (isErr(started)) return started

    for (const text of prompts) {
      const submission = await fromPromise(
        capable.value.submit({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        }),
        (cause): VoiceExampleError => ({ kind: 'submit-failed', text, cause }),
      )
      if (isErr(submission)) return submission

      const playback = ensure(
        submission.value.completion === 'playback' ? submission.value : undefined,
        (): VoiceExampleError => ({ kind: 'playback-completion-unsupported' }),
      )
      if (isErr(playback)) return playback

      const turnResult = await fromPromise(
        playback.value.done,
        (cause): VoiceExampleError => ({ kind: 'submit-failed', text, cause }),
      )
      if (isErr(turnResult)) return turnResult
      if (turnResult.value.status !== 'completed') {
        return err({
          kind: 'turn-incomplete',
          turnId: turnResult.value.turnId,
          status: turnResult.value.status,
        })
      }
    }

    closeStarted = true
    return fromPromise(
      capable.value.close({ mode: 'drain', timeoutMs: 5000 }),
      (cause): VoiceExampleError => ({ kind: 'close-failed', cause }),
    )
  })

  if (isErr(scoped)) return scoped
  return ok(scoped.value.value)
}
