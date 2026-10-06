import RSSParser from 'podcast-rss-parser'
import { assert as check, equal } from 'testing/assert'

const assert = {
  equal,
  throws(action) {
    let failed = false
    try {
      action()
    } catch {
      failed = true
    }
    check(failed, 'expected failure')
  },
}
function test(name, action) {
  action()
  trace(`RSS: ${name}\n`)
}

const feed = (items, title = '番組 &amp; 音声') =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="urn:itunes"><channel><title>${title}</title>${items}</channel></rss>`
const item = (title = '第1話', extra = '') =>
  `<item><title>${title}</title><guid isPermaLink="false">episode-1</guid><enclosure type="audio/mpeg" url="https://example.test/audio?id=1&amp;x=2" length="100"/>${extra}</item>`
function parse(xml, step = 4096) {
  const parser = new RSSParser('https://example.test/feed')
  const bytes = new Uint8Array(ArrayBuffer.fromString(xml))
  for (let offset = 0; offset < bytes.length; offset += step) parser.push(bytes.subarray(offset, offset + step))
  return parser.finish()
}

test('UTF-8, tags, CDATA and entities survive every chunk width', () => {
  const xml = feed(
    item(
      '<![CDATA[声 & 音 🎙]]> &#x1f600;',
      '<itunes:title>ignored</itunes:title><!-- > --><description>ignored</description>',
    ),
  )
  for (let step = 1; step <= 43; step += 1) {
    const result = parse(xml, step)
    assert.equal(result.title, '番組 & 音声')
    assert.equal(result.episodes[0].title, '声 & 音 🎙 😀')
    assert.equal(result.episodes[0].url, 'https://example.test/audio?id=1&x=2')
    assert.equal(result.episodes[0].guid, 'episode-1')
    assert.equal(result.episodes[0].feedURL, 'https://example.test/feed')
  }
})
test('only MP3 enclosures are selected; GUID fallback and deduplication are stable', () => {
  const result = parse(
    feed(
      item() +
        item() +
        '<item><enclosure url="/one.mp3?x=1"/></item><item><enclosure type="audio/mp4" url="/wrong.mp3"/></item><item><enclosure type="audio/mpeg" url="/endpoint"/></item>',
    ),
  )
  assert.equal(result.episodes.length, 3)
  assert.equal(result.episodes[1].identity, 'url:/one.mp3?x=1')
  assert.equal(result.episodes[2].url, '/endpoint')
})
test('episode list is bounded and oversized input is rejected', () => {
  const many = Array.from(
    { length: 100 },
    (_, i) => `<item><guid>${i}</guid><enclosure type="audio/mpeg" url="/${i}"/></item>`,
  ).join('')
  const result = parse(feed(many), 7)
  assert.equal(result.limited, true)
  assert.equal(result.episodes.length, 20)
  assert.throws(() => parse(feed(`${item()}<description>${'x'.repeat(256 * 1024)}</description>`)))
})
test('malformed, unsupported and oversized XML fields fail explicitly', () => {
  for (const xml of [
    feed(item()).slice(0, -5),
    '<html/>',
    '<!DOCTYPE rss><rss version="2.0"/>',
    feed(item('x'.repeat(9000))),
    '<rss version="2.0"><channel></rss>',
  ])
    assert.throws(() => parse(xml))
})

test('RSS duration hints support seconds and colon notation; malformed hints are ignored', () => {
  for (const [hint, expected] of [
    ['90', 90],
    ['1:30', 90],
    ['01:02:03', 3723],
    ['9.5', 9.5],
    ['1:99', undefined],
    ['0', undefined],
    ['-2', undefined],
  ]) {
    assert.equal(
      parse(feed(item('episode', `<itunes:duration>${hint}</itunes:duration>`))).episodes[0].duration,
      expected,
    )
  }
})

test('artwork stays scoped to channel or episode and prefers iTunes images', () => {
  for (const step of [1, 7, 4096]) {
    const result = parse(
      feed(
        '<image><title>image title</title><url>standard.jpg</url></image>' +
          '<itunes:image href="show.jpg"/>' +
          item('episode', '<media:thumbnail url="thumb.jpg"/><itunes:image href="episode.jpg"/>'),
      ),
      step,
    )
    assert.equal(result.title, '番組 & 音声')
    assert.equal(result.artwork, 'show.jpg')
    assert.equal(result.episodes[0].artwork, 'episode.jpg')
    assert.equal(result.episodes[0].title, 'episode')
    assert.equal(
      parse(feed('<image><url><![CDATA[standard.jpg]]></url></image>'.concat(item())), step).artwork,
      'standard.jpg',
    )
  }
})
