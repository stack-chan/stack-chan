/* sanoTTS-jp int8 カーネル。詳細は saanotts_int8.h */
#include "saanotts_int8.h"

#include "saanotts_internal.h"
#include "saan_prof.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define I8_NAME_LEN 64

/* ⚠️ かつてここに「重みを [k][cin] へ並べ替えるスタック領域 wt（512 B）」があった。
 *    blob v2（S4）で重みが最初から [cout][k][cinp] なので要らなくなった。 */

/* --- PIE（ESP32-S3 の 128-bit 整数 SIMD） --------------------------------
 *
 * `ee.vmulas.s8.accx` が **16 レーンの int8 積和を 40-bit アキュムレータに**溜める。
 * これが W8A8 の内積そのものなので、そのまま置き換えられる。
 *
 * ⚠️ **GCC は `-O2` でも PIE へ自動ベクトル化しない**（M-53 で逆アセンブル確認済み。
 * W8A8 の int32 積和ループでも `ee.*` は 0 件）。手で書くしかない。
 *
 * ⚠️ **`ee.vld.128.ip` は 16 バイト境界を要求する。** そのため
 *   - 重みは blob v2 で最初から **[cout][k][cinp]** に並べてある（S4。exporter が 0 埋め）。
 *     実行時の転置コピーは無い
 *   - activation の行ストライドを **`cinp = align16(cin)`** に広げ、
 *     隙間 `[cin, cinp)` を **0 で埋める**（0 は積和に寄与しない = 端数処理も不要）
 * これで **MAC の 99.40%** を覆う（M-58）。
 * ⚠️ **depthwise の 0.60% だけは原理的に載らない** — `qx[u*ch + o]` は
 * チャネル方向のギャザーで、内積命令では表現できない（C-035）。
 *
 * 正しさは **QEMU で検証できる**（M-56 / `esp32/pie_probe`）。
 * ⚠️ **速度は測れない** — QEMU はサイクル精度ではない。実機が要る。
 */
/* --- 検査用の「毒」フック（既定 0）------------------------------------------
 * パディング部を 0 ではなく 127 で埋めるビルドを作るためのもの。**本番では 0。**
 *
 * ⚠️ **なぜ要るか**: 隙間の寄与は `Σ w_pad · a_pad` なので、
 * **片方が 0 なら他方がゴミでも出力は変わらない**。したがって
 * 「片方のゼロ埋めを外して出力が変わるか」では検出できない（実際に踏んだ）。
 * **相手側を非ゼロにしたうえで**「出力が変わらないこと」を見るしかない。
 *   - `SAAN_PAD_POISON_W=1` で重み側を汚す → **活性化側**のゼロ埋めを証明する
 *   - `SAAN_PAD_POISON_A=1` で活性化側を汚す → **重み側**のゼロ埋めを証明する
 *   - 両方 1 にすると**出力が変わらなければならない理由が無くなる** = 陽性対照
 * 詳細は `csrc/int8_pad_test.c`。 */
#if defined(__XTENSA__) && defined(SAAN_PIE) && SAAN_PIE
#define SAAN_HAVE_PIE 1
#define SAAN_AL16 __attribute__((aligned(16)))
#else
#define SAAN_HAVE_PIE 0
#define SAAN_AL16
#endif

/* `a` と `b` の内積。**`n` は 16 の倍数、両ポインタは 16 バイト境界**であること。
 * 呼び出し側が保証する（`saan_pie_ok()` で判定）。
 *
 * S5a（2026-09-02）: 16 MAC あたり **5 命令 → 2 命令**。
 *   - `ee.vmulas.s8.accx.ld.ip qu, as, 16, qx, qy` は「qx·qy を accx に足す」と
 *     「qu ← [as], as += 16」を 1 命令でやる。qu == qx にしても積和は**ロード前の** qx を使う
 *   - `loopnez` は Xtensa のゼロオーバーヘッドループ（`__XCHAL_HAVE_LOOPS`）。addi + bnez が消える
 *   - 最後の 1 組だけ併合しない `ee.vmulas.s8.accx` で締める。**併合形で回し切ると
 *     配列の 16 B 先を 1 回読む**（arena や blob の端では未マップ領域に触りうる）
 *   - k == 1（cinp = 16。cup 12→16）は `loopnez` の回数が 0 で本体を飛ばし、締めの 1 命令だけ走る
 * 整数演算なので旧ループと **bit 同一**（esp32/pie_probe の B 節 11 形状 + QEMU の checksum で確認）。
 * ⚠️ QEMU が併合形の意味論を実機と同じに実装しているかは、実機の checksum が一致するかで分かる。 */
#if SAAN_HAVE_PIE
/* ⚠️ **`static` ではない。** `esp32/pie_probe` の D 節が S5b の前後を実機で比べる
 * ために「旧い形」を組み直す。宣言は saanotts_int8.h（同じ #if の下）。 */
