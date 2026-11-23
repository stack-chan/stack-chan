/* 端末側 G2P: かな中間表現 → 生徒インデックス列（C99 / 依存なし）
 *
 * 規約は `csrc/g2p.h` の末尾コメントに全部書いてある。**先にそれを読むこと。**
 * テーブルは `csrc/g2p_table.h`（`scripts/gen_g2p_tables.py` が生成）。
 *
 * 構成は **3 パス**。Python (`scripts/kana_g2p.py`) が
 *
 *     str へデコード → intermediate_to_tokens() → intermediate_to_phonemes()
 *
 * の順で走るので、**エラーの出る順序を合わせるにはこの 3 段が要る**。
 * 例: `"あ" + 0xff + "あ"` は Python なら**デコードで**落ちる。1 パスで
 * 「`あ` の 2 文字キーを引こうとして次のバイトを見る」実装にすると、
 * 未知文字エラーになったり、そもそも `あ` として通ってしまったりする。
 *
 *   パス 0: UTF-8 の検証        → SAAN_G2P_ERR_UTF8    （err_byte = 不正列の先頭）
 *   パス 1: トークン化の検証    → SAAN_G2P_ERR_UNKNOWN （err_byte = 引けない文字の先頭）
 *   パス 2: 音素化 + intersperse → ids へ書き出し
 *
 * パス 0/1 を通してから初めて ids に書くので、**失敗時に出力へ 1 要素も書かない**
 * という規約が構造として満たされる。
 *
 * 作業メモリは 0 B（ローカル変数のみ）。malloc も libm も使わない。
 */
#include "g2p.h"

#include "g2p_table.h"

/* ⚠️ ハッシュと件数は**生成ヘッダから**取る。手で書くと
 *    「ベクタと違う表を持っているのに G1 が通る」になる。 */
const uint8_t saan_g2p_table_sha256[32] = SAAN_G2P_TABLE_SHA256_INIT;
const int32_t saan_g2p_table_entries = SAAN_G2P_TABLE_ENTRIES;

/* --- UTF-8 ---------------------------------------------------------------
 *
 * ⚠️ **甘いデコーダにしない。** 「不正入力は全部 ERR_UTF8」でも
 * 「全部 ERR_UNKNOWN」でも片側のテストは満点になる（csrc/g2p.h の規約）。
 * オーバーロング・サロゲート・5 バイト以上のリードをここで弾く。
 */

/* `i` から 1 文字デコードする。戻り値は消費バイト数 1..4、不正なら 0。
 * `nbytes` を超えて読まない（入力に NUL があっても止まらない）。 */
static int utf8_decode(const unsigned char *s, size_t n, size_t i, uint32_t *cp) {
    const unsigned char b0 = s[i];
    if (b0 < 0x80u) {                       /* ASCII（NUL を含む） */
        *cp = b0;
        return 1;
    }
    if (b0 < 0xC2u) {
        return 0;                            /* 継続バイト単独 / 2 バイトのオーバーロング */
    }
    if (b0 < 0xE0u) {
        if (i + 1 >= n) return 0;
        if ((s[i + 1] & 0xC0u) != 0x80u) return 0;
        *cp = ((uint32_t)(b0 & 0x1Fu) << 6) | (uint32_t)(s[i + 1] & 0x3Fu);
        return 2;
    }
    if (b0 < 0xF0u) {
        /* E0 80..9F はオーバーロング、ED A0..BF はサロゲート */
        const unsigned char lo = (b0 == 0xE0u) ? 0xA0u : 0x80u;
        const unsigned char hi = (b0 == 0xEDu) ? 0x9Fu : 0xBFu;
        if (i + 2 >= n) return 0;
        if (s[i + 1] < lo || s[i + 1] > hi) return 0;
        if ((s[i + 2] & 0xC0u) != 0x80u) return 0;
        *cp = ((uint32_t)(b0 & 0x0Fu) << 12) | ((uint32_t)(s[i + 1] & 0x3Fu) << 6)
            | (uint32_t)(s[i + 2] & 0x3Fu);
        return 3;
    }
    if (b0 < 0xF5u) {
        /* F0 80..8F はオーバーロング、F4 90..BF は U+10FFFF 超 */
        const unsigned char lo = (b0 == 0xF0u) ? 0x90u : 0x80u;
        const unsigned char hi = (b0 == 0xF4u) ? 0x8Fu : 0xBFu;
        if (i + 3 >= n) return 0;
        if (s[i + 1] < lo || s[i + 1] > hi) return 0;
        if ((s[i + 2] & 0xC0u) != 0x80u) return 0;
        if ((s[i + 3] & 0xC0u) != 0x80u) return 0;
        *cp = ((uint32_t)(b0 & 0x07u) << 18) | ((uint32_t)(s[i + 1] & 0x3Fu) << 12)
            | ((uint32_t)(s[i + 2] & 0x3Fu) << 6) | (uint32_t)(s[i + 3] & 0x3Fu);
        return 4;
    }
    return 0;                                /* F5..FF */
}

