import { measuredSession } from 'memory-diagnostics/recorder'
import { recorder } from 'memory-diagnostics/runtime'
import { LiveSession as Base } from 'openai-live-session/base'

export const LiveSession = measuredSession(Base, recorder)