int32_t saan_dot_i8_pie(const int8_t *a, const int8_t *b, int n) {
    int32_t out = 0;
    const int8_t *pa = a, *pb = b;
    const int k = n >> 4;
    if (k <= 0) return 0;      /* ⚠️ 無いと締めの 1 組が未初期化の q0/q1 を掛ける */
    const int km1 = k - 1;
    __asm__ volatile(
        "ee.zero.accx                                   \n"
        "ee.vld.128.ip q0, %[pa], 16                    \n"
        "ee.vld.128.ip q1, %[pb], 16                    \n"
        "loopnez %[km1], 1f                             \n"
        "  ee.vmulas.s8.accx.ld.ip q0, %[pa], 16, q0, q1\n"
        "  ee.vld.128.ip q1, %[pb], 16                  \n"
        "1:                                             \n"
        "ee.vmulas.s8.accx q0, q1                       \n"
        "ee.srs.accx %[out], %[sh], 0                   \n"
        : [out] "=&a"(out), [pa] "+&a"(pa), [pb] "+&a"(pb)
        : [km1] "a"(km1), [sh] "a"(0)
        : "memory");
    return out;
}
#endif

/* --- S5b: weight-stationary（重み行を q レジスタに常駐させる）-----------------
 *
 * M-85（実機 CoreS3）: dot の固定費は **78.0 cyc/dot**（全部キャッシュヒットでも
 * 1.63 cyc/MAC）で MAC の 61.5%。内訳は `zero.accx` / `srs.accx` / `float.s` /
 * `madd.s` の直列チェーンと、**dot ごとに 24 命令前後のスカラ**（重み行ポインタの
 * 再計算・`u` の範囲判定・関数の入口出口）。
 *
 * 上の `saan_dot_i8_pie` は **dot ごとに重み行を丸ごとロードし直す**（16 レーンに
 * つき `ee.vld.128.ip` 1 命令）。同じ (o, k) の重み行は `t` を通してずっと同じなので、
 * ループ順を **o → t → k から o → k → t** に変えれば **1 回ロードするだけで済む**。
 * 8 本の q レジスタのうち m = cinp/16 本を重みに、2 本を活性化に使う
 * （**m ≤ 6、つまり cinp ≤ 96 まで**）。
 *
 * held-out 24 文を W8A8 で流して実測した内訳（cin / cinp / m と dot 数を
 * `saan_conv1d_i8a_r` の入口で数えた。dots = cout × ksz × (t1−t0) の総和）:
 *
 *   | m  | 層                          | cinp | dot          | MAC          | 経路 |
 *   |---:|-----------------------------|-----:|-------------:|-------------:|------|
 *   |  1 | dec cup (12→16)             |   16 |  1,982,840  4.9% |    23,794,080  0.9% | 常駐 |
 *   |  2 | duration c1/c2/proj (32)    |   32 |  2,330,425  5.8% |    74,573,600  2.9% | 常駐 |
 *   |  3 | ac c1/c2・out, dec inp/cdown/hout (40→48, 48) | 48 | 25,757,206 64.0% | 1,224,323,616 48.1% | 常駐 |
 *   |  5 | dec pw1・hdown (76→80)      |   80 |  8,181,824 20.3% |   621,818,624 24.4% | 常駐 |
 *   | 19 | dec pw2 (304)               |  304 |  1,982,840  4.9% |   602,783,360 23.7% | **旧 dot** |
 *
 * **dot の 95.1%（MAC の 76.3%）が常駐経路に載る。** pw2 だけは 19 本ぶんの重みが
 * レジスタに入らないので `saan_dot_i8_pie` のまま。⚠️ dot の割合と MAC の割合は
 * 大きく違う（pw2 は 1 dot が 304 MAC）。**固定費は dot 数に比例する**ので、
 * この改造の効きは dot 側の 95.1% で読むこと。
 * ⚠️ m = 4 / 6 はこのモデルには出てこない（`esp32/pie_probe` の B 節に形だけ足してある）。
 *
 * 16 レーンあたりの命令は **2 → 1**（重みのロードが消える）。加えて
 *   - 重み行ポインタの再計算が dot ごと → (o, k) ごとに
 *   - `u < 0 || u >= T` の判定が dot ごと → (o, k) ごとに t の範囲へ畳まれる
 * ⚠️ **`ee.accx` は 1 本しかないので t 方向を並列にはできない。** 直列チェーン
 * （zero → 積和 → srs）は 1 dot につき 1 回のまま残る。**利得の上限は小さい**
 * （M-85 の見積りで −2〜−8 ms/step）。flash の待ち（38.5%）には効かない。
 *
 * ⚠️ **`.ld.ip` の書き込み先は掛ける 2 本のどちらとも別のレジスタにする。**
 * S5a は `qu == qx` に頼っている（「積和はロード前の値」）。ここでは活性化の
 * レジスタを 2 本で ping-pong させて **別名を一切作らない**。実機と QEMU で
 * 意味論が食い違う余地をこれ以上増やさないため。
 *
 * ⚠️ 最後の 1 組だけ `.ld.ip` を使わない理由は S5a と同じ（配列の 16 B 先を読まない）。
 * 1 dot での `%[pa]` の前進は 16 × (m − 1) + 16 = cinp ちょうどで、次のフレームの
 * 行頭に着く（活性化は [T][cinp] の連続配置）。 */
#if SAAN_HAVE_PIE

