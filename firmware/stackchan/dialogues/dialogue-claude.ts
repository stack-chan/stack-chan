import { fetch } from 'fetch'
import Headers from 'headers'

import type { Maybe } from 'stackchan-util'
import structuredClone from 'structuredClone'

const API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-3-haiku-20240307'
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
    role: 'user',
    // content: '一緒にお話ししましょう',
    content: 'Lets talk together',
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

type ClaudeDialogueProps = {
  context?: ChatContent[]
  model?: string
  apiKey: string
}

export class ClaudeDialogue {
  #model: string
  #context: Array<ChatContent>
  #system: string
  #headers: Headers
  #history: Array<ChatContent>
  #maxHistory: number
  constructor({ apiKey, model = DEFAULT_MODEL, context = DEFAULT_CONTEXT }: ClaudeDialogueProps) {
    this.#model = model
    this.#system = context
      .filter((c) => c.role === 'system')
      .map((c) => c.content)
      .join('\n')
    this.#context = context.filter((c) => c.role !== 'system')
    // The first message of context must always use the user role.
    if (!this.#context.map((c) => c.role).includes('user')) {
      this.#context.unshift({
        role: 'user',
        content: 'Lets talk together',
      })
    }
    this.#history = []
    this.#maxHistory = 6
    this.#headers = new Headers([
      ['Content-Type', 'application/json'],
      ['x-api-key', `${apiKey}`],
      ['anthropic-version', '2023-06-01'],
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
    try {
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
      }
      return { success: false, reason: 'Invalid response format' }
    } catch (error) {
      return { success: false, reason: error.message || 'Unknown error' }
    }
  }
  get history() {
    return structuredClone(this.#history)
  }
  async #sendMessage(message: ChatContent): Promise<unknown> {
    const body = {
      model: this.#model,
      max_tokens: 128,
      system: this.#system,
      messages: [...this.#context, ...this.#history, message],
    }
    return fetch(API_URL, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(body),
    })
      .then((response) => {
        const status = response.status
        if (2 !== Math.idiv(status, 100)) {
          throw Error(`http request failed, status ${status}`)
        }
        return response.arrayBuffer()
      })
      .then((buffer) => {
        const body = String.fromArrayBuffer(buffer)
        return JSON.parse(body)
      })
      .then((obj) => {
        return {
          role: obj.role,
          content: obj.content?.[0].text,
        }
      })
  }
}