/* --- モーラ表の検索 ------------------------------------------------------- */

/* `(cp1, cp2)` のモーラ行を返す。無ければ -1。`cp2 == 0` は 1 文字キーの照合。
 * ⚠️ 妥当な 2 文字目は必ず U+3041 以上なので、0 を番兵に使ってよい。 */
static int mora_find(uint32_t cp1, uint32_t cp2) {
    uint8_t c1, c2 = 0;
    int lo = 0, hi = SAAN_G2P_TABLE_ENTRIES - 1;

    if (cp1 < SAAN_G2P_KANA_LO || cp1 > SAAN_G2P_KANA_HI) return -1;
    c1 = (uint8_t)(cp1 - SAAN_G2P_KANA_BASE);
    if (cp2 != 0u) {
        if (cp2 < SAAN_G2P_KANA_LO || cp2 > SAAN_G2P_KANA_HI) return -1;
        c2 = (uint8_t)(cp2 - SAAN_G2P_KANA_BASE);
    }
    while (lo <= hi) {
        const int mid = lo + (hi - lo) / 2;
        const saan_g2p_mora *m = &kSaanG2pMora[mid];
        if (m->c1 < c1 || (m->c1 == c1 && m->c2 < c2))      lo = mid + 1;
        else if (m->c1 > c1 || (m->c1 == c1 && m->c2 > c2)) hi = mid - 1;
        else return mid;
    }
    return -1;
}

/* --- トークン化 ----------------------------------------------------------- */

typedef struct {
    int      is_mark;   /* 1 = 記号（`[` `]` `#` `_` `^` `$` `?` `?!` `?.` `?~`） */
    int32_t  id;        /* is_mark のときの生徒インデックス */
    int      entry;     /* モーラのときの kSaanG2pMora 行番号 */
    int      devoiced;  /* 直後に `°` が付いていたか */
    size_t   next;      /* 次のトークンの開始バイト */
} tok_t;

/* `pos` から 1 トークン読む。1 = 成功 / 0 = 中間表現として解釈できない。
 *
 * ⚠️ **UTF-8 は呼ぶ前に全体を検証しておくこと**（パス 0）。Python は str が
 *    デコード済みなので、この関数は「デコードは成功する」前提で書いてある。 */
static int next_token(const unsigned char *t, size_t n, size_t pos, tok_t *out) {
    uint32_t cp1 = 0, cp2 = 0;
    int l1, l2 = 0, e = -1, k;
    size_t p2, next = 0;

    /* 記号。⚠️ **長いものから照合する**（`?!` を `?` より先に見る）。
     * kSaanG2pMarks は生成時に len 降順に並べてある。 */
    for (k = 0; k < SAAN_G2P_N_MARKS; ++k) {
        const saan_g2p_mark *mk = &kSaanG2pMarks[k];
        if (pos + mk->len > n) continue;
        if (t[pos] != mk->b0) continue;
        if (mk->len == 2u && t[pos + 1] != mk->b1) continue;
        out->is_mark = 1;
        out->id = mk->id;
        out->entry = -1;
        out->devoiced = 0;
        out->next = pos + mk->len;
        return 1;
    }

    l1 = utf8_decode(t, n, pos, &cp1);
    if (l1 <= 0) return 0;                   /* パス 0 を通っていれば起きない */
    p2 = pos + (size_t)l1;
    if (p2 < n) l2 = utf8_decode(t, n, p2, &cp2);
    if (l2 <= 0) cp2 = 0;

    /* ⚠️ **最長一致。** 短一致だと `とぅ` 系 11 件が例外なしに別の音素列になる */
    if (cp2 != 0u) {
        e = mora_find(cp1, cp2);
        if (e >= 0) next = p2 + (size_t)l2;
    }
    if (e < 0) {
        e = mora_find(cp1, 0u);
        if (e >= 0) next = p2;
    }
    if (e < 0) return 0;

    out->is_mark = 0;
    out->id = -1;
    out->entry = e;
    out->devoiced = 0;
    /* 直後の `°`。⚠️ **モーラの後ろでしか見ない**（`[°` は未知文字エラー） */
    if (next + 1u < n
        && t[next] == SAAN_G2P_DEVOICE_B0 && t[next + 1] == SAAN_G2P_DEVOICE_B1) {
        out->devoiced = 1;
        next += 2u;
    }
    out->next = next;
    return 1;
}

