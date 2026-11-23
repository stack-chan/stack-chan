/* 自動生成 — 手で編集しない。
 *
 *   uv run python scripts/gen_token_table.py
 *
 * 出典: src/saanotts_jp/vocab.py の TOKENS。**手で書き写さない**（C-002）。
 * ⚠️ 語彙が変わったら再生成すること。`make -C csrc label-ids` が SHA-256 で検出する。
 */
#ifndef SAAN_TOKEN_TABLE_H
#define SAAN_TOKEN_TABLE_H

#include <stdint.h>

#define LABEL_IDS_N_TOKENS 57

typedef struct { const char *name; int32_t id; } saan_token_t;

static const saan_token_t kSaanTokens[LABEL_IDS_N_TOKENS] = {
    { "_", 0 },
    { "^", 1 },
    { "$", 2 },
    { "?", 3 },
    { "?!", 4 },
    { "?.", 5 },
    { "?~", 6 },
    { "#", 7 },
    { "[", 8 },
    { "]", 9 },
    { "a", 10 },
    { "i", 11 },
    { "u", 12 },
    { "e", 13 },
    { "o", 14 },
    { "A", 15 },
    { "I", 16 },
    { "U", 17 },
    { "E", 18 },
    { "O", 19 },
    { "N_m", 20 },
    { "N_n", 21 },
    { "N_ng", 22 },
    { "N_uvular", 23 },
    { "cl", 24 },
    { "k", 25 },
    { "ky", 26 },
    { "kw", 27 },
    { "g", 28 },
    { "gy", 29 },
    { "gw", 30 },
    { "t", 31 },
    { "ty", 32 },
    { "d", 33 },
    { "dy", 34 },
    { "p", 35 },
    { "py", 36 },
    { "b", 37 },
    { "by", 38 },
    { "ch", 39 },
    { "ts", 40 },
    { "s", 41 },
    { "sh", 42 },
    { "z", 43 },
    { "j", 44 },
    { "f", 45 },
    { "h", 46 },
    { "hy", 47 },
    { "v", 48 },
    { "n", 49 },
    { "ny", 50 },
    { "m", 51 },
    { "my", 52 },
    { "r", 53 },
    { "ry", 54 },
    { "w", 55 },
    { "y", 56 },
};

/* "\n" で連結した TOKENS の SHA-256。ホスト側とずれたら再生成し忘れ。 */
static const uint8_t kSaanTokensSha256[32] = {
    0xac, 0x6a, 0xc3, 0xef, 0x2c, 0x85, 0x93, 0x22, 0xc9, 0x87, 0x23, 0x27, 0xfe, 0x1c, 0x3c, 0x90, 0x1f, 0xe9, 0xd1, 0xd0, 0x21, 0xc9, 0x73, 0xe3, 0x2d, 0xd8, 0xc0, 0x2d, 0xc0, 0xed, 0x29, 0xbc
};

#endif /* SAAN_TOKEN_TABLE_H */
