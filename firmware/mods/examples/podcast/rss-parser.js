export function durationSeconds(value) {
  if (typeof value !== 'string' || !/^\d+(?::[0-5]\d){0,2}(?:\.\d+)?$/.test(value.trim())) return
  const seconds = value
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
  return seconds > 0 && Number.isFinite(seconds) ? seconds : undefined
}

const MAX_BYTES = 1024 * 1024
const MAX_FIELD = 8192
const MAX_EPISODES = 20

function entities(value) {
  return value.replace(/&([^;\s]+);/g, (_all, name) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (Object.hasOwn(named, name)) return named[name]
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)) throw new Error('Unsupported XML entity')
    const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('Invalid XML entity')
    return String.fromCodePoint(code)
  })
}

function attributes(source) {
  const result = Object.create(null)
  let rest = source
  while (rest.trim()) {
    const match = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/.exec(rest)
    if (!match) throw new Error('Invalid RSS attribute')
    if (Object.hasOwn(result, match[1])) throw new Error('Duplicate RSS attribute')
    result[match[1]] = entities(match[3])
    rest = rest.slice(match[0].length)
  }
  return result
}

/** Incremental UTF-8 RSS 2.0 reader. Keeps only selected fields and complete MP3 items. */
export default class RSSParser {
  title = ''
  episodes = []
  limited = false
  #feedURL
  #stack = []
  #mode = 'text'
  #token = ''
  #quote = ''
  #capture
  #item
  #bytes = 0
  #utfLeft = 0
  #utfValue = 0
  #utfMin = 0
  #root = false
  #ended = false
  #channel = false

  constructor(feedURL) {
    this.#feedURL = feedURL
  }