/* `ん` の後続。最初の非マークトークンの**生の**第 1 音素を返す。無ければ -1。
 *
 * ⚠️ **後続の `ん` / `ー` / `っ` を再帰的に解決しない。** 表の生の値
 * （`N_m` / `a` / `cl`）を引き、それらは異音表で N_uvular に落ちる。
 * マークは何個でも跨ぐ。 */
static int32_t lookahead_first_phoneme(const unsigned char *t, size_t n, size_t pos) {
    tok_t tk;
    while (pos < n) {
        if (!next_token(t, n, pos, &tk)) return -1;   /* パス 1 を通っていれば起きない */
        if (tk.is_mark) { pos = tk.next; continue; }
        return kSaanG2pMora[tk.entry].p0;
    }
    return -1;
}

/* --- 出力 ----------------------------------------------------------------- */

typedef struct {
    int32_t *ids;
    int32_t  cap;
    int32_t  n;            /* 必要な総数。cap を超えても数え続ける */
    int      overflow;
    int32_t  last_vowel;   /* 直近に出した平母音（`ー` 用）。無ければ -1 */
    int32_t  n_phonemes;
    int32_t  n_pad;
} out_t;

/* ⚠️ **cap を超えたら書かずに数えるだけ。** 書いてから返す実装にすると
 *    「呼び出し側のバッファを 1 個ぶん踏む」典型的な壊れ方になる。 */
static void push(out_t *o, int32_t id) {
    if (o->n < o->cap) o->ids[o->n] = id;
    else o->overflow = 1;
    ++o->n;
}

/* 音素 1 個 = ids 2 個（**その音素自身が PAD なら PAD を挟まない**）。
 * ⚠️ ここを外すと発話が約 2.4 倍速になるが例外は出ない（C-007）。 */
static void emit(out_t *o, int32_t id) {
    push(o, id);
    if (id != SAAN_G2P_ID_PAD) push(o, SAAN_G2P_ID_PAD);
    ++o->n_phonemes;
    if (id == SAAN_G2P_ID_PAD) ++o->n_pad;
    if (id >= SAAN_G2P_VOWEL_LO && id <= SAAN_G2P_VOWEL_HI) o->last_vowel = id;
}

/* --- 検証（パス 0 + パス 1）------------------------------------------------
 *
 * ⚠️ **トークナイザを 2 回書かない。** `saan_g2p()` も `saan_g2p_classify()` も
 *    「行末まで読めるか」の判定はここ 1 か所に寄せてある。判定だけを別に
 *    書き下すと、凍結テーブルの更新で片方だけがずれる（C-002 と同型）。 */
static saan_g2p_status validate(const unsigned char *t, size_t n, int32_t *err_byte) {
    size_t i;

    *err_byte = -1;
    /* パス 0: UTF-8 */
    for (i = 0; i < n; ) {
        uint32_t cp = 0;
        const int l = utf8_decode(t, n, i, &cp);
        if (l <= 0) { *err_byte = (int32_t)i; return SAAN_G2P_ERR_UTF8; }
        i += (size_t)l;
    }
    /* パス 1: トークン化できるか */
    for (i = 0; i < n; ) {
        tok_t tk;
        if (!next_token(t, n, i, &tk)) {
            *err_byte = (int32_t)i;              /* 引けない**文字**の先頭バイト */
            return SAAN_G2P_ERR_UNKNOWN;
        }
        i = tk.next;
    }
    return SAAN_G2P_OK;
}