/* 重み 1 レーン（16 B）を q#i に読む */
#define WS_LDW(i)       "ee.vld.128.ip q" #i ", %[pw], 16\n"
/* 1 dot の頭: accx を 0 に、活性化の先頭レーンを q#a に */
#define WS_HEAD(a)      "ee.zero.accx\n" \
                        "ee.vld.128.ip q" #a ", %[pa], 16\n"
/* 中間レーン: q#w · q#a を溜めつつ、次のレーンを q#u に読む（u は w とも a とも別） */
#define WS_MID(w, a, u) "ee.vmulas.s8.accx.ld.ip q" #u ", %[pa], 16, q" #w ", q" #a "\n"
/* 最終レーン: 読まずに掛けて、40 bit の accx を int32 に落として out[] へ */
#define WS_TAIL(w, a)   "ee.vmulas.s8.accx q" #w ", q" #a "\n" \
                        "ee.srs.accx %[tp], %[z], 0\n" \
                        "s32i %[tp], %[po], 0\n" \
                        "addi %[po], %[po], 4\n"

#define WS_ASM(LOADW, BODY)                                                    \
    __asm__ volatile(                                                          \
        LOADW                                                                  \
        "loopnez %[n], 1f\n"                                                   \
        BODY                                                                   \
        "1:\n"                                                                 \
        : [pa] "+&a"(pa), [pw] "+&a"(pw), [po] "+&a"(po), [tp] "=&a"(tp)       \
        : [n] "a"(n), [z] "a"(0)                                               \
        : "memory")

/* 重み行 `w`（cinp バイト、16 B 境界）と、連続する `n` フレームの活性化
 * `a`（[n][cinp]、16 B 境界）の内積を `out[0..n)` に書く。
 * **載せられたら 1、cinp が広すぎる（m > 6）/ 狭すぎる（m == 0）なら 0 を返す**
 * （0 のときは `out` に触らない。呼び出し側が従来の dot に落ちる）。 */
static int saan_dot_rows_i8_pie(int32_t *out, const int8_t *w, const int8_t *a,
                                int cinp, int n) {
    const int8_t *pa = a;
    const int8_t *pw = w;
    int32_t *po = out;
    int32_t tp = 0;
    if (n <= 0) return 1;
    switch (cinp >> 4) {
    case 1:
        WS_ASM(WS_LDW(0),
               WS_HEAD(1) WS_TAIL(0, 1));
        break;
    case 2:
        WS_ASM(WS_LDW(0) WS_LDW(1),
               WS_HEAD(2) WS_MID(0, 2, 3) WS_TAIL(1, 3));
        break;
    case 3:
        WS_ASM(WS_LDW(0) WS_LDW(1) WS_LDW(2),
               WS_HEAD(3) WS_MID(0, 3, 4) WS_MID(1, 4, 3) WS_TAIL(2, 3));
        break;
    case 4:
        WS_ASM(WS_LDW(0) WS_LDW(1) WS_LDW(2) WS_LDW(3),
               WS_HEAD(4) WS_MID(0, 4, 5) WS_MID(1, 5, 4) WS_MID(2, 4, 5)
               WS_TAIL(3, 5));
        break;
    case 5:
        WS_ASM(WS_LDW(0) WS_LDW(1) WS_LDW(2) WS_LDW(3) WS_LDW(4),
               WS_HEAD(5) WS_MID(0, 5, 6) WS_MID(1, 6, 5) WS_MID(2, 5, 6)
               WS_MID(3, 6, 5) WS_TAIL(4, 5));
        break;
    case 6:
        WS_ASM(WS_LDW(0) WS_LDW(1) WS_LDW(2) WS_LDW(3) WS_LDW(4) WS_LDW(5),
               WS_HEAD(6) WS_MID(0, 6, 7) WS_MID(1, 7, 6) WS_MID(2, 6, 7)
               WS_MID(3, 7, 6) WS_MID(4, 6, 7) WS_TAIL(5, 7));
        break;
    default:
        return 0;                      /* m == 0（cin == 1）/ m > 6（pw2 の 304） */
    }
    (void)tp; (void)pa; (void)pw; (void)po;
    return 1;
}
#endif

/* この (cin, W) で PIE を使ってよいか。**整列条件をここ 1 箇所で判定する**。
 *
 * 活性化も重みも **`cinp = align16(cin)` のストライド**に揃えたので、
 * `cin` の 16 倍数性はもう要らない。残る条件は
 *   - `cin > 0`（⚠️ `saan_dot_i8_pie` は `k <= 0` を守っていない。ここが唯一の砦）
 *   - `W` が 16 B 境界（blob のテンソル offset は 16 の倍数。テストの配列は aligned(16)）
 * ⚠️ **depthwise は対象外。** `saan_dwconv1d_i8a` はチャネル方向のギャザーで、
 * `ee.vmulas.s8.accx`（16 レーンを 1 アキュムレータに畳む内積）では表現できない。
 * ストライドを揃えても載らない（MAC の 0.60%。C-035）。 */
static int saan_pie_ok(int cin, const int8_t *W) {
#if SAAN_HAVE_PIE
    return cin > 0 && (((uintptr_t)W & 15u) == 0u);
#else
    (void)cin; (void)W;
    return 0;
#endif
}

