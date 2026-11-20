import { startWorkerSession } from 'stackchanChatWorkerSession'
import Modules from 'modules'

const models = Object.freeze({
  openAIRealtime: 'openAIRealtimeModel',
  deepgramAgent: 'deepgramAgentModel',
  elevenLabsAgent: 'elevenLabsAgentModel',
  googleGeminiLive: 'googleGeminiLiveModel',
  humeAIEVI: 'humeAIEVIModel',
  xiaozhiV1: 'xiaozhiV1Model',
})

self.onmessage = (configuration) => {
  const module = models[configuration.workerSpecifier]
  if (configuration.id !== 'configure' || !module) throw new Error('Invalid chat worker configuration')
  const Model = Modules.importNow(module)
  startWorkerSession(self, Model, configuration)
}
