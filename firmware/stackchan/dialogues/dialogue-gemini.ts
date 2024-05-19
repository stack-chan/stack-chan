import { fetch } from 'fetch'
import Headers from 'headers'

import { Maybe } from 'stackchan-util'
import structuredClone from 'structuredClone'

const API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'
const DEFAULT_MODEL = 'gemini-1.5-flash-latest'
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

function isContent(c): c is Content {
  if (
    c != null &&
    c.parts != null &&
    c.parts.length > 0 &&
    'text' in c.parts[0] &&
    typeof c.parts[0].text === 'string' &&
    'role' in c &&
    (c.role === 'model' || c.role === 'user')
  ) {
    return true
  }
  return false
}

type ChatContent = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type GeminiDialogueProps = {
  context?: ChatContent[]
  model?: string
  apiKey: string
}

type Content = {
  role?: 'user' | 'model'
  parts: {
    text: string
  }[]
}

export class GeminiDialogue {
  #apiKey: string
  #model: string
  #context: Array<Content>
  #system: Content
  #headers: Headers
  #history: Array<Content>
  #maxHistory: number
  constructor({ apiKey, model = DEFAULT_MODEL, context = DEFAULT_CONTEXT }: GeminiDialogueProps) {
    this.#model = model
    this.#system = { parts: context.filter((c) => c.role === 'system').map((c) => ({ text: c.content })) }
    this.#context = context
      .filter((c) => c.role !== 'system')
      .map((c) => ({ parts: [{ text: c.content }], role: c.role == 'assistant' ? 'model' : 'user' }))
    this.#apiKey = apiKey
    this.#history = []
    this.#maxHistory = 6
    this.#headers = new Headers([['Content-Type', 'application/json']])
  }
  clear() {
    this.#history.splice(0)
  }
  async post(message: string): Promise<Maybe<string>> {
    const userMessage: Content = {
      role: 'user',
      parts: [
        {
          text: message,
        },
      ],
    }
    const response = await this.#sendMessage(userMessage)
    if (isContent(response)) {
      this.#history.push(userMessage)
      this.#history.push(response)

      // Set maximum length to prevent memory overflow
      while (this.#history.length > this.#maxHistory) {
        this.#history.shift()
      }
      return {
        success: true,
        value: response.parts[0]?.text,
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
  async #sendMessage(message: Content): Promise<unknown> {
    const body = {
      systemInstruction: this.#system,
      contents: [...this.#context, ...this.#history, message],
    }
    return fetch(`${API_URL_BASE}${this.#model}:generateContent?key=${this.#apiKey}`, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(body),
    })
      .then((response) => {
        return response.arrayBuffer()
      })
      .then((body) => {
        body = String.fromArrayBuffer(body)
        return JSON.parse(body, ['candidates', 'content', 'parts', 'role', 'text'])
      })
      .then((obj) => {
        return obj.candidates[0]?.content
      })
  }
}