/* --- v2 レイアウトへの並べ替え（テスト / 毒テスト用。本番は exporter が書く）--------- */

size_t saan_packed_w_bytes(int cout, int cin, int ksz) {
    return (size_t)cout * (size_t)ksz * (size_t)SAAN_W_STRIDE(cin);
}

void saan_pack_w_i8(int8_t *dst, const int8_t *q, int cout, int cin, int ksz) {
    const int cinp = SAAN_W_STRIDE(cin);
    for (int o = 0; o < cout; ++o)
        for (int k = 0; k < ksz; ++k) {
            int8_t *row = dst + ((size_t)o * ksz + k) * cinp;
            for (int i = 0; i < cin; ++i) row[i] = q[((size_t)o * cin + i) * ksz + k];
            /* ⚠️ 本番 0。毒テスト（SAAN_PAD_POISON_W）はここで 127 にする。
             *    blob v2 の padding は exporter が 0 で書くので、本番経路にこのコードは無い */
            for (int i = cin; i < cinp; ++i) row[i] = (int8_t)SAAN_PAD_FILL_W;
        }
}

/* --- 量子化 -------------------------------------------------------------- */

void saan_quantize_w_i8(int8_t *q, float *scale, const float *W,
                        int cout, int inner) {
    for (int o = 0; o < cout; ++o) {
        const float *wo = W + (size_t)o * inner;
        float amax = 0.0f;
        for (int i = 0; i < inner; ++i) {
            const float v = fabsf(wo[i]);
            if (v > amax) amax = v;
        }
        /* 全ゼロ行は scale = 1（0 割りを避ける。Python 側と同じ規則） */
        /* ⚠️ 丸めは **rintf = half-to-even**。torch.round と同じ。roundf
         * (half-away-from-zero) にすると実測で 544,292 値のうち 5 個が
         * exporter と食い違う（int8_test の 2c が検出する） */
        const float s = (amax == 0.0f) ? 1.0f : amax / 127.0f;
        scale[o] = s;
        int8_t *qo = q + (size_t)o * inner;
        for (int i = 0; i < inner; ++i) {
            float v = rintf(wo[i] / s);
            if (v > 127.0f) v = 127.0f;
            if (v < -127.0f) v = -127.0f;
            qo[i] = (int8_t)v;
        }
    }
}

void saan_quantize_act_i8pr(int8_t *q, float *sx, const float *x, int C, int T,
                            int P, int u0, int u1) {
    SAAN_PROF_BEGIN(SAAN_PROF_QUANT);
    /* S9: フレーム [u0, u1) だけ。per-frame なので他のフレームの有無は値に影響しない */
    for (int t = u0; t < u1; ++t) {
        float amax = 0.0f;
        for (int c = 0; c < C; ++c) {
            const float v = fabsf(x[(size_t)c * T + t]);
            if (v > amax) amax = v;
        }
        int8_t *qt = q + (size_t)t * P;
        /* ⚠️ **パディング部を毎フレーム 0 にする。** ここを外すと
         * 「前の層の活性化のバイトが内積に混ざる」形で**静かに壊れる**:
         * `saan_conv1d_w` は arena を `a->used = mark` で即返すので、
         * 次の conv が**同じ番地を再利用する**。例外も NaN も出ない。
         * ⚠️ **これを検出できるゲートは 1 つしかない** — 相手側（重み）の
         * パディングを非ゼロで汚したうえで bit 一致を見ること。
         * 内積は `Σ w_pad · a_pad` なので、**片方が 0 なら他方がゴミでも答えが変わらず**、
         * 素直な参照比較では捕まらない（`csrc/int8_pad_test.c` の G-1）。 */
        if (P > C) memset(qt + C, SAAN_PAD_FILL_A, (size_t)(P - C));
        if (amax == 0.0f) {
            sx[t] = 0.0f;
            memset(qt, 0, (size_t)C);
            continue;
        }
        const float s = amax / 127.0f;
        sx[t] = s;
        /* ⚠️ **S2: 除算を逆数の乗算に。** ESP32-S3 の FPU に除算は無く、`x / s` は
         *    要素ごとに `__divsf3`（ソフト浮動小数）を呼んでいた（M-80。nm -u で確認）。
         *    `x * (127 / amax)` は `x / (amax / 127)` と**最終ビットが違いうる**ので、
         *    これは「丸め水準」の変更。出力の checksum は変わる（M-62 の値とは一致しない）。
         *    `sx[t]` は従来どおり `amax / 127`（逆量子化の意味は変えない）。
         *    クランプは int で行う（float の 127.0f 比較より安い）。 */
        const float inv = 127.0f / amax;
        for (int c = 0; c < C; ++c) {
            int32_t q = saan_rint_i32(x[(size_t)c * T + t] * inv);
            if (q > 127) q = 127;
            if (q < -127) q = -127;
            qt[c] = (int8_t)q;
        }
    }
    SAAN_PROF_END(SAAN_PROF_QUANT);
    SAAN_PROF_ADD(SAAN_PROF_QUANT, (size_t)C * (u1 - u0));
}

