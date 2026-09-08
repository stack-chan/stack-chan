/** @type {Readonly<Record<string, string>>} */
const SINGING_MORA_TO_KOE = Object.freeze({
  あ: 'a',
  い: 'i',
  う: 'u',
  え: 'e',
  お: 'o',
  ぁ: 'a',
  ぃ: 'i',
  ぅ: 'u',
  ぇ: 'e',
  ぉ: 'o',
  か: 'ka',
  き: 'ki',
  く: 'ku',
  け: 'ke',
  こ: 'ko',
  が: 'ga',
  ぎ: 'gi',
  ぐ: 'gu',
  げ: 'ge',
  ご: 'go',
  さ: 'sa',
  し: 'shi',
  す: 'su',
  せ: 'se',
  そ: 'so',
  ざ: 'za',
  じ: 'ji',
  ず: 'zu',
  ぜ: 'ze',
  ぞ: 'zo',
  た: 'ta',
  ち: 'chi',
  つ: 'tsu',
  て: 'te',
  と: 'to',
  だ: 'da',
  ぢ: 'ji',
  づ: 'zu',
  で: 'de',
  ど: 'do',
  な: 'na',
  に: 'ni',
  ぬ: 'nu',
  ね: 'ne',
  の: 'no',
  は: 'ha',
  ひ: 'hi',
  ふ: 'fu',
  へ: 'he',
  ほ: 'ho',
  ば: 'ba',
  び: 'bi',
  ぶ: 'bu',
  べ: 'be',
  ぼ: 'bo',
  ぱ: 'pa',
  ぴ: 'pi',
  ぷ: 'pu',
  ぺ: 'pe',
  ぽ: 'po',
  ま: 'ma',
  み: 'mi',
  む: 'mu',
  め: 'me',
  も: 'mo',
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  ら: 'ra',
  り: 'ri',
  る: 'ru',
  れ: 're',
  ろ: 'ro',
  わ: 'wa',
  ゐ: 'i',
  ゑ: 'e',
  を: 'o',
  ん: 'n',
  きゃ: 'kya',
  きゅ: 'kyu',
  きょ: 'kyo',
  ぎゃ: 'gya',
  ぎゅ: 'gyu',
  ぎょ: 'gyo',
  しゃ: 'sha',
  しゅ: 'shu',
  しょ: 'sho',
  じゃ: 'ja',
  じゅ: 'ju',
  じょ: 'jo',
  ちゃ: 'cha',
  ちゅ: 'chu',
  ちょ: 'cho',
  にゃ: 'nya',
  にゅ: 'nyu',
  にょ: 'nyo',
  ひゃ: 'hya',
  ひゅ: 'hyu',
  ひょ: 'hyo',
  びゃ: 'bya',
  びゅ: 'byu',
  びょ: 'byo',
  ぴゃ: 'pya',
  ぴゅ: 'pyu',
  ぴょ: 'pyo',
  みゃ: 'mya',
  みゅ: 'myu',
  みょ: 'myo',
  りゃ: 'rya',
  りゅ: 'ryu',
  りょ: 'ryo',
  ふぁ: 'fa',
  ふぃ: 'fi',
  ふぇ: 'fe',
  ふぉ: 'fo',
  てぃ: 'ti',
  とぅ: 'tu',
  でぃ: 'di',
  どぅ: 'du',
  しぇ: 'she',
  ちぇ: 'che',
  じぇ: 'je',
  うぃ: 'wi',
  うぇ: 'we',
  うぉ: 'o',
  ゔ: 'vu',
  ゔぁ: 'va',
  ゔぃ: 'vi',
  ゔぇ: 've',
  ゔぉ: 'vo',
  きぇ: 'kye',
  ぎぇ: 'gye',
  いぇ: 'ye',
  ひぇ: 'hye',
  びぇ: 'bye',
  ぴぇ: 'pye',
  みぇ: 'mye',
  にぇ: 'nye',
  りぇ: 'rye',
  てゅ: 'tyu',
  でゅ: 'dyu',
  でゃ: 'dya',
  でょ: 'dyo',
  てゃ: 'tya',
  てょ: 'tyo',
  つぁ: 'tsa',
  つぃ: 'tsi',
  つぇ: 'tse',
  つぉ: 'tso',
  すぃ: 'si',
  ずぃ: 'zi',
  ふゅ: 'fyu',
  ゔゅ: 'vyu',
  ゕ: 'ka',
  ゖ: 'ke',
  ゎ: 'wa',
})

