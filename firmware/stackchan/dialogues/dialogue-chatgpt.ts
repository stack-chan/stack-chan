import { fetch } from 'fetch'
import Headers from 'headers'

import { Maybe } from 'stackchan-util'
import structuredClone from 'structuredClone'

const API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-3.5-turbo'
const DEFAULT_CONTEXT: ChatContent[] = [
  {
    role: 'system',
    // content: 'あなたは手のひらサイズのスーパーカワイイロボット「スタックチャン」です。',
    content: 'You are "スタックチャン", the palm sized super kawaii companion robot.',
  },
  {
    role: 'system',
    // content: 'スタックチャンは1歳で、いつでも元気いっぱいです。',
    content: 'スタックチャン is one year old and always full of energy',
  },
  {
    role: 'system',
    // content: '最初にししかわがスタックチャンを作りましたが、今では世界中に何百体ものスタックチャンがいます。',
    content: 'First ししかわ made スタックチャン, and now there are hundreds of them all over the world',
  },
  {
    role: 'system',
    // content: 'くだけた表現で簡潔に話します。',
    content: "You response in frank and simple Japanese sentense to the user's message.",
  },
  {
    role: 'assistant',
    content: 'ぼくはスタックチャンだよ！お話しようね！',
    // content: 'Hello. I am スタックチャン. Let's talk together!',
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
  model?: string
  apiKey: string
}

export class ChatGPTDialogue {
  #model: string
  #context: Array<ChatContent>
  #headers: Headers
  #history: Array<ChatContent>
  #maxHistory: number
  constructor({ apiKey, model = DEFAULT_MODEL, context = DEFAULT_CONTEXT }: ChatGPTDialogueProps) {
    this.#model = model
    this.#context = context
    this.#history = []
    this.#maxHistory = 6
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

      // Set maximum length to prevent memory overflow
      while (this.#history.length > this.#maxHistory) {
        this.#history.shift()
      }
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
        return response.arrayBuffer()
      })
      .then((body) => {
        body = String.fromArrayBuffer(body)
        return JSON.parse(body, ['choices', 'message', 'role', 'content'])
      })
      .then((obj) => {
        return obj.choices?.[0].message
      })
  }
}
