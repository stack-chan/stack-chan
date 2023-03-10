import { fetch, Headers } from 'fetch'
import { Maybe } from 'stackchan-util'
import structuredClone from 'structuredClone'

const API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-3.5-turbo'
const DEFAULT_CONTEXT: ChatContent[] = [
  {
    role: 'system',
    content: 'あなたは手のひらサイズのスーパーカワイイロボット「スタックチャン」です。',
    // content: 'You are Stack-chan, the palm sized super kawaii companion robot.',
  },
  {
    role: 'system',
    content: 'ロボットエンジニアの「ししかわ」があなたを作りました。',
    // content: 'You are made by sskw, the robot engineer.',
  },
  {
    role: 'system',
    content: 'ユーザからの問いかけに対して、くだけた表現で簡潔に回答します。',
    // content: 'You response in frank and simple sentense to the user's message.',
  },
]

function isChatContent(c): c is ChatContent {
  return (
    c != null &&
    'role' in c &&
    (c.role === 'assistant' || c.role === 'user' || c.role === 'system') &&
    typeof c.content === 'string'
  )
}

type ChatContent = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ChatGPTDialogueProps = {
  // model?: string
  context?: ChatContent[]
  apiKey: string
}

export class ChatGPTDialogue {
  #model: string = DEFAULT_MODEL
  #context: Array<ChatContent>
  #headers: Headers
  #history: Array<ChatContent>
  constructor({ apiKey, context = DEFAULT_CONTEXT }: ChatGPTDialogueProps) {
    this.#model = DEFAULT_MODEL
    this.#context = context
    this.#history = []
    this.#headers = new Headers([
      ['Content-Type', 'application/json'],
      ['Authorization', `Bearer ${apiKey}`],
    ])
  }
  clear() {
    this.#history.splice(0)
  }
  async post(message: string): Promise<Maybe<string>> {
    const userMessage: ChatContent = {
      role: 'user',
      content: message,
    }
    const response = await this.#sendMessage(userMessage)
    if (isChatContent(response)) {
      this.#history.push(userMessage)
      this.#history.push(response)
      return {
        success: true,
        value: response.content,
      }
    } else {
      return {
        success: false,
        reason: 'posting message failed',
      }
    }
  }
  get history() {
    return structuredClone(this.#history)
  }
  async #sendMessage(message): Promise<unknown> {
    const body = {
      model: this.#model,
      messages: [...this.#context, ...this.#history, message],
    }
    return fetch(API_URL, { method: 'POST', headers: this.#headers, body: JSON.stringify(body) })
      .then((response) => {
        trace(`\n${response.url} ${response.status} ${response.statusText}\n\n`)
        response.headers.forEach((value, key) => trace(`${key}: ${value}\n`))
        trace('\n')
        return response.json()
      })
      .then((response) => {
        return response.choices?.[0].message
      })
  }
}

/*
let chatting = false
const chat = async function chat(message) {
  if (chatting) {
    return
  }
  chatting = true
  try {
    let res = await postChatMessage(message)
    trace(res + '\n')
    const messages = res
      .replaceAll('！', '。')
      .split('。')
      .filter((msg) => msg.length > 0)
    for (const message of messages) {
      const result = await robot.say(message)
      if (!result.success) {
        trace('failed to say')
      }
    }
  } catch (e) {
    // noop
  } finally {
    chatting = false
  }
}
*/