const STACKCHAN_VOICE_MAX_KOE_LENGTH = 2047

/** @param {string} value */
function katakanaToHiragana(value) {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0)
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : character
    })
    .join('')
}

/** Convert exactly one kana mora into provider notation. @param {unknown} value @param {string} [previousMora] */
export function singingMoraToKoe(value, previousMora = '') {
  const input = String(value).trim()
  const mora = katakanaToHiragana(input)
  if (mora === 'ー') {
    const previousVowel = /[aiueo]$/.exec(previousMora)?.[0]
    if (previousVowel) return previousVowel
    throw new RangeError('長音「ー」の前には母音を持つ歌詞が必要です')
  }
  const koe = SINGING_MORA_TO_KOE[mora]
  if (koe) return koe
  throw new RangeError(`歌詞「${input || '（空）'}」は、かな1モーラで入力してください`)
}

/** @param {unknown} beatsValue @param {number} bpm */
function songDurationMilliseconds(beatsValue, bpm) {
  const beats = Number(beatsValue)
  if (!Number.isFinite(beats) || beats <= 0) throw new RangeError('音符と休符の拍数は0より大きくしてください')
  const duration = Math.round((60_000 * beats) / bpm)
  if (duration < 20 || duration > 8000) {
    throw new RangeError(`テンポ${bpm}では${beats}拍が${duration}ミリ秒になります（20〜8000ミリ秒にしてください）`)
  }
  return duration
}

/** Compile a bounded score for stackchan-voice. @param {unknown} bpmValue @param {unknown} scoreValue */
export function singingScoreToKoe(bpmValue, scoreValue) {
  const bpm = Number(bpmValue)
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
    throw new RangeError('歌うテンポは20〜300 BPMにしてください')
  }
  if (!Array.isArray(scoreValue)) throw new TypeError('歌唱データは音符と休符を並べたリストにしてください')
  if (scoreValue.length === 0) throw new RangeError('歌唱リストに音符または休符を追加してください')
  if (scoreValue.length > 256) throw new RangeError('1つの歌唱リストには音符と休符を256個まで置けます')

  let koe = ''
  let previousMora = ''
  for (let index = 0; index < scoreValue.length; index += 1) {
    const event = scoreValue[index]
    if (!Array.isArray(event) || event.length !== 3) {
      throw new TypeError(`${index + 1}番目の歌唱データは［音階、拍、歌詞］の3項目にしてください`)
    }
    const note = String(event[0] ?? '')
      .trim()
      .toUpperCase()
    const duration = songDurationMilliseconds(event[1], bpm)
    const lyric = String(event[2] ?? '').trim()
    if (note === 'R') {
      if (lyric) throw new RangeError(`${index + 1}番目の休符には歌詞を指定できません`)
      koe += `#R,${duration}`
    } else {
      if (!/^[A-G](?:[+-])?[0-8]$/.test(note)) {
        throw new RangeError(`${index + 1}番目の歌唱音符「${note || '（空）'}」が不正です`)
      }
      const mora = singingMoraToKoe(lyric, previousMora)
      koe += `#${note},${duration}${mora}`
      previousMora = mora
    }
    if (koe.length > STACKCHAN_VOICE_MAX_KOE_LENGTH) {
      throw new RangeError('歌が長すぎます。歌唱リストを複数の歌うブロックに分けてください')
    }
  }
  return koe
}