/* 行に**中間表現だけの**マークが 1 つでもあるか（`[ ] # _ ^ $` と `°`）。
 *
 * ⚠️ **`?` 系（`?` `?!` `?.` `?~`）は数えない。** これらは EOS のマークであると同時に
 *    **普通の日本語の文にも出る約物**で、数えると `本当なんでしょうか?` のような文が
 *    「かな経路のつもりで書き損じた行」と誤判定されて拒否される。held-out 2,333 行で
 *    **45 行（1.93%）が拒否**になり、うち 42 行がごく普通の疑問文だった（K-B の実測）。
 *    残りの `[ ] # _ ^ $ °` は中間表現以外の日本語文にはまず現れないので、
 *    「トークン化に失敗 かつ これらがある」= 書き損じ、と読んでよい。
 * ⚠️ **集合を手書きしない。** `kSaanG2pMarks` の先頭バイト（`?` = 0x3f を除く）と
 *    `°` の 2 バイトから導く。マークはすべて ASCII か U+00B0 で、UTF-8 は自己同期するので
 *    「多バイト文字の一部がたまたま `[` に見える」ことは起きない（生バイト走査で厳密）。 */
#define SAAN_G2P_QUESTION_B0 0x3fu   /* '?'。`?!` `?.` `?~` も先頭はこれ */

static int has_mark(const unsigned char *t, size_t n) {
    size_t i;
    for (i = 0; i < n; ++i) {
        int k;
        for (k = 0; k < SAAN_G2P_N_MARKS; ++k)
            if (kSaanG2pMarks[k].b0 != SAAN_G2P_QUESTION_B0
                && t[i] == kSaanG2pMarks[k].b0) return 1;
        if (t[i] == SAAN_G2P_DEVOICE_B0 && i + 1u < n
            && t[i + 1] == SAAN_G2P_DEVOICE_B1) return 1;
    }
    return 0;
}

/* --- 公開 API ------------------------------------------------------------- */

int32_t saan_g2p_capacity(size_t nbytes) {
    /* 上限式。マーク 1 バイト = 音素 1 個 = ids 2 個 が最悪比。`^` + PAD + `$` で +3。
     * ⚠️ 桁溢れで小さい値を返すと呼び出し側が足りないバッファを確保する */
    if (nbytes > (size_t)((INT32_MAX - 3) / 2)) return INT32_MAX;
    return (int32_t)(2u * nbytes) + 3;
}

const char *saan_g2p_strerror(saan_g2p_status s) {
    switch (s) {
    case SAAN_G2P_OK:           return "OK";
    case SAAN_G2P_ERR_UTF8:     return "不正な UTF-8";
    case SAAN_G2P_ERR_UNKNOWN:  return "中間表現に無い文字";
    case SAAN_G2P_ERR_OVERFLOW: return "ids バッファ不足";
    case SAAN_G2P_ERR_ARG:      return "引数が不正";
    }
    return "不明なエラー";
}