void saan_quantize_act_i8p(int8_t *q, float *sx, const float *x, int C, int T,
                           int P) {
    saan_quantize_act_i8pr(q, sx, x, C, T, P, 0, T);
}

void saan_quantize_act_i8(int8_t *q, float *sx, const float *x, int C, int T) {
    saan_quantize_act_i8p(q, sx, x, C, T, C);   /* パディング無し = 従来の挙動 */
}

size_t saan_act_scratch_bytes(int C, int T) {
    /* ⚠️ **パディング後のストライドで数える。** `C` のまま数えると
     * 呼び出し側が過少確保して隣接バッファを踏む（silent） */
    return (size_t)SAAN_ALIGN16((size_t)C) * (size_t)T * sizeof(int8_t)
         + (size_t)T * sizeof(float);
}

/* --- W8A32 --------------------------------------------------------------- */

void saan_conv1d_i8_r(float *y, const float *x, const int8_t *W, const float *scale,
                      const float *b, int cin, int cout, int ksz, int T, int t0, int t1) {
    const int pad = ksz / 2;
    const int cinp = SAAN_W_STRIDE(cin);   /* blob v2: W[(o*ksz + k)*cinp + i] */
    const int Ty = t1 - t0;                /* S9: 出力は圧縮 [cout][Ty] */
    for (int o = 0; o < cout; ++o) {
        float *yo = y + (size_t)o * Ty;
        for (int t = 0; t < Ty; ++t) yo[t] = 0.0f;
        /* ⚠️ **ループの順序（i 外 / k 内 / t 最内）は v1 のまま。** float の加算順が変わると
         *    出力が bit 一致しなくなる。S9 で変えたのは最内ループの上下限を [t0, t1) と
         *    交わすことだけ（要素ごとの積和順序は同じ） */
        for (int i = 0; i < cin; ++i) {
            const float *xi = x + (size_t)i * T;
            const int8_t *wo = W + (size_t)o * ksz * cinp;
            for (int k = 0; k < ksz; ++k) {
                const int qv = wo[(size_t)k * cinp + i];
                if (qv == 0) continue;           /* fp32 版と同じくゼロ枝刈り */
                const float wv = (float)qv;
                const int sh = k - pad;
                int ta = sh < 0 ? -sh : 0;
                int tb = sh > 0 ? T - sh : T;
                if (ta < t0) ta = t0;
                if (tb > t1) tb = t1;
                for (int t = ta; t < tb; ++t) yo[t - t0] += wv * xi[t + sh];
            }
        }
        const float s = scale[o];
        const float bias = b ? b[o] : 0.0f;
        for (int t = 0; t < Ty; ++t) yo[t] = yo[t] * s + bias;
    }
}

void saan_conv1d_i8(float *y, const float *x, const int8_t *W, const float *scale,
                    const float *b, int cin, int cout, int ksz, int T) {
    saan_conv1d_i8_r(y, x, W, scale, b, cin, cout, ksz, T, 0, T);
}

void saan_dwconv1d_i8_r(float *y, const float *x, const int8_t *W, const float *scale,
                        int ch, int ksz, int T, int t0, int t1) {
    const int pad = ksz / 2;
    const int Ty = t1 - t0;
    for (int o = 0; o < ch; ++o) {
        float *yo = y + (size_t)o * Ty;
        const float *xi = x + (size_t)o * T;
        const int8_t *wk = W + (size_t)o * ksz;
        for (int t = 0; t < Ty; ++t) yo[t] = 0.0f;
        for (int k = 0; k < ksz; ++k) {
            const float wv = (float)wk[k];
            const int sh = k - pad;
            int ta = sh < 0 ? -sh : 0;
            int tb = sh > 0 ? T - sh : T;
            if (ta < t0) ta = t0;
            if (tb > t1) tb = t1;
            for (int t = ta; t < tb; ++t) yo[t - t0] += wv * xi[t + sh];
        }
        const float s = scale[o];
        for (int t = 0; t < Ty; ++t) yo[t] *= s;
    }
}

void saan_dwconv1d_i8(float *y, const float *x, const int8_t *W, const float *scale,
                      int ch, int ksz, int T) {
    saan_dwconv1d_i8_r(y, x, W, scale, ch, ksz, T, 0, T);
}

/* --- W8A8 ---------------------------------------------------------------- */

/* S5b: t 方向のブロック長。`acc[]`（と PIE 版の `a32b[]`）をスタックに置くための上限で、
 * 出力列がこれより長ければ複数ブロックに切る。ブロックに切っても各 t の足し込み順は
 * 変わらないので **bit 同一**。ストリーミングの本番は Ty = SAAN_CHUNK = 8 なので 1 ブロックで
 * 収まり、一括版（`saanotts.c`。Ty = n_frames）だけが複数ブロックになる。
 * スタックは float 32 + int32 32 = 256 B。 */
#define SAAN_WSTAT_TB 32

