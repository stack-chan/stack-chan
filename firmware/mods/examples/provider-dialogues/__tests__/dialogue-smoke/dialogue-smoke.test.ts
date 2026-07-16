// Consolidated constructor smokes for the provider dialogue classes; they
// share one manifest instead of paying a full mcconfig build per provider.
import { ClaudeDialogue } from 'dialogue-claude'
import { GeminiDialogue } from 'dialogue-gemini'
import config from 'mc/config'

trace('=== provider dialogue smoke test ===\n')

const token = config.token ?? 'test-token'

const claude = new ClaudeDialogue({ apiKey: token })
claude.clear()
trace('smoke: dialogue-claude\n')

const gemini = new GeminiDialogue({ apiKey: token })
gemini.clear()
trace('smoke: dialogue-gemini\n')

trace('ok\n')
