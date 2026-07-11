#include "aqk2r.h"
#include <stddef.h>

static uint8_t *g_workbuf = 0;
static uint32_t g_workbuf_size = 0;
static size_t g_dic_base = 0u;
static uint32_t g_dic_size = 0u;
static uint32_t g_dic_blocks = 0u;
static uint32_t g_dic_index = 0u;

#define AQD_HEADER_SIZE 64u
#define AQD_BLOCK_MAX 1024u
#define AQD_VERSION 3u
#define AQK2R_SPAN_MAX 384u
#define AQK2R_TOKEN_PENALTY 100000
#define AQK2R_POS_COUNT 8u
#define AQK2R_MATCH_MAX 3u

typedef struct {
    const char *utf8;
    const char *roman;
} kana_map_t;

static const kana_map_t KANA_MAP[] = {
    {"\xe3\x81\xb2\xe3\x81\x87", "hye"},
    {"\xe3\x81\xb3\xe3\x81\x87", "bye"},
    {"\xe3\x81\xb4\xe3\x81\x87", "pye"},
    {"\xe3\x81\xbf\xe3\x81\x87", "mye"},
    {"\xe3\x81\xab\xe3\x81\x87", "nye"},
    {"\xe3\x82\x8a\xe3\x81\x87", "rye"},
    {"\xe3\x81\x98\xe3\x82\x85", "ju"},
    {"\xe3\x81\x97\xe3\x82\x85", "shu"},
    {"\xe3\x81\xa1\xe3\x82\x85", "chu"},
    {"\xe3\x81\x82", "a"}, {"\xe3\x81\x84", "i"},
    {"\xe3\x81\x86", "u"}, {"\xe3\x81\x88", "e"},
    {"\xe3\x81\x8a", "o"}, {"\xe3\x81\x8b", "ka"},
    {"\xe3\x81\x8d", "ki"}, {"\xe3\x81\x8f", "ku"},
    {"\xe3\x81\x91", "ke"}, {"\xe3\x81\x93", "ko"},
    {"\xe3\x81\x95", "sa"}, {"\xe3\x81\x97", "shi"},
    {"\xe3\x81\x99", "su"}, {"\xe3\x81\x9b", "se"},
    {"\xe3\x81\x9d", "so"}, {"\xe3\x81\x9f", "ta"},
    {"\xe3\x81\xa1", "chi"}, {"\xe3\x81\xa4", "tsu"},
    {"\xe3\x81\xa6", "te"}, {"\xe3\x81\xa8", "to"},
    {"\xe3\x81\xaa", "na"}, {"\xe3\x81\xab", "ni"},
    {"\xe3\x81\xac", "nu"}, {"\xe3\x81\xad", "ne"},
    {"\xe3\x81\xae", "no"}, {"\xe3\x82\x8c", "re"},
    {"\xe3\x82\x8d", "ro"}, {"\xe3\x82\x8b", "ru"},
    {"\xe3\x82\x88", "yo"}, {"\xe3\x82\x8f", "wa"},
    {"\xe3\x82\x92", "o"}, {"\xe3\x82\x93", "n"},
    {"\xe3\x81\xaf", "ha"}, {"\xe3\x81\xb2", "hi"},
    {"\xe3\x81\xb5", "fu"}, {"\xe3\x81\xb8", "he"},
    {"\xe3\x81\xbb", "ho"}, {"\xe3\x81\xbe", "ma"},
    {"\xe3\x81\xbf", "mi"}, {"\xe3\x82\x80", "mu"},
    {"\xe3\x82\x81", "me"}, {"\xe3\x82\x82", "mo"},
    {"\xe3\x81\x8c", "ga"}, {"\xe3\x81\x8e", "gi"},
    {"\xe3\x81\x90", "gu"}, {"\xe3\x81\x92", "ge"},
    {"\xe3\x81\x94", "go"}, {"\xe3\x81\x96", "za"},
    {"\xe3\x81\x98", "ji"}, {"\xe3\x81\x9a", "zu"},
    {"\xe3\x81\x9c", "ze"}, {"\xe3\x81\x9e", "zo"},
    {"\xe3\x81\xa7", "de"}, {"\xe3\x81\xb0", "ba"},
    {"\xe3\x81\xb3", "bi"}, {"\xe3\x81\xb6", "bu"},
    {"\xe3\x81\xb9", "be"}, {"\xe3\x81\xbc", "bo"},
    {"\xe3\x82\x85", "yu"},
    {"\xe3\x82\x86", "yu"},   /* ゆ (full-size; was missing -- ゆっくり lost its ゆ) */
    {"\xe3\x81\xa2", "ji"},   /* ぢ */
    {"\xe3\x81\xa5", "zu"},   /* づ */
    {"\xe3\x82\x89", "ra"}, {"\xe3\x82\x8a", "ri"},
    {"\xe3\x82\x84", "ya"},
    {"\xe3\x81\xb1", "pa"}, {"\xe3\x81\xb4", "pi"},
    {"\xe3\x81\xb7", "pu"}, {"\xe3\x81\xba", "pe"},
    {"\xe3\x81\xbd", "po"},
    {"\xe3\x81\xa0", "da"}, {"\xe3\x81\xa9", "do"},
    {"\xe3\x81\x81", "a"}, {"\xe3\x81\x83", "i"},
    {"\xe3\x81\x85", "u"}, {"\xe3\x81\x87", "e"},
    {"\xe3\x81\x89", "o"},
};