void saan_conv1d_i8a_r(float *y, const float *x, const int8_t *W, const float *scale,
                       const float *b, int cin, int cout, int ksz, int T, int t0, int t1,
                       int8_t *qx, float *sx) {
    const int pad = ksz / 2;
    /* 活性化も重みも **`cinp = SAAN_W_STRIDE(cin)` のストライド**（blob v2。S4）。
     * パディング部は 0 なので積和に寄与せず、端数処理が要らない。
     * 重みは blob の中で最初から [cout][k][cinp] に並んでいるので、以前あった
     * スタック `wt` への転置コピー（1 step に 489 KB。M-80 の WCOPY）は無い。 */
    const int cinp = SAAN_W_STRIDE(cin);
    const int Ty = t1 - t0;                /* S9: 出力は圧縮 [cout][Ty] */
    const int pie = saan_pie_ok(cin, W);
    (void)pie;   /* PIE 無しのビルドでは未使用 */

    /* S9: 量子化するのは出力 [t0, t1) が参照するフレーム [t0−pad, t1+pad) ∩ [0, T) だけ。
     * per-frame（時刻ごとに amax）なので、量子化するフレームを絞っても各フレームの値は同じ。
     * 範囲外の qx の行 / sx は前の conv の残骸のままだが、下の積和は u ∈ [t−pad, t+pad] しか読まない */
    {
        int u0 = t0 - pad, u1 = t1 + pad;
        if (u0 < 0) u0 = 0;
        if (u1 > T) u1 = T;
        saan_quantize_act_i8pr(qx, sx, x, cin, T, cinp, u0, u1);
    }
    /* S5b: ループ順は **o → k → t**（旧: o → t → k）。同じ (o, k) の重み行を
     * t を通して使い回すための順序で、`saan_dot_rows_i8_pie` が重み行を
     * q レジスタに 1 回だけロードして t を回す。
     *
     * ⚠️ **float の足し込み順は変えていない。** ある t の `acc` は k 昇順に
     * 溜まる（範囲外のタップは下の `ta`/`tb` で t 側に畳んであるので、
     * 旧ループの `continue` と同じ組み合わせだけが足される）。したがって
     * 旧実装と **bit 同一**。`acc` はレジスタから配列に移ったが、float は
     * 格納しても値が変わらない（IEEE 単精度・拡張精度を持たない）。
     * ⚠️ 順序を変えると **ホストのゲートでは検出できない**（ホストも同じ順序で
     * 動くため）。ここを触るときは QEMU の checksum を必ず取り直すこと。
     *
     * `t` は `SAAN_WSTAT_TB` 列ずつのブロックに切る（`acc` / `a32b` をスタックに
     * 置くため）。ブロックに切っても各 t の足し込み順は変わらない。 */
    for (int o = 0; o < cout; ++o) {
        float *yo = y + (size_t)o * Ty;
        const float s = scale[o];
        const float bias = b ? b[o] : 0.0f;
        const int8_t *wo = W + (size_t)o * ksz * cinp;   /* [k][cinp] */
        SAAN_PROF_BEGIN(SAAN_PROF_MAC);
        for (int tb0 = t0; tb0 < t1; tb0 += SAAN_WSTAT_TB) {
            int tb1 = tb0 + SAAN_WSTAT_TB;
            if (tb1 > t1) tb1 = t1;
            const int nb = tb1 - tb0;
            float acc[SAAN_WSTAT_TB];
#if SAAN_HAVE_PIE
            int32_t a32b[SAAN_WSTAT_TB];
#endif
            for (int i = 0; i < nb; ++i) acc[i] = 0.0f;
            for (int k = 0; k < ksz; ++k) {
                /* 両端ゼロパディング: u = t + k − pad が [0, T) に入る t だけ。
                 * 旧ループの `if (u < 0 || u >= T) continue;` と同じ集合。 */
                int ta = pad - k;
                int te = T + pad - k;
                if (ta < tb0) ta = tb0;
                if (te > tb1) te = tb1;
                if (ta >= te) continue;
                const int n = te - ta;
                const int8_t *wk = wo + (size_t)k * cinp;   /* blob 内。16 B 境界 */
                const int8_t *qu = qx + (size_t)(ta + k - pad) * cinp;
                const float *sxu = sx + (ta + k - pad);
                float *ap = acc + (ta - tb0);
#if SAAN_HAVE_PIE
                if (pie) {
                    /* `wk` も `qu` も 16 整列、`cinp` は 16 の倍数。
                     * cinp ≤ 96 なら重み常駐（S5b）、それより広い pw2 は 1 dot ずつ */
                    if (!saan_dot_rows_i8_pie(a32b, wk, qu, cinp, n)) {
                        for (int i = 0; i < n; ++i)
                            a32b[i] = saan_dot_i8_pie(wk, qu + (size_t)i * cinp, cinp);
                    }
                    for (int i = 0; i < n; ++i) ap[i] += (float)a32b[i] * sxu[i];
                } else
#endif
                {
                    /* ⚠️ 既定は `i < cin`。`SAAN_PIE_EMU=1` のときだけ PIE と
                     * 同じ `cinp` レーンまで回す（パディング検査用。上のヘッダ参照） */
                    const int lanes = SAAN_PIE_EMU ? cinp : cin;
                    for (int i = 0; i < n; ++i) {
                        const int8_t *qi = qu + (size_t)i * cinp;
                        int32_t a32 = 0;
                        for (int j = 0; j < lanes; ++j)
                            a32 += (int32_t)wk[j] * (int32_t)qi[j];
                        ap[i] += (float)a32 * sxu[i];
                    }
                }
            }
            for (int i = 0; i < nb; ++i) yo[tb0 - t0 + i] = acc[i] * s + bias;
        }
        SAAN_PROF_END(SAAN_PROF_MAC);
        SAAN_PROF_ADD(SAAN_PROF_MAC, (size_t)cin * ksz * Ty);
    }
}

