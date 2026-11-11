#include "xsmc.h"
#include <stdint.h>
#include <string.h>

/* AQD1 version 3 stores the first UTF-8 key in each block verbatim. Subsequent
 * entries share a prefix with the preceding key. Read directly from mapped flash. */
typedef struct {
    const uint8_t *data;
    uint32_t size;
    uint32_t blocks;
} Dictionary;

static uint32_t le32(const uint8_t *p)
{
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

static int compare(const uint8_t *a, size_t an, const uint8_t *b, size_t bn)
{
    int order = memcmp(a, b, an < bn ? an : bn);
    return order ? order : (int)an - (int)bn;
}

static const uint8_t *block_at(const Dictionary *dict, uint32_t index, size_t *length)
{
    uint32_t pos = le32(dict->data + 64 + 4 * index);
    if (pos > dict->size - 9) return NULL;
    const uint8_t *block = dict->data + pos;
    *length = block[0] | ((unsigned)block[1] << 8);
    if (*length < 9 || *length > dict->size - pos || block[4] || block[5] > *length - 9) return NULL;
    return block;
}

static const uint8_t *lookup(const Dictionary *dict, const uint8_t *key, size_t key_size)
{
    uint32_t low = 0, high = dict->blocks;
    size_t size;
    while (low < high) {
        uint32_t mid = low + (high - low) / 2;
        const uint8_t *block = block_at(dict, mid, &size);
        if (!block) return NULL;
        if (compare(block + 9, block[5], key, key_size) <= 0) low = mid + 1;
        else high = mid;
    }
    if (!low) return NULL;
    const uint8_t *block = block_at(dict, low - 1, &size);
    if (!block) return NULL;
    uint8_t surface[63];
    size_t surface_size = 0;
    for (size_t pos = 4; pos + 5 <= size;) {
        const uint8_t *entry = block + pos;
        size_t prefix = entry[0], suffix = entry[1], moras = entry[2];
        if (prefix > surface_size || prefix + suffix > sizeof(surface) || suffix + moras > size - pos - 5)
            return NULL;
        memcpy(surface + prefix, entry + 5, suffix);
        surface_size = prefix + suffix;
        int order = compare(surface, surface_size, key, key_size);
        if (order == 0) return entry;
        if (order > 0) break;
        pos += 5 + suffix + moras;
    }
    return NULL;
}

/* AQD mora identifiers from aqk2r_compat.c. Keep mora boundaries: んあ and な
 * are distinguishable in the dictionary and ambiguous after romanization. */
static const char *const kana[] = {
    "", "あ","い","う","え","お","か","き","く","け","こ","が","ぎ","ぐ","げ","ご",
    "さ","し","す","せ","そ","ざ","じ","ず","ぜ","ぞ","た","ち","つ","て","と",
    "だ","で","ど","な","に","ぬ","ね","の","は","ひ","ふ","へ","ほ","ば","び","ぶ","べ","ぼ",
    "ぱ","ぴ","ぷ","ぺ","ぽ","ま","み","む","め","も","や","ゆ","よ","ら","り","る","れ","ろ","わ","お","ん",
    "きゃ","きゅ","きょ","ぎゃ","ぎゅ","ぎょ","しゃ","しゅ","しょ","じゃ","じゅ","じょ","ちゃ","ちゅ","ちょ","にゃ","にゅ","にょ",
    "ひゃ","ひゅ","ひょ","びゃ","びゅ","びょ","ぴゃ","ぴゅ","ぴょ","みゃ","みゅ","みょ","りゃ","りゅ","りょ",
    "ふぁ","ふぃ","ふぇ","ふぉ","てぃ","とぅ","でぃ","どぅ","しぇ","ちぇ","じぇ","うぃ","うぇ","ゔぁ","ゔぃ","ゔ","ゔぇ","ゔぉ","っ","ー",
    "きぇ","ぎぇ","いぇ","ひぇ","びぇ","ぴぇ","みぇ","にぇ","りぇ","てゅ","でゅ","でゃ","でょ","てゃ","てょ","つぃ","すぃ","ずぃ","ふゅ","ゔゅ","つぁ","つぇ","つぉ"
};

static size_t append(char *output, size_t pos, size_t limit, const char *s)
{
    size_t count = strlen(s);
    if (count > limit - pos) return limit + 1;
    memcpy(output + pos, s, count);
    return pos + count;
}

static unsigned jp_codepoint(const uint8_t *s, size_t remaining)
{
    if (remaining < 3 || (s[0] & 0xf0) != 0xe0) return 0;
    return ((s[0] & 15) << 12) | ((s[1] & 63) << 6) | (s[2] & 63);
}

static int word_character(unsigned cp)
{
    return (cp >= 0x3041 && cp <= 0x3096) || (cp >= 0x30a1 && cp <= 0x30fa) ||
           cp == 0x30fc || cp == 0x3005 || (cp >= 0x3400 && cp <= 0x9fff);
}

static int is_kanji(unsigned cp)
{
    return cp == 0x3005 || (cp >= 0x3400 && cp <= 0x9fff);
}

void xs_sanotts_reading(xsMachine *the)
{
    enum { limit = 4096 };
    if (xsmcTypeOf(xsArg(1)) != xsStringType) xsTypeError("Japanese reading requires a string");
    xsmcVars(1);
    xsmcSetArrayBuffer(xsVar(0), NULL, limit + 1);
    uint8_t *data;
    xsUnsignedValue size;
    xsmcGetBufferReadable(xsArg(0), (void **)&data, &size);
    if (size < 64 || memcmp(data, "AQD1", 4) || data[4] != 3 || data[5] || data[6] != 64 || data[7] ||
        le32(data + 8) != size ||
        le32(data + 20) != 64 || le32(data + 16) > (size - 64) / 4)
        xsUnknownError("invalid Stack-chan reading dictionary");
    Dictionary dict = { data, size, le32(data + 16) };
    char *output = xsmcToArrayBuffer(xsVar(0));
    const uint8_t *input = (const uint8_t *)xsmcToString(xsArg(1));
    size_t n = strlen((const char *)input), pos = 0;
    if (n > limit) xsRangeError("Japanese reading exceeds input limit");
    for (size_t i = 0; i < n;) {
        unsigned cp = jp_codepoint(input + i, n - i);
        size_t step = cp ? 3 : 1;
        if (word_character(cp)) {
            size_t length = 3;
            while (length < 63 && word_character(jp_codepoint(input + i + length, n - i - length))) length += 3;
            const uint8_t *match = NULL;
            for (; length; length -= 3) {
                match = lookup(&dict, input + i, length);
                if (match) break;
            }
            if (match) {
                /* Independent character readings cannot predict an unlisted
                 * compound (e.g. 電 + 車 would become でんくるま). */
                if (is_kanji(jp_codepoint(input + i + length - 3, 3)) &&
                    is_kanji(jp_codepoint(input + i + length, n - i - length)))
                    xsRangeError("no compound reading at UTF-8 byte %u", (unsigned)i);
                const uint8_t *moras = match + 5 + match[1];
                for (unsigned m = 0; m < match[2]; m++) {
                    if (moras[m] >= sizeof(kana) / sizeof(*kana)) xsUnknownError("invalid dictionary mora");
                    pos = append(output, pos, limit, kana[moras[m]]);
                    if (pos > limit) xsRangeError("Japanese reading exceeds output limit");
                    if (m + 1 == (match[3] & 31)) {
                        pos = append(output, pos, limit, "]");
                        if (pos > limit) xsRangeError("Japanese reading exceeds output limit");
                    }
                }
                step = length;
            } else if ((cp >= 0x3041 && cp <= 0x3096) || (cp >= 0x30a1 && cp <= 0x30f6) || cp == 0x30fc) {
                if (cp >= 0x30a1 && cp <= 0x30f6) cp -= 0x60;
                char literal[4] = { (char)(0xe0 | (cp >> 12)), (char)(0x80 | ((cp >> 6) & 63)), (char)(0x80 | (cp & 63)), 0 };
                pos = append(output, pos, limit, literal);
            } else xsRangeError("no Japanese reading at UTF-8 byte %u", (unsigned)i);
        } else if (cp == 0xff1f || input[i] == '?') {
            pos = append(output, pos, limit, "?");
        } else if (cp == 0x3001 || cp == 0x3002 || cp == 0xff01 || cp == 0x30fb || cp == 0x3000 ||
                   cp == 0x300c || cp == 0x300d || (!cp && strchr(" \t\r\n,!.:", input[i]))) {
            if (pos && output[pos - 1] != '_' && output[pos - 1] != '?') pos = append(output, pos, limit, "_");
        } else if (input[i] >= '0' && input[i] <= '9') {
            static const char *const digits[] = {"ぜろ","いち","に","さん","よん","ご","ろく","なな","はち","きゅう"};
            pos = append(output, pos, limit, digits[input[i] - '0']);
        } else xsRangeError("no Japanese reading at UTF-8 byte %u", (unsigned)i);
        if (pos > limit) xsRangeError("Japanese reading exceeds output limit");
        i += step;
    }
    if (pos && output[pos - 1] == '_') pos--;
    /* Allocating the JS string can move the scratch ArrayBuffer. */
    xsmcSetStringBuffer(xsResult, NULL, pos);
    memcpy(xsmcToString(xsResult), xsmcToArrayBuffer(xsVar(0)), pos);
}
