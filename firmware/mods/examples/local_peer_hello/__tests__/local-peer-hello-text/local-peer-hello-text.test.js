import { extractReceivedText, MAX_BALLOON_CODE_POINTS, sanitizeReceivedText } from 'local-peer-hello-text'
import { equal } from 'testing/assert'

function countCodePoints(value) {
  let count = 0
  for (const _character of value) count += 1
  return count
}

trace('=== local-peer-hello-text test ===\n')

equal(sanitizeReceivedText('hello world 42'), 'hello world 42', 'ordinary text should remain unchanged')
equal(
  sanitizeReceivedText('hello\nworld\u202e!'),
  'hello world !',
  'control and bidirectional formatting characters should become spaces',
)
equal(sanitizeReceivedText('\n\u202e\t'), undefined, 'control-only text should be rejected')
equal(sanitizeReceivedText({ text: 'not a string' }), undefined, 'non-string input should be rejected')

const longText = '😀'.repeat(MAX_BALLOON_CODE_POINTS + 10)
const truncated = sanitizeReceivedText(longText)
equal(countCodePoints(truncated), MAX_BALLOON_CODE_POINTS, 'truncated text should fit the display limit')
equal(truncated.endsWith('…'), true, 'truncated text should end with an ellipsis')

equal(extractReceivedText({ text: '受信テキスト' }), '受信テキスト', 'payload text should be extracted')
equal(extractReceivedText({ text: 123 }), undefined, 'non-string payload text should be rejected')
equal(extractReceivedText(['text']), undefined, 'array payload should be rejected')

trace('ok\n')