void saan_conv1d_i8a(float *y, const float *x, const int8_t *W, const float *scale,
                     const float *b, int cin, int cout, int ksz, int T,
                     int8_t *qx, float *sx) {
    saan_conv1d_i8a_r(y, x, W, scale, b, cin, cout, ksz, T, 0, T, qx, sx);
}

void saan_dwconv1d_i8a_r(float *y, const float *x, const int8_t *W, const float *scale,
                         int ch, int ksz, int T, int t0, int t1, int8_t *qx, float *sx) {
    const int pad = ksz / 2;
    const int Ty = t1 - t0;
    SAAN_PROF_BEGIN(SAAN_PROF_DW);
    /* ⚠️ **depthwise は PIE に載らない**（チャネル方向のギャザーで、
     * `ee.vmulas.s8.accx` の内積では表現できない。C-035）。
     * それでも `saan_quantize_act_i8pr` を共有するので**ストライドは追従する**。
     * ここを `ch` のままにすると読み位置がずれて黙って壊れる。 */
    const int chp = (int)SAAN_ALIGN16((size_t)ch);
    {
        int u0 = t0 - pad, u1 = t1 + pad;   /* S9: 参照するフレームだけ量子化（上の conv と同じ） */
        if (u0 < 0) u0 = 0;
        if (u1 > T) u1 = T;
        saan_quantize_act_i8pr(qx, sx, x, ch, T, chp, u0, u1);
    }
    for (int o = 0; o < ch; ++o) {
        float *yo = y + (size_t)o * Ty;
        const int8_t *wk = W + (size_t)o * ksz;
        const float s = scale[o];
        for (int t = t0; t < t1; ++t) {
            float acc = 0.0f;
            for (int k = 0; k < ksz; ++k) {
                const int u = t + k - pad;
                if (u < 0 || u >= T) continue;
                const int32_t p = (int32_t)wk[k] * (int32_t)qx[(size_t)u * chp + o];
                acc += (float)p * sx[u];
            }
            yo[t - t0] = acc * s;
        }
    }
    SAAN_PROF_END(SAAN_PROF_DW);
    SAAN_PROF_ADD(SAAN_PROF_DW, (size_t)ch * ksz * Ty);
}

void saan_dwconv1d_i8a(float *y, const float *x, const int8_t *W, const float *scale,
                       int ch, int ksz, int T, int8_t *qx, float *sx) {
    saan_dwconv1d_i8a_r(y, x, W, scale, ch, ksz, T, 0, T, qx, sx);
}

/* --- ブロブ -------------------------------------------------------------- */

const int8_t *saan_ti8(const saan_weights *w, const float **scale,
                       const char *fmt, ...) {
    char buf[I8_NAME_LEN];
    char sbuf[I8_NAME_LEN + 8];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);

    uint32_t dt = 0;
    const void *p = saan_tensor(w, buf, &dt, NULL, NULL);
    if (!p || dt != 1u) return NULL;

    snprintf(sbuf, sizeof sbuf, "%s.scale", buf);
    if (scale) {
        uint32_t sdt = 0;
        const void *sp = saan_tensor(w, sbuf, &sdt, NULL, NULL);
        if (!sp || sdt != 2u) return NULL;
        *scale = (const float *)sp;
    }
    return (const int8_t *)p;
}

/* --- fp32 / int8 のディスパッチ（D-3c'-2） --------------------------------
 *
 * ここに置くのは **`saanotts.c` を int8 に依存させない**ため。
 * 一括版もストリーミング版も `saan_conv1d_w` だけを呼べばよく、
 * どちらの経路を通るかは読み込んだブロブの dtype が決める。
 */

static saan_wref saan_w_named(const saan_weights *w, const char *buf) {
    char sbuf[I8_NAME_LEN + 8];
    saan_wref r = {NULL, NULL, NULL, 0};

    uint32_t dt = 0, dims[4] = {0, 0, 0, 0};
    uint64_t nb = 0;
    const void *p = saan_tensor(w, buf, &dt, dims, &nb);
    if (!p) return r;                       /* 名前が無い = 両方 NULL のまま */
    if (dt == 0u) { r.f32 = (const float *)p; return r; }
    if (dt != 1u) return r;                 /* scale(2) を重みとして掴まない */

    /* ⚠️ **v2 のレイアウトを nbytes で検算する。** dims は論理形 (cout, cin, k) のまま
     *    なので、payload が [cout][k][cinp] ぶんあるかを見る。合わなければ「引けなかった」
     *    （= SAAN_ERR_MISSING で止まる。黙って別物の音を出さない）。 */
    {
        const int cout = (int)dims[0], cin = (int)dims[1], ksz = (int)dims[2];
        if (cout <= 0 || cin <= 0 || ksz <= 0) return r;
        if (nb != (uint64_t)saan_packed_w_bytes(cout, cin, ksz)) return r;
        r.cinp = SAAN_W_STRIDE(cin);
    }

    snprintf(sbuf, sizeof sbuf, "%s.scale", buf);
    uint32_t sdt = 0;
    const void *sp = saan_tensor(w, sbuf, &sdt, NULL, NULL);
    if (!sp || sdt != 2u) { r.cinp = 0; return r; }   /* scale が無いなら「引けなかった」 */
    r.q = (const int8_t *)p;
    r.scale = (const float *)sp;
    return r;
}

