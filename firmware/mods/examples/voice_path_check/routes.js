export function createRoute(settings, load) {
  const voice = load('stackchan/voice')
  const instructions = 'Reply in one short sentence. This is an audio path test.'
  const agent = () => {
    const ai = load('stackchan/ai')
    const llm = settings.llm ?? {}
    if (!llm.apiKey || !llm.model) throw new Error('Configure llm.apiKey and llm.model')
    const provider = llm.kind === 'chat' ? ai.ChatCompletionsLLM : ai.OpenAIResponsesLLM
    if (llm.kind === 'chat' && !llm.endpoint) throw new Error('Configure llm.endpoint')
    return ai.Agent.create({ llm: provider.create(llm), tools: ai.ToolSet.create([]), instructions, maxToolRounds: 1 })
  }
  if (settings.route === 'cascade') {
    const speech = load('stackchan/voice/speech')
    const apiKey = settings.speech?.apiKey
    if (!apiKey) throw new Error('Configure speech.apiKey')
    const ptt = voice.PushToTalk.create()
    return {
      ptt,
      conversation: voice.CascadedConversation.create({
        stt: speech.WhisperSTT.create({ apiKey }),
        agent: agent(),
        tts: speech.OpenAISpeechTTS.create({ apiKey }),
        turnDetector: ptt.detector,
        voice: settings.speech.voice ?? 'alloy',
      }),
    }
  }
  if (settings.route === 'webrtc') {
    const { LiveConversation } = load('realtimeConversation')
    const live = settings.live ?? {}
    if (!live.apiKey || !live.model) throw new Error('Configure live.apiKey and live.model')
    let delegation = { kind: 'none' }
    if (settings.delegation === 'hosted') {
      if (!settings.llm?.model) throw new Error('Configure llm.model for hosted delegation')
      delegation = { kind: 'hosted', model: settings.llm.model }
    } else if (settings.delegation === 'client') {
      delegation = { kind: 'client', delegate: load('stackchan/ai').asDelegateAgent(agent()) }
    } else if (settings.delegation && settings.delegation !== 'none') throw new Error('Unknown delegation')
    return { conversation: LiveConversation.create({ ...live, instructions, delegation }) }
  }
  if (settings.route === 'websocket') {
    const { ChatConversation } = load('chat')
    if (!settings.chat?.type || !settings.chat?.apiKey) throw new Error('Configure chat.type and chat.apiKey')
    return { conversation: ChatConversation.create({ config: { ...settings.chat, instructions } }) }
  }
  if (settings.route === 'xiaozhi') {
    const { ChatConversation, XiaoZhiV1Connection } = load('chat')
    return { conversation: ChatConversation.create({ connection: XiaoZhiV1Connection.create(settings.xiaozhi ?? {}) }) }
  }
  throw new Error('Choose cascade, webrtc, websocket or xiaozhi')
}
