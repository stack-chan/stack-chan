import { createCascadedConversation, createPushToTalk } from 'stackchan/voice/cascaded'
import type { ConversationPipeline as Pipeline } from 'stackchan/voice/contracts'
import { createConversationPipeline } from 'stackchan/voice/pipeline'
import { createVoiceScope } from 'stackchan/voice/scope'

export type * from 'stackchan/voice/contracts'
export type ConversationPipeline = Pipeline
export const ConversationPipeline = { create: createConversationPipeline }
export const CascadedConversation = { create: createCascadedConversation }
export const PushToTalk = { create: createPushToTalk }
export const VoiceScope = { create: createVoiceScope }