static int streq_n(const char *a, const char *b, uint32_t n) {
    uint32_t i;
    for (i = 0u; i < n; ++i) {
        if (a[i] != b[i]) {
            return 0;
        }
    }
    return 1;
}

static uint32_t cstr_len(const char *s) {
    uint32_t n = 0u;
    while (s[n] != '\0') {
        n++;
    }
    return n;
}

static int append_char(char *out, uint32_t *pos, uint32_t cap, char c, char *last_vowel) {
    if (*pos + 1u >= cap) {
        return 0;
    }
    out[*pos] = c;
    (*pos)++;
    if (c == 'a' || c == 'i' || c == 'u' || c == 'e' || c == 'o') {
        *last_vowel = c;
    }
    return 1;
}

static int append_str(char *out, uint32_t *pos, uint32_t cap, const char *s, char *last_vowel) {
    uint32_t i;
    for (i = 0u; s[i] != '\0'; ++i) {
        if (!append_char(out, pos, cap, s[i], last_vowel)) {
            return 0;
        }
    }
    return 1;
}

static uint16_t get_u16(const uint8_t *p) {
    return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t get_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int dic_read(uint32_t offset, uint32_t size, void *dst) {
    if (offset > g_dic_size || size > g_dic_size - offset) return 0;
    return aqdic_read(g_dic_base + offset, size, dst) == size;
}

static uint32_t dic_crc32(uint32_t offset, uint32_t size, int *ok) {
    static const uint32_t table[16] = {
        0x00000000u,0x1db71064u,0x3b6e20c8u,0x26d930acu,
        0x76dc4190u,0x6b6b51f4u,0x4db26158u,0x5005713cu,
        0xedb88320u,0xf00f9344u,0xd6d6a3e8u,0xcb61b38cu,
        0x9b64c2b0u,0x86d3d2d4u,0xa00ae278u,0xbdbdf21cu
    };
    uint32_t crc = 0xffffffffu;
    while (size != 0u) {
        uint32_t chunk = size > AQD_BLOCK_MAX ? AQD_BLOCK_MAX : size;
        uint32_t i;
        if (!dic_read(offset, chunk, g_workbuf)) { *ok = 0; return 0u; }
        for (i = 0u; i < chunk; ++i) {
            crc ^= g_workbuf[i];
            crc = (crc >> 4) ^ table[crc & 15u];
            crc = (crc >> 4) ^ table[crc & 15u];
        }
        offset += chunk;
        size -= chunk;
    }
    *ok = 1;
    return crc ^ 0xffffffffu;
}

typedef struct {
    uint8_t moras[64];
    uint8_t mora_count;
    uint8_t accent;
    uint8_t pos;
    int16_t cost;
} dic_match_t;

typedef struct {
    dic_match_t items[AQK2R_MATCH_MAX];
    uint8_t count;
} dic_matches_t;

/* Rows are the previous coarse POS, columns are the next POS. These small
 * costs only break otherwise close lexical paths; UniDic word costs and the
 * token penalty remain the dominant terms. */
static const int16_t POS_CONNECTION[AQK2R_POS_COUNT][AQK2R_POS_COUNT] = {
    {0,   0,   0,   0,   0,   0,   0,   0},
    {800, 500, 1200,1200,0,   500, 0,   400},
    {800, 1000,1200,1000,0,   0,   700, 400},
    {800, 500, 1000,1000,0,   0,   700, 400},
    {800, 0,   0,   0,   900, 500, 500, 300},
    {800, 900, 900, 900, 0,   800, 700, 400},
    {800, 0,   600, 600, 700, 700, 500, 500},
    {0,   0,   0,   0,   0,   0,   0,   0}
};

static int bytes_compare(const uint8_t *a, uint32_t an, const uint8_t *b, uint32_t bn) {
    uint32_t i;
    uint32_t n = an < bn ? an : bn;
    for (i = 0u; i < n; ++i) {
        if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return an == bn ? 0 : (an < bn ? -1 : 1);
}

static int load_block(uint32_t block, uint16_t *block_size, uint16_t *entry_count) {
    uint8_t raw[4];
    uint32_t offset;
    if (block >= g_dic_blocks || !dic_read(g_dic_index + block * 4u, 4u, raw)) return 0;
    offset = get_u32(raw);
    if (!dic_read(offset, 4u, raw)) return 0;
    *block_size = get_u16(raw);
    *entry_count = get_u16(raw + 2u);
    if (*block_size < 4u || *block_size > AQD_BLOCK_MAX) return 0;
    return dic_read(offset, *block_size, g_workbuf);
}

static int block_first(uint32_t block, uint8_t *surface, uint8_t *surface_len) {
    uint16_t size, count;
    uint8_t suffix_len, i;
    if (!load_block(block, &size, &count) || count == 0u || size < 9u) return 0;
    suffix_len = g_workbuf[5u];
    if (suffix_len > 63u || 9u + suffix_len > size) return 0;
    *surface_len = suffix_len;
    for (i = 0u; i < suffix_len; ++i) surface[i] = g_workbuf[9u + i];
    return 1;
}

static int find_in_block(uint32_t block, const uint8_t *key, uint8_t key_len,
                         dic_matches_t *matches) {
    uint16_t size, count, n;
    uint32_t cursor = 4u;
    uint8_t previous[64];
    uint8_t previous_len = 0u;
    matches->count = 0u;
    if (!load_block(block, &size, &count)) return 0;
    for (n = 0u; n < count; ++n) {
        uint8_t prefix, suffix, mora_count, surface_len, i;
        uint8_t surface[64];
        int cmp;
        if (cursor + 5u > size) return 0;
        prefix = g_workbuf[cursor];
        suffix = g_workbuf[cursor + 1u];
        mora_count = g_workbuf[cursor + 2u];
        if (prefix > previous_len || (uint16_t)prefix + suffix > 63u ||
            cursor + 5u + suffix + mora_count > size) return 0;
        for (i = 0u; i < prefix; ++i) surface[i] = previous[i];
        for (i = 0u; i < suffix; ++i) surface[prefix + i] = g_workbuf[cursor + 5u + i];
        surface_len = (uint8_t)(prefix + suffix);
        cmp = bytes_compare(surface, surface_len, key, key_len);
        if (cmp == 0) {
            if (matches->count < AQK2R_MATCH_MAX) {
                dic_match_t *match = &matches->items[matches->count++];
                match->mora_count = mora_count;
                match->accent = g_workbuf[cursor + 3u] & 31u;
                match->pos = g_workbuf[cursor + 3u] >> 5;
                match->cost = (int16_t)((int16_t)(int8_t)g_workbuf[cursor + 4u] * 256);
                for (i = 0u; i < mora_count; ++i)
                    match->moras[i] = g_workbuf[cursor + 5u + suffix + i];
            }
        }
        if (cmp > 0) return matches->count != 0u;
        for (i = 0u; i < surface_len; ++i) previous[i] = surface[i];
        previous_len = surface_len;
        cursor += 5u + suffix + mora_count;
    }
    return matches->count != 0u;
}

static int dictionary_lookup_matches(const uint8_t *key, uint8_t key_len,
                                     dic_matches_t *matches) {
    uint32_t lo = 0u, hi = g_dic_blocks;
    uint8_t first[64], first_len;
    while (lo < hi) {
        uint32_t mid = lo + (hi - lo) / 2u;
        if (!block_first(mid, first, &first_len)) return 0;
        if (bytes_compare(first, first_len, key, key_len) <= 0) lo = mid + 1u;
        else hi = mid;
    }
    if (lo == 0u) {
        matches->count = 0u;
        return 0;
    }
    return find_in_block(lo - 1u, key, key_len, matches);
}

static int dictionary_lookup(const uint8_t *key, uint8_t key_len, dic_match_t *match) {
    dic_matches_t matches;
    if (!dictionary_lookup_matches(key, key_len, &matches)) return 0;
    *match = matches.items[0];
    return 1;
}

static int is_utf8_boundary(unsigned char c) {
    return (c & 0xC0u) != 0x80u;
}

static int is_japanese_punctuation(const char *p) {
    return streq_n(p, "\xe3\x80\x81", 3u) || streq_n(p, "\xe3\x80\x82", 3u) ||
           streq_n(p, "\xef\xbc\x9f", 3u);
}

static int dictionary_can_start(const char *text) {
    uint8_t ends[24];
    uint8_t count = 0u, i = 0u;
    dic_match_t ignored;
    if (text[0] == '\0' || (unsigned char)text[0] < 0x80u || is_japanese_punctuation(text) ||
        streq_n(text, "\xe3\x83\xbc", 3u) || streq_n(text, "\xe3\x81\xa3", 3u) ||
        streq_n(text, "\xe3\x83\x83", 3u) || streq_n(text, "\xe3\x83\xbb", 3u)) return 1;
    while (text[i] != '\0' && i < 63u && count < (uint8_t)(sizeof(ends) / sizeof(ends[0]))) {
        if ((unsigned char)text[i] < 0x80u || is_japanese_punctuation(text + i)) break;
        i++;
        while (text[i] != '\0' && i < 63u && !is_utf8_boundary((unsigned char)text[i])) i++;
        ends[count++] = i;
    }
    while (count != 0u) {
        if (dictionary_lookup((const uint8_t *)text, ends[--count], &ignored)) return 1;
    }
    return 0;
}

static int dictionary_longest(const char *text, uint8_t *bytes, dic_match_t *match) {
    uint8_t ends[24];
    uint8_t count = 0u, i = 0u;
    while (text[i] != '\0' && i < 63u && count < (uint8_t)(sizeof(ends) / sizeof(ends[0]))) {
        if ((unsigned char)text[i] < 0x80u || is_japanese_punctuation(text + i)) break;
        i++;
        while (text[i] != '\0' && i < 63u && !is_utf8_boundary((unsigned char)text[i])) i++;
        ends[count++] = i;
    }
    while (count != 0u) {
        uint8_t len = ends[--count];
        if (dictionary_lookup((const uint8_t *)text, len, match) && dictionary_can_start(text + len)) {
            *bytes = len;
            return 1;
        }
    }
    return 0;
}

static const char *const MORA_ROMAN[] = {
    "", "a","i","u","e","o","ka","ki","ku","ke","ko","ga","gi","gu","ge","go",
    "sa","shi","su","se","so","za","ji","zu","ze","zo","ta","chi","tsu","te","to",
    "da","de","do","na","ni","nu","ne","no","ha","hi","fu","he","ho","ba","bi","bu","be","bo",
    "pa","pi","pu","pe","po","ma","mi","mu","me","mo","ya","yu","yo","ra","ri","ru","re","ro","wa","o","n",
    "kya","kyu","kyo","gya","gyu","gyo","sha","shu","sho","ja","ju","jo","cha","chu","cho","nya","nyu","nyo",
    "hya","hyu","hyo","bya","byu","byo","pya","pyu","pyo","mya","myu","myo","rya","ryu","ryo",
    "fa","fi","fe","fo","ti","tu","di","du","she","che","je","wi","we","va","vi","vu","ve","vo","","",
    "kye","gye","ye","hye","bye","pye","mye","nye","rye","tyu","dyu","dya","dyo","tya","tyo","tsi","si","zi","fyu","vyu","tsa","tse","tso"
};

static int append_dictionary_match(char *out, uint32_t *pos, uint32_t cap,
                                   const dic_match_t *match, char *last_vowel,
                                   uint8_t *leading_geminate) {
    uint8_t i, pending_q = 0u;
    for (i = 0u; i < match->mora_count; ++i) {
        uint8_t id = match->moras[i];
        const char *roman;
        if (id == 121u) {
            pending_q = 1u;
            if (match->accent != 0u && i + 1u == match->accent &&
                !append_char(out, pos, cap, '\'', last_vowel)) return 0;
            continue;
        }
        if (id == 122u) {
            if (!append_char(out, pos, cap, *last_vowel, last_vowel)) return 0;
        } else {
            if (id >= (uint8_t)(sizeof(MORA_ROMAN) / sizeof(MORA_ROMAN[0]))) return 0;
            roman = MORA_ROMAN[id];
            if (*leading_geminate && roman[0] != '\0' &&
                !append_char(out, pos, cap, roman[0], last_vowel)) return 0;
            *leading_geminate = 0u;
            if (pending_q && roman[0] != '\0' && !append_char(out, pos, cap, roman[0], last_vowel)) return 0;
            pending_q = 0u;
            if (!append_str(out, pos, cap, roman, last_vowel)) return 0;
        }
        if (match->accent != 0u && i + 1u == match->accent &&
            !append_char(out, pos, cap, '\'', last_vowel)) return 0;
    }
    /* A selected dictionary token may end at っ even though the following
     * token begins the same phonological word. Carry the gemination state
     * across that lexical boundary instead of losing it. */
    if (pending_q) *leading_geminate = 1u;
    return 1;
}

static int needs_phrase_break(uint8_t previous_pos, uint8_t current_pos) {
    /* Dictionary tokens are not accent phrases. In particular, kana pieces,
     * noun compounds, affixes, particles, and auxiliaries must remain joined.
     * Start a new phrase only when a content word follows a grammatical or
     * already inflected phrase. Punctuation is handled separately. */
    int current_is_content = current_pos >= 1u && current_pos <= 3u;
    if (!current_is_content || previous_pos == 0u || current_pos == 0u) return 0;
    if (previous_pos == 1u || previous_pos == 6u) return 0;
    return previous_pos == 2u || previous_pos == 3u || previous_pos == 4u ||
           previous_pos == 5u || previous_pos == 7u;
}

static uint16_t dictionary_span_length(const char *text) {
    uint16_t n = 0u;
    while (text[n] != '\0' && n < AQK2R_SPAN_MAX) {
        if ((unsigned char)text[n] < 0x80u || is_japanese_punctuation(text + n) ||
            streq_n(text + n, "\xe3\x83\xbb", 3u) || streq_n(text + n, "\xef\xbc\x81", 3u)) break;
        n++;
        while (text[n] != '\0' && n < AQK2R_SPAN_MAX &&
               !is_utf8_boundary((unsigned char)text[n])) n++;
    }
    return n;
}

static uint8_t append_dictionary_span(const char *text, uint16_t span_len,
                                      char *out, uint32_t *out_pos, uint32_t cap,
                                      char *last_vowel) {
    int32_t *cost = (int32_t *)(void *)(g_workbuf + AQD_BLOCK_MAX);
    int32_t p;
    uint16_t pos;
    uint8_t geminate = 0u, previous_pos = 0u;
    const int32_t infinity = 0x3fffffff;
    if (span_len == 0u || span_len > AQK2R_SPAN_MAX) return AQK2R_ERR_UNREADABLE;
    for (pos = 0u; pos <= span_len; ++pos) {
        uint8_t previous;
        for (previous = 0u; previous < AQK2R_POS_COUNT; ++previous)
            cost[(uint32_t)pos * AQK2R_POS_COUNT + previous] = infinity;
    }
    for (previous_pos = 0u; previous_pos < AQK2R_POS_COUNT; ++previous_pos)
        cost[(uint32_t)span_len * AQK2R_POS_COUNT + previous_pos] = 0;
    for (p = (int32_t)span_len - 1; p >= 0; --p) {
        uint16_t end;
        if (!is_utf8_boundary((unsigned char)text[p])) continue;
        end = (uint16_t)p;
        while (end < span_len && (uint16_t)(end - (uint16_t)p) < 63u) {
            dic_matches_t matches;
            uint8_t candidate;
            end++;
            while (end < span_len && !is_utf8_boundary((unsigned char)text[end])) end++;
            if ((uint16_t)(end - (uint16_t)p) > 63u) continue;
            if (!dictionary_lookup_matches((const uint8_t *)text + p,
                                           (uint8_t)(end - (uint16_t)p), &matches)) continue;
            for (candidate = 0u; candidate < matches.count; ++candidate) {
                const dic_match_t *match = &matches.items[candidate];
                uint8_t previous;
                int32_t tail;
                if (match->pos >= AQK2R_POS_COUNT) continue;
                tail = cost[(uint32_t)end * AQK2R_POS_COUNT + match->pos];
                if (tail == infinity) continue;
                for (previous = 0u; previous < AQK2R_POS_COUNT; ++previous) {
                    int32_t total = tail + (int32_t)match->cost + AQK2R_TOKEN_PENALTY +
                                    POS_CONNECTION[previous][match->pos];
                    int32_t *slot = &cost[(uint32_t)p * AQK2R_POS_COUNT + previous];
                    if (total < *slot) *slot = total;
                }
            }
        }
    }
    if (cost[0] == infinity) return AQK2R_ERR_UNREADABLE;
    pos = 0u;
    previous_pos = 0u;
    while (pos < span_len) {
        dic_match_t best_match;
        uint16_t end = pos, best_end = 0u;
        int32_t best = infinity;
        while (end < span_len && (uint16_t)(end - pos) < 63u) {
            dic_matches_t matches;
            uint8_t candidate;
            end++;
            while (end < span_len && !is_utf8_boundary((unsigned char)text[end])) end++;
            if ((uint16_t)(end - pos) > 63u) continue;
            if (!dictionary_lookup_matches((const uint8_t *)text + pos,
                                           (uint8_t)(end - pos), &matches)) continue;
            for (candidate = 0u; candidate < matches.count; ++candidate) {
                const dic_match_t *match = &matches.items[candidate];
                int32_t tail, total;
                if (match->pos >= AQK2R_POS_COUNT) continue;
                tail = cost[(uint32_t)end * AQK2R_POS_COUNT + match->pos];
                if (tail == infinity) continue;
                total = tail + (int32_t)match->cost + AQK2R_TOKEN_PENALTY +
                        POS_CONNECTION[previous_pos][match->pos];
                if (total < best) {
                    best = total;
                    best_end = end;
                    best_match = *match;
                }
            }
        }
        if (best_end == 0u || best != cost[(uint32_t)pos * AQK2R_POS_COUNT + previous_pos])
            return AQK2R_ERR_DIC_FORMAT;
        if (needs_phrase_break(previous_pos, best_match.pos) && *out_pos != 0u &&
            out[*out_pos - 1u] != '/' && out[*out_pos - 1u] != ',' &&
            out[*out_pos - 1u] != '.') {
            if (!append_char(out, out_pos, cap, '/', last_vowel)) return AQK2R_ERR_OUTPUT;
        }
        if (!append_dictionary_match(out, out_pos, cap, &best_match, last_vowel, &geminate))
            return AQK2R_ERR_OUTPUT;
        previous_pos = best_match.pos;
        pos = best_end;
    }
    return AQK2R_OK;
}

static int text_needs_dictionary(const char *text) {
    uint32_t i = 0u;
    /* Explicit AquesTalk-style marks mean the caller already supplied a
     * reading/accent sequence. Re-analyzing it would destroy phrase timing. */
    for (i = 0u; text[i] != '\0'; ++i) {
        if (text[i] == '\'' || text[i] == '/' || text[i] == ';' || text[i] == '<') return 0;
    }
    i = 0u;
    while (text[i] != '\0') {
        unsigned char c = (unsigned char)text[i];
        uint32_t cp;
        if (c < 0x80u) { i++; continue; }
        if ((c & 0xF0u) == 0xE0u && text[i + 1u] != '\0' && text[i + 2u] != '\0') {
            cp = ((uint32_t)(c & 0x0Fu) << 12) |
                 ((uint32_t)((unsigned char)text[i + 1u] & 0x3Fu) << 6) |
                 ((uint32_t)((unsigned char)text[i + 2u] & 0x3Fu));
            if ((cp >= 0x4E00u && cp <= 0x9FFFu) || (cp >= 0x30A0u && cp <= 0x30FBu) ||
                (cp >= 0x30FDu && cp <= 0x30FFu)) return 1;
            i += 3u;
        } else {
            i++;
        }
    }
    return 0;
}

static int append_digit_word(char *out, uint32_t *pos, uint32_t cap, char d, char *last_vowel) {
    switch (d) {
        case '0': return append_str(out, pos, cap, "zero", last_vowel);
        case '1': return append_str(out, pos, cap, "ichi", last_vowel);
        case '2': return append_str(out, pos, cap, "ni", last_vowel);
        case '3': return append_str(out, pos, cap, "san", last_vowel);
        case '4': return append_str(out, pos, cap, "yon", last_vowel);
        case '5': return append_str(out, pos, cap, "go", last_vowel);
        case '6': return append_str(out, pos, cap, "roku", last_vowel);
        case '7': return append_str(out, pos, cap, "nana", last_vowel);
        case '8': return append_str(out, pos, cap, "hachi", last_vowel);
        case '9': return append_str(out, pos, cap, "kyu", last_vowel);
        default: return 1;
    }
}

static uint32_t append_num_tag(const char *in, char *out, uint32_t *pos, uint32_t cap, char *last_vowel) {
    uint32_t i = 0u;
    int digit_by_digit = streq_n(in, "<NUM ", 5u);
    int saw_counter = 0;
    while (in[i] != '\0' && in[i] != '>') {
        if (in[i] >= '0' && in[i] <= '9') {
            if (!append_digit_word(out, pos, cap, in[i], last_vowel)) {
                return i;
            }
            if (digit_by_digit && !append_char(out, pos, cap, '.', last_vowel)) {
                return i;
            }
        }
        if (streq_n(&in[i], "COUNTER=", 8u)) {
            saw_counter = 1;
        }
        i++;
    }
    if (saw_counter) {
        if (!append_str(out, pos, cap, "kiro", last_vowel)) {
            return i;
        }
    }
    return in[i] == '>' ? i + 1u : i;
}

/* small ya/yu/yo -> the palatalized vowel it carries, else 0 */
static uint8_t small_ya_vowel(const char *p) {
    if (streq_n(p, "\xe3\x82\x83", 3u)) return 'a';   /* ゃ */
    if (streq_n(p, "\xe3\x82\x85", 3u)) return 'u';   /* ゅ */
    if (streq_n(p, "\xe3\x82\x87", 3u)) return 'o';   /* ょ */
    return 0u;
}

/* Emit a yoon (拗音): base kana romaji (ki/shi/chi/ni/... ending in 'i') + a
 * small ya/yu/yo. sh/ch/j palatalize directly (sha/cha/ja); others insert 'y'
 * (kya/nyu/ryo). */
static int append_yoon(char *out, uint32_t *pos, uint32_t cap,
                       const char *base, uint8_t yv, char *last_vowel) {
    uint32_t len = cstr_len(base);
    if (len >= 2u && base[len - 1u] == 'i') {
        uint32_t j;
        int palatal;
        char cons[4];
        for (j = 0u; j + 1u < len && j < 3u; ++j) {
            cons[j] = base[j];
        }
        cons[j] = '\0';
        palatal = (cons[0] == 's' && cons[1] == 'h') ||
                  (cons[0] == 'c' && cons[1] == 'h') ||
                  (cons[0] == 'j' && cons[1] == '\0');
        if (!append_str(out, pos, cap, cons, last_vowel)) return 0;
        if (!palatal) {
            if (!append_char(out, pos, cap, 'y', last_vowel)) return 0;
        }
        return append_char(out, pos, cap, (char)yv, last_vowel);
    }
    if (!append_str(out, pos, cap, base, last_vowel)) return 0;
    return append_char(out, pos, cap, (char)yv, last_vowel);
}

uint8_t CAqK2R_Create(uint8_t *workbuf, uint32_t workbuf_size) {
    uint8_t header[AQD_HEADER_SIZE];
    uint32_t expected_crc;
    int crc_ok;
    if (workbuf == 0 || workbuf_size < SIZE_AQK2R_MIN_WORK_BUF) {
        return AQK2R_ERR_WORKBUF;
    }
    g_workbuf = workbuf;
    g_workbuf_size = workbuf_size;
    g_dic_base = aqdic_open();
    if (g_dic_base == 0u) return AQK2R_ERR_DIC_OPEN;
    if (aqdic_read(g_dic_base, AQD_HEADER_SIZE, header) != AQD_HEADER_SIZE) return AQK2R_ERR_DIC_READ;
    if (header[0] != 'A' || header[1] != 'Q' || header[2] != 'D' || header[3] != '1') return AQK2R_ERR_DIC_FORMAT;
    if (get_u16(header + 4u) != AQD_VERSION) return AQK2R_ERR_DIC_VERSION;
    if (get_u16(header + 6u) != AQD_HEADER_SIZE) return AQK2R_ERR_DIC_FORMAT;
    g_dic_size = get_u32(header + 8u);
    g_dic_blocks = get_u32(header + 16u);
    g_dic_index = get_u32(header + 20u);
    if (g_dic_size < AQD_HEADER_SIZE || g_dic_blocks == 0u || g_dic_index != AQD_HEADER_SIZE ||
        g_dic_index + g_dic_blocks * 4u > g_dic_size) return AQK2R_ERR_DIC_FORMAT;
    expected_crc = get_u32(header + 48u);
    if (dic_crc32(AQD_HEADER_SIZE, g_dic_size - AQD_HEADER_SIZE, &crc_ok) != expected_crc || !crc_ok)
        return AQK2R_ERR_DIC_FORMAT;
    return AQK2R_OK;
}

uint8_t CAqK2R_Convert(const char *utf8_text, char *roman_out, uint32_t roman_out_size) {
    uint32_t i = 0u;
    uint32_t o = 0u;
    char last_vowel = 'a';
    uint8_t geminate = 0u;   /* pending sokuon: double the next consonant */
    int use_dictionary;
    (void)g_workbuf_size;
    if (utf8_text == 0 || roman_out == 0 || roman_out_size == 0u) {
        return AQK2R_ERR_ARGUMENT;
    }
    if (g_workbuf == 0 || g_dic_base == 0u) return AQK2R_ERR_NOT_READY;
    use_dictionary = text_needs_dictionary(utf8_text);

    while (utf8_text[i] != '\0') {
        uint32_t k;
        unsigned char c = (unsigned char)utf8_text[i];

        if (c < 0x80u) {
            if (c == ' ') {
                i++;
                continue;
            }
            if (c == '\'') {
                /* preserve the accent-nucleus mark for the F0 model */
                if (!append_char(roman_out, &o, roman_out_size, '\'', &last_vowel)) return AQK2R_ERR_OUTPUT;
                i++;
                continue;
            }
            if (c == '/' || c == ';') {
                /* accent-phrase break -> keep '/' (SHORT pause in the synth) */
                if (!append_char(roman_out, &o, roman_out_size, '/', &last_vowel)) return AQK2R_ERR_OUTPUT;
                i++;
                continue;
            }
            if (c == ',') {
                /* comma -> keep ',' (MEDIUM pause in the synth) */
                if (!append_char(roman_out, &o, roman_out_size, ',', &last_vowel)) return AQK2R_ERR_OUTPUT;
                i++;
                continue;
            }
            if (c == '.') {
                /* sentence end -> keep '.' (LONG pause in the synth) */
                if (!append_char(roman_out, &o, roman_out_size, '.', &last_vowel)) return AQK2R_ERR_OUTPUT;
                i++;
                continue;
            }
            if (c == '?') {
                /* keep '?' so the synth applies question-final rising intonation */
                if (!append_char(roman_out, &o, roman_out_size, '?', &last_vowel)) return AQK2R_ERR_OUTPUT;
                i++;
                continue;
            }
            if (c == '<') {
                i += append_num_tag(&utf8_text[i], roman_out, &o, roman_out_size, &last_vowel);
                continue;
            }
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
                if (!append_char(roman_out, &o, roman_out_size, (char)c, &last_vowel)) return AQK2R_ERR_OUTPUT;
            }
            i++;
            continue;
        }

        if (streq_n(&utf8_text[i], "\xe3\x83\xbc", 3u)) {
            if (!append_char(roman_out, &o, roman_out_size, last_vowel, &last_vowel)) return AQK2R_ERR_OUTPUT;
            i += 3u;
            continue;
        }
        if (streq_n(&utf8_text[i], "\xe3\x81\xa3", 3u)) {   /* っ sokuon */
            geminate = 1u;
            i += 3u;
            continue;
        }
        if (streq_n(&utf8_text[i], "\xef\xbc\x9f", 3u)) {   /* ？ full-width question */
            if (!append_char(roman_out, &o, roman_out_size, '?', &last_vowel)) return AQK2R_ERR_OUTPUT;
            i += 3u;
            continue;
        }
        if (streq_n(&utf8_text[i], "\xe3\x80\x81", 3u)) {   /* 、 -> comma (MEDIUM) */
            if (!append_char(roman_out, &o, roman_out_size, ',', &last_vowel)) return AQK2R_ERR_OUTPUT;
            i += 3u;
            continue;
        }
        if (streq_n(&utf8_text[i], "\xe3\x80\x82", 3u)) {   /* 。 -> period (LONG) */
            if (!append_char(roman_out, &o, roman_out_size, '.', &last_vowel)) return AQK2R_ERR_OUTPUT;
            i += 3u;
            continue;
        }
        if (streq_n(&utf8_text[i], "\xe3\x83\xbb", 3u)) {   /* ・ word separator */
            i += 3u;
            continue;
        }
        if (streq_n(&utf8_text[i], "\xef\xbc\x81", 3u)) {   /* ！ -> sentence end */
            if (!append_char(roman_out, &o, roman_out_size, '.', &last_vowel)) return AQK2R_ERR_OUTPUT;
            i += 3u;
            continue;
        }

        {
            dic_match_t match;
            uint8_t consumed = 0u;
            uint16_t span_len = use_dictionary ? dictionary_span_length(&utf8_text[i]) : 0u;
            if (span_len != 0u) {
                uint8_t span_error = append_dictionary_span(&utf8_text[i], span_len,
                                                            roman_out, &o, roman_out_size,
                                                            &last_vowel);
                if (span_error == AQK2R_OK) {
                    i += span_len;
                    continue;
                }
                if (span_error != AQK2R_ERR_UNREADABLE) return span_error;
            }
            if (use_dictionary && dictionary_longest(&utf8_text[i], &consumed, &match)) {
                /* This is only a lexical fallback, not evidence of an accent
                 * phrase boundary. Keep it connected to adjacent readings. */
                if (!append_dictionary_match(roman_out, &o, roman_out_size, &match, &last_vowel,
                                             &geminate)) return AQK2R_ERR_OUTPUT;
                i += consumed;
                continue;
            }
        }

        for (k = 0u; k < (uint32_t)(sizeof(KANA_MAP) / sizeof(KANA_MAP[0])); ++k) {
            uint32_t n = cstr_len(KANA_MAP[k].utf8);
            if (streq_n(&utf8_text[i], KANA_MAP[k].utf8, n)) {
                const char *rom = KANA_MAP[k].roman;
                uint8_t yv;
                if (geminate) {
                    /* geminate: repeat the leading consonant (っこ -> kko) */
                    char h = rom[0];
                    if (h != '\0') {
                        if (!append_char(roman_out, &o, roman_out_size, h, &last_vowel)) return AQK2R_ERR_OUTPUT;
                    }
                    geminate = 0u;
                }
                yv = small_ya_vowel(&utf8_text[i + n]);
                if (yv != 0u) {   /* base + small ya/yu/yo -> yoon */
                    if (!append_yoon(roman_out, &o, roman_out_size, rom, yv, &last_vowel)) return AQK2R_ERR_OUTPUT;
                    i += n + 3u;
                } else {
                    if (!append_str(roman_out, &o, roman_out_size, rom, &last_vowel)) return AQK2R_ERR_OUTPUT;
                    i += n;
                }
                break;
            }
        }
        if (k == (uint32_t)(sizeof(KANA_MAP) / sizeof(KANA_MAP[0]))) {
            if (use_dictionary) return AQK2R_ERR_UNREADABLE;
            i++;
        }
    }

    roman_out[o] = '\0';
    return 0u;
}

void CAqK2R_Release(void) {
    if (g_dic_base != 0u) aqdic_close();
    g_workbuf = 0;
    g_workbuf_size = 0;
    g_dic_base = 0u;
    g_dic_size = 0u;
    g_dic_blocks = 0u;
    g_dic_index = 0u;
}