saan_g2p_status saan_g2p(const char *text, size_t nbytes,
                         int32_t *ids, int32_t ids_cap, int32_t *n_ids,
                         saan_g2p_info *info) {
    const unsigned char *t = (const unsigned char *)text;
    int32_t drop_long = 0, drop_devoice = 0;
    out_t o;
    size_t i;

    if (n_ids) *n_ids = 0;
    if (info) {
        info->err_byte = -1;
        info->n_phonemes = 0;
        info->n_pad_phonemes = 0;
        info->n_dropped_long = 0;
        info->n_dropped_devoice = 0;
    }
    if (ids_cap < 0) return SAAN_G2P_ERR_ARG;
    if (ids_cap > 0 && ids == NULL) return SAAN_G2P_ERR_ARG;
    if (nbytes > 0u && text == NULL) return SAAN_G2P_ERR_ARG;

    /* --- パス 0 + パス 1: UTF-8 とトークン化（validate に一本化）--------- */
    {
        int32_t eb = -1;
        const saan_g2p_status vs = validate(t, nbytes, &eb);
        if (vs != SAAN_G2P_OK) {
            if (info) info->err_byte = eb;
            return vs;
        }
    }

    /* --- パス 2: 音素化 + intersperse ------------------------------------ */
    o.ids = ids;
    o.cap = ids_cap;
    o.n = 0;
    o.overflow = 0;
    o.last_vowel = -1;
    o.n_phonemes = 0;
    o.n_pad = 0;

    push(&o, SAAN_G2P_ID_BOS);
    push(&o, SAAN_G2P_ID_PAD);
    for (i = 0; i < nbytes; ) {
        tok_t tk;
        (void)next_token(t, nbytes, i, &tk);         /* パス 1 で成功済み */
        i = tk.next;

        if (tk.is_mark) {
            emit(&o, tk.id);
            continue;
        }
        if (tk.entry == SAAN_G2P_IDX_LONG) {
            /* `ー` は**直前の平母音だけ**を複製する。無ければ黙って消える */
            if (tk.devoiced) ++drop_devoice;         /* `ー°` の `°` は届かない */
            if (o.last_vowel >= 0) emit(&o, o.last_vowel);
            else ++drop_long;
            continue;
        }
        if (tk.entry == SAAN_G2P_IDX_N) {
            const int32_t nxt = lookahead_first_phoneme(t, nbytes, i);
            if (tk.devoiced) ++drop_devoice;         /* `ん°` の `°` も届かない */
            emit(&o, nxt >= 0 ? (int32_t)kSaanG2pNAllophone[nxt]
                              : (int32_t)SAAN_G2P_ID_N_UVULAR);
            continue;
        }
        {
            const int32_t p0 = kSaanG2pMora[tk.entry].p0;
            const int32_t p1 = kSaanG2pMora[tk.entry].p1;
            int32_t last = (p1 >= 0) ? p1 : p0;
            if (tk.devoiced) {
                /* ⚠️ **最後の音素が平母音のときだけ**大文字化する（`っ°` は黙殺） */
                if (last >= SAAN_G2P_VOWEL_LO && last <= SAAN_G2P_VOWEL_HI)
                    last += SAAN_G2P_DEVOICE_STEP;
                else
                    ++drop_devoice;
            }
            if (p1 >= 0) emit(&o, p0);
            emit(&o, last);
        }
    }
    push(&o, SAAN_G2P_ID_EOS);

    if (info) {
        info->n_phonemes = o.n_phonemes;
        info->n_pad_phonemes = o.n_pad;
        info->n_dropped_long = drop_long;
        info->n_dropped_devoice = drop_devoice;
    }
    if (n_ids) *n_ids = o.n;      /* 溢れたときは**必要な総数**が入る */
    return o.overflow ? SAAN_G2P_ERR_OVERFLOW : SAAN_G2P_OK;
}

/* --- 経路の判定（K-B / T11）------------------------------------------------
 *
 * 規約は `csrc/g2p.h` の宣言のところに全部書いてある。**先にそれを読むこと。** */
saan_g2p_route saan_g2p_classify(const char *text, size_t nbytes,
                                 saan_g2p_status *why, int32_t *err_byte) {
    const unsigned char *t = (const unsigned char *)text;
    int32_t eb = -1;
    saan_g2p_status vs;

    if (why) *why = SAAN_G2P_OK;
    if (err_byte) *err_byte = -1;
    if (nbytes > 0u && text == NULL) {
        if (why) *why = SAAN_G2P_ERR_ARG;
        return SAAN_G2P_ROUTE_REJECT;
    }

    vs = validate(t, nbytes, &eb);
    if (why) *why = vs;
    if (err_byte) *err_byte = eb;

    if (vs == SAAN_G2P_OK) return SAAN_G2P_ROUTE_KANA;
    /* ⚠️ 不正な UTF-8 は辞書経路にも回さない（MeCab の文字種判定が化けるだけ） */
    if (vs != SAAN_G2P_ERR_UNKNOWN) return SAAN_G2P_ROUTE_REJECT;
    /* ⚠️ マークが混じったまま辞書経路に回すと**それらしい音が出てしまう** */
    return has_mark(t, nbytes) ? SAAN_G2P_ROUTE_REJECT : SAAN_G2P_ROUTE_DICT;
}

const char *saan_g2p_route_name(saan_g2p_route r) {
    switch (r) {
    case SAAN_G2P_ROUTE_KANA:   return "かな";
    case SAAN_G2P_ROUTE_DICT:   return "辞書";
    case SAAN_G2P_ROUTE_REJECT: return "拒否";
    }
    return "不明";
}