saan_wref saan_w(const saan_weights *w, const char *fmt, ...) {
    char buf[I8_NAME_LEN];
    va_list ap;
    SAAN_PROF_BEGIN(SAAN_PROF_LOOKUP);
    va_start(ap, fmt);
    vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    {
        const saan_wref r = saan_w_named(w, buf);
        SAAN_PROF_END(SAAN_PROF_LOOKUP);
        return r;
    }
}

size_t saan_act_scratch_needed(int cin, int T) {
#if SAAN_INT8_ACT
    /* qx [T][cin] と sx [T] を別々に saan_alloc するので、境界も別々に数える */
    /* ⚠️ **パディング後のストライドで数える**（`saan_conv1d_w` の確保と必ず一致させる。
     * 片方だけ直すと arena 不足＝loud か、隣接バッファの上書き＝silent かが分かれる） */
    return SAAN_ALIGN16(SAAN_ALIGN16((size_t)cin) * (size_t)T)
         + SAAN_ALIGN16(sizeof(float) * (size_t)T);
#else
    (void)cin; (void)T;
    return 0;
#endif
}

saan_status saan_conv1d_wr(float *y, const float *x, saan_wref W, const float *b,
                           int cin, int cout, int ksz, int T, int t0, int t1,
                           saan_arena *a) {
    if (t0 < 0 || t1 > T || t0 > t1) return SAAN_ERR_SHAPE;   /* 圧縮出力の範囲が窓の外 */
    if (W.f32) {                            /* fp32 ブロブ: 既存カーネルそのもの */
        saan_conv1d_r(y, x, W.f32, b, cin, cout, ksz, T, t0, t1);
        return SAAN_OK;
    }
    if (!W.q || !W.scale) return SAAN_ERR_MISSING;
#if SAAN_INT8_ACT
    if (!a) return SAAN_ERR_ARENA;
    {
        /* 作業領域は [T] ぶん（範囲版も添字は絶対時刻のまま。T ≤ 32 なので詰めない） */
        const size_t mark = a->used;
        int8_t *qx = (int8_t *)saan_alloc(a, SAAN_ALIGN16((size_t)cin) * (size_t)T);
        float *sx = (float *)saan_alloc(a, sizeof(float) * (size_t)T);
        if (!qx || !sx) { a->used = mark; return SAAN_ERR_ARENA; }
        saan_conv1d_i8a_r(y, x, W.q, W.scale, b, cin, cout, ksz, T, t0, t1, qx, sx);
        a->used = mark;
    }
#else
    (void)a;
    saan_conv1d_i8_r(y, x, W.q, W.scale, b, cin, cout, ksz, T, t0, t1);
#endif
    return SAAN_OK;
}

saan_status saan_conv1d_w(float *y, const float *x, saan_wref W, const float *b,
                          int cin, int cout, int ksz, int T, saan_arena *a) {
    return saan_conv1d_wr(y, x, W, b, cin, cout, ksz, T, 0, T, a);
}

saan_status saan_dwconv1d_wr(float *y, const float *x, saan_wref W,
                             int ch, int ksz, int T, int t0, int t1, saan_arena *a) {
    if (t0 < 0 || t1 > T || t0 > t1) return SAAN_ERR_SHAPE;
    if (W.f32) {
        saan_dwconv1d_r(y, x, W.f32, ch, ksz, T, t0, t1);
        return SAAN_OK;
    }
    if (!W.q || !W.scale) return SAAN_ERR_MISSING;
#if SAAN_INT8_ACT
    if (!a) return SAAN_ERR_ARENA;
    {
        const size_t mark = a->used;
        int8_t *qx = (int8_t *)saan_alloc(a, SAAN_ALIGN16((size_t)ch) * (size_t)T);
        float *sx = (float *)saan_alloc(a, sizeof(float) * (size_t)T);
        if (!qx || !sx) { a->used = mark; return SAAN_ERR_ARENA; }
        saan_dwconv1d_i8a_r(y, x, W.q, W.scale, ch, ksz, T, t0, t1, qx, sx);
        a->used = mark;
    }
#else
    (void)a;
    saan_dwconv1d_i8_r(y, x, W.q, W.scale, ch, ksz, T, t0, t1);
#endif
    return SAAN_OK;
}

saan_status saan_dwconv1d_w(float *y, const float *x, saan_wref W,
                            int ch, int ksz, int T, saan_arena *a) {
    return saan_dwconv1d_wr(y, x, W, ch, ksz, T, 0, T, a);
}
