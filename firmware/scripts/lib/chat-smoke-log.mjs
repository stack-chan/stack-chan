const FAILURE_PATTERN =
  /XS abort|# Exception|# exception|stack overflow|Guru Meditation|panic'?ed|unhandled exception|Cannot find module/i

/**
 * Decodes trace text from an xsbug protocol capture.
 *
 * @param {string} log Raw xsbug protocol traffic.
 * @returns {string} Concatenated device trace output.
 */
export function decodeXsbugLog(log) {
  return Array.from(log.matchAll(/<log(?:\s[^>]*)?>([\s\S]*?)<\/log>/g), ([, text]) => text)
    .join('')
    .replaceAll('&amp;', '&')
    .replaceAll('&#10;', '\n')
    .replaceAll('&#13;', '\r')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

/**
 * Reduces a decoded device log to the observable state of the autonomous
 * OpenAI Realtime smoke. A PASS is not final until the chat has disconnected,
 * so a lifecycle leak cannot be hidden by a successful response.
 *
 * @param {string} decoded Device trace output.
 * @param {{requireInput?: boolean}} options Additional assertions for a
 *   bounded digital microphone probe.
 * @returns {{
 *   status: 'pending'|'passing'|'passed'|'failed',
 *   reason?: string,
 *   marker?: string,
 *   starts: number,
 * }}
 */
export function evaluateChatSmokeLog(decoded, { requireInput = false } = {}) {
  const lines = decoded.split(/\r?\n/)
  const starts = lines.filter((line) => line.includes('[ChatSmoke] START')).length
  const failureMarker = lines.find((line) => line.includes('[ChatSmoke] FAIL'))
  if (failureMarker) {
    return { status: 'failed', reason: failureMarker.trim(), marker: failureMarker.trim(), starts }
  }

  const fatalMarker = lines.find((line) => FAILURE_PATTERN.test(line))
  if (fatalMarker) {
    return { status: 'failed', reason: fatalMarker.trim(), marker: fatalMarker.trim(), starts }
  }

  const inputDropMarker = lines.find((line) => /\[DuplexChatAudioIO\] input summary drops=[1-9][0-9]*/.test(line))
  if (inputDropMarker) {
    return { status: 'failed', reason: inputDropMarker.trim(), marker: inputDropMarker.trim(), starts }
  }

  const nativeOverrunMarker = lines.find(
    (line) =>
      /\[DuplexChatAudioIO\] audio summary .*\binputOverruns=[1-9][0-9]*/.test(line) ||
      /\[DuplexChatAudioIO\] audio summary .*\b(?:micOverruns|refOverruns)=[1-9][0-9]*/.test(line),
  )
  if (nativeOverrunMarker) {
    return { status: 'failed', reason: nativeOverrunMarker.trim(), marker: nativeOverrunMarker.trim(), starts }
  }

  if (starts > 1) {
    return {
      status: 'failed',
      reason: `chat smoke restarted unexpectedly (${starts} starts)`,
      starts,
    }
  }

  const passIndex = lines.findIndex((line) => line.includes('[ChatSmoke] PASS'))
  if (passIndex < 0) return { status: 'pending', starts }

  const passMarker = lines[passIndex].trim()
  const disconnected = lines.slice(passIndex + 1).some((line) => /onStateChanged:\s*disconnected\b/i.test(line))
  if (disconnected && requireInput) {
    const probeSummary = lines.find((line) => /\[DuplexChatAudioIO\] input probe summary /.test(line))
    const gateSummary = lines.find((line) => /\[DuplexChatAudioIO\] input gate summary /.test(line))
    const pumpSummary = lines.find((line) => /\[OpenAIRealtime\] input pump summary /.test(line))
    if (!probeSummary || !/\bcompleted=true\b/.test(probeSummary)) {
      return { status: 'failed', reason: 'digital input probe did not complete', starts }
    }
    if (!gateSummary || !/\bopens=[1-9][0-9]*\b/.test(gateSummary) || !/\bcloses=[1-9][0-9]*\b/.test(gateSummary)) {
      return { status: 'failed', reason: 'digital input probe did not open and close the input gate', starts }
    }
    if (!pumpSummary || !/\bsends=[1-9][0-9]*\b/.test(pumpSummary) || !/\bbytes=[1-9][0-9]*\b/.test(pumpSummary)) {
      return { status: 'failed', reason: 'digital input probe did not reach the cloud input transport', starts }
    }
    const pumpStart = lines.find((line) => /\[OpenAIRealtime\] input pump started .*\bchunkBytes=\d+/.test(line))
    const configuredChunkBytes = Number(/\bchunkBytes=(\d+)/.exec(pumpStart ?? '')?.[1] ?? 0)
    const maximumSendBytes = Number(/\bmaxSendBytes=(\d+)/.exec(pumpSummary)?.[1] ?? 0)
    if (!configuredChunkBytes || !maximumSendBytes || maximumSendBytes > configuredChunkBytes) {
      return { status: 'failed', reason: 'cloud input transport exceeded its configured send chunk', starts }
    }

    const speechStoppedIndex = lines.findIndex((line) =>
      line.includes('[OpenAIRealtime] event=input_audio_buffer.speech_stopped'),
    )
    const speechStarts = lines.filter((line) =>
      line.includes('[OpenAIRealtime] event=input_audio_buffer.speech_started'),
    ).length
    const speechStops = lines.filter((line) =>
      line.includes('[OpenAIRealtime] event=input_audio_buffer.speech_stopped'),
    ).length
    const committedIndex = lines.findIndex(
      (line, index) =>
        index > speechStoppedIndex && line.includes('[OpenAIRealtime] event=input_audio_buffer.committed'),
    )
    const responseCreatedIndex = lines.findIndex(
      (line, index) => index > committedIndex && line.includes('[OpenAIRealtime] event=response.created'),
    )
    const completedResponseIndex = lines.findIndex(
      (line, index) =>
        index > responseCreatedIndex &&
        line.includes('[OpenAIRealtime] event=response.done') &&
        /\bstatus=completed\b/.test(line),
    )
    const lateResponse = lines
      .slice(passIndex + 1)
      .find((line) => line.includes('[OpenAIRealtime] event=response.created'))
    if (
      speechStarts !== 1 ||
      speechStops !== 1 ||
      speechStoppedIndex < 0 ||
      committedIndex < 0 ||
      responseCreatedIndex < 0 ||
      completedResponseIndex < 0 ||
      lateResponse
    ) {
      return {
        status: 'failed',
        reason: 'digital input probe did not produce exactly one settled server VAD response',
        starts,
      }
    }
  }
  return {
    status: disconnected ? 'passed' : 'passing',
    marker: passMarker,
    starts,
  }
}

/**
 * Selects low-volume, useful progress lines for console output. The complete
 * raw and decoded logs remain available in the run artifact directory.
 *
 * @param {string} decoded Device trace output.
 * @returns {string[]} Diagnostic lines suitable for the terminal.
 */
export function selectChatSmokeProgress(decoded) {
  return decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes('[ChatSmoke]') ||
        line.includes('[OpenAIRealtime]') ||
        line.includes('[DuplexChatAudioIO]') ||
        line.startsWith('onStateChanged:'),
    )
}