  push(bytes) {
    for (const byte of bytes) {
      if (this.limited) return
      if (++this.#bytes > MAX_BYTES) {
        this.limited = true
        return
      }
      if (!this.#utfLeft) {
        if (byte < 0x80) this.#character(String.fromCharCode(byte))
        else if (byte >= 0xc2 && byte <= 0xdf) {
          this.#utfLeft = 1
          this.#utfValue = byte & 31
          this.#utfMin = 0x80
        } else if (byte >= 0xe0 && byte <= 0xef) {
          this.#utfLeft = 2
          this.#utfValue = byte & 15
          this.#utfMin = 0x800
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          this.#utfLeft = 3
          this.#utfValue = byte & 7
          this.#utfMin = 0x10000
        } else throw new Error('RSS must be UTF-8')
      } else {
        if ((byte & 0xc0) !== 0x80) throw new Error('Invalid UTF-8')
        this.#utfValue = this.#utfValue * 64 + (byte & 63)
        if (!--this.#utfLeft) {
          const code = this.#utfValue
          if (code < this.#utfMin || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
            throw new Error('Invalid UTF-8')
          this.#character(String.fromCodePoint(code))
        }
      }
    }
  }

  finish() {
    if (
      !this.limited &&
      (this.#utfLeft || this.#mode !== 'text' || this.#stack.length || !this.#ended || !this.#channel)
    )
      throw new Error('Incomplete RSS document')
    return { title: this.title, episodes: this.episodes, limited: this.limited }
  }

  #text(text, literal = false) {
    if (!this.#stack.length && text.trim() && text !== '\ufeff') throw new Error('Text outside RSS root')
    if (!this.#capture) return
    this.#capture.value += literal ? text.replaceAll('&', '&amp;') : text
    if (this.#capture.value.length > MAX_FIELD) throw new Error('RSS field exceeds limit')
  }

  #character(char) {
    if (this.#mode === 'text') {
      if (char === '<') {
        this.#mode = 'tag'
        this.#token = ''
        return
      }
      this.#text(char)
      return
    }
    if (this.#mode === 'comment' || this.#mode === 'cdata') {
      this.#token += char
      const end = this.#mode === 'comment' ? '-->' : ']]>'
      if (this.#token.endsWith(end)) {
        this.#token = ''
        this.#mode = 'text'
        return
      }
      if (this.#token.length > 2) {
        if (this.#mode === 'cdata') this.#text(this.#token.slice(0, -2), true)
        this.#token = this.#token.slice(-2)
      }
      return
    }
    if (this.#quote) {
      this.#token += char
      if (char === this.#quote) this.#quote = ''
    } else if (char === '"' || char === "'") {
      this.#quote = char
      this.#token += char
    } else if (char === '>') {
      const token = this.#token
      this.#token = ''
      this.#mode = 'text'
      this.#tag(token)
    } else {
      this.#token += char
      if (this.#token === '!--') {
        this.#mode = 'comment'
        this.#token = ''
      } else if (this.#token === '![CDATA[') {
        this.#mode = 'cdata'
        this.#token = ''
      } else if (this.#token.startsWith('!') && !'!--'.startsWith(this.#token) && !'![CDATA['.startsWith(this.#token))
        throw new Error('RSS declarations are not supported')
    }
    if (this.#token.length > MAX_FIELD) throw new Error('RSS token exceeds limit')
  }

  #tag(token) {
    if (token.startsWith('?') && token.endsWith('?')) {
      const encoding = /encoding\s*=\s*['"]([^'"]+)/i.exec(token)
      if (encoding && !/^utf-8$/i.test(encoding[1])) throw new Error('RSS must be UTF-8')
      return
    }
    const closing = /^\/([A-Za-z_][\w:.-]*)\s*$/.exec(token)
    if (closing) {
      this.#endTag(closing[1])
      return
    }
    const match = /^([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)$/.exec(token)
    if (!match) throw new Error('Invalid RSS tag')
    const [, name, rest, selfClosing] = match
    const attrs = attributes(rest)
    const parent = this.#stack.join('/')
    if (!parent) {
      if (this.#root || name !== 'rss' || attrs.version !== '2.0') throw new Error('Expected RSS 2.0')
      this.#root = true
    }
    if (parent === 'rss' && name === 'channel') {
      if (this.#channel) throw new Error('Multiple RSS channels')
      this.#channel = true
    }
    if (this.#stack.length >= 32) throw new Error('RSS nesting exceeds limit')
    this.#stack.push(name)
    if (parent === 'rss/channel' && name === 'item') this.#item = {}
    if (
      (parent === 'rss/channel' && name === 'title') ||
      (parent === 'rss/channel/item' && (name === 'title' || name === 'guid' || name === 'itunes:duration'))
    )
      this.#capture = { name, depth: this.#stack.length, value: '' }
    if (parent === 'rss/channel/item' && name === 'enclosure' && !this.#item.enclosure) {
      const type = attrs.type?.toLowerCase().split(';')[0].trim()
      const url = attrs.url
      if (
        url &&
        (type === 'audio/mpeg' || ((!type || type === 'application/octet-stream') && /\.mp3(?:[?#]|$)/i.test(url)))
      )
        this.#item.enclosure = url
    }
    if (selfClosing) this.#endTag(name)
  }

  #endTag(name) {
    if (this.#stack.at(-1) !== name) throw new Error('Mismatched RSS tag')
    if (this.#capture?.depth === this.#stack.length) {
      const value = entities(this.#capture.value).trim()
      if (this.#item) this.#item[this.#capture.name] = value
      else this.title = value
      this.#capture = undefined
    }
    const path = this.#stack.join('/')
    this.#stack.pop()
    if (path === 'rss/channel/item') {
      const item = this.#item
      this.#item = undefined
      if (item.enclosure) {
        const guid = item.guid || undefined
        const identity = guid ? `guid:${guid}` : `url:${item.enclosure}`
        if (!this.episodes.some((episode) => episode.identity === identity))
          this.episodes.push({
            feedURL: this.#feedURL,
            identity,
            guid,
            duration: durationSeconds(item['itunes:duration']),
            title: item.title || '(untitled)',
            url: item.enclosure,
          })
        if (this.episodes.length === MAX_EPISODES) this.limited = true
      }
    }
    if (name === 'rss' && !this.#stack.length) this.#ended = true
  }
}
