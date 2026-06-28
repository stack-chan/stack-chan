import { equal } from 'mocks/assert'
import { hasValidChatType } from 'chat-audioio-config'

trace('=== chat-audioio-config test ===\n')

equal(hasValidChatType({ type: { invalid: true } }), false, 'non-string chat type should disable chat')

equal(hasValidChatType({ type: '' }), false, 'empty chat type should disable chat')

equal(hasValidChatType({ type: 'openAIRealtime' }), true, 'non-empty chat type should enable chat')

trace('ok\n')
