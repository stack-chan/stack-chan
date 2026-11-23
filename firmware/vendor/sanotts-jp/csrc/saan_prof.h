/* 段別プロファイラ（**既定は無効**。`-DSAAN_PROFILE=1` で有効になる）
 *
 * なぜ要るか: 実機（M5Stack CoreS3、第三者の報告）で W8A8 + PIE が **1.55× RT** と
 * 論文の 0.22× RT から 7 倍離れていた。1 チャンクの MAC 数（約 7.8 M）に対して
 * 34.6 M サイクルは **4.4 サイクル/MAC** で、PIE の理論値 1/16 サイクル/MAC とは
 * 70 倍離れている。**積和以外の何かが支配的**だと分かるが、どれかは測らないと分からない。
 *
 * 方式: 区間ごとに `saan_prof_now()` の差を uint64 に足す。時計はプラットフォームが
 * 定義する（ESP32 = CCOUNT（サイクル）、ホスト = ns、QEMU = 仮想時間）。
 *
 * ⚠️ **QEMU で取った値はサイクルではない。** `-icount` なら命令数に比例した
 *    仮想時間になる。キャッシュミスも FPU の遅延も入らない。**実機の値と混ぜないこと。**
 * ⚠️ **計測自体のコスト**: 区間の出入りで `saan_prof_now()` を 2 回呼ぶ
 *    （関数呼び出し + RSR CCOUNT）。`hout` は cout=1,539 なので出力チャネルごとの
 *    区間（WCOPY / MAC）は 1 チャンクに約 3,000 回入る。**細かい区間ほど過大に出る。**
 * ⚠️ **SAAN_PROFILE=0 ではマクロが `((void)0)` に展開され、コードは 1 バイトも変わらない。**
 *    `make -C csrc all-test` と `scripts/check_esp32_template.sh` はこの構成で回る。
 *
 * 区間は入れ子になっている（例: AC の中に QUANT / WCOPY / MAC / LN が入る）。
 * 段（STEP / HF / TOKEN / AC / DINP / DEC / HEAD / ISTFT）は互いに重ならず、
 * カーネル（LOOKUP / QUANT / WCOPY / MAC / DW / CONV32 / GELU / LN / RELU / PIPE）も
 * 互いに重ならない。**段の合計 ≒ STEP、カーネルの合計 ≒ STEP − その他** で読む。
 */
#ifndef SAAN_PROF_H
#define SAAN_PROF_H

#include <stddef.h>
#include <stdint.h>

#ifndef SAAN_PROFILE
#define SAAN_PROFILE 0
#endif

enum {
    /* --- 段（互いに重ならない。合計 ≒ STEP） --- */
    SAAN_PROF_STEP = 0,   /* step_chunk 全体（1 チャンク = CH フレーム） */
    SAAN_PROF_HF,         /* make_hf（TOKEN を含む） */
    SAAN_PROF_TOKEN,      /* tok_pipe_advance（token block 3 段のパイプ。S6 / T3 で「毎チャンク
                           * ±12 幅を再計算」から「TOK_K トークンずつ 1 回だけ」になった。
                           * 要素 = 新しく計算した出力トークン数） */
    SAAN_PROF_AC,         /* ac_step × 5 */
    SAAN_PROF_DINP,       /* dec_inp_step */
    SAAN_PROF_DEC,        /* dec_step × 5 */
    SAAN_PROF_HEAD,       /* hdown + gelu + hout */
    SAAN_PROF_ISTFT,      /* istft_push（irfft + OLA）と istft_pop */
    /* --- カーネル（互いに重ならない。段の中に入る） --- */
    SAAN_PROF_LOOKUP,     /* saan_tf / saan_w（名前の組み立て + ヘッダの線形走査） */
    SAAN_PROF_QUANT,      /* saan_quantize_act_i8p（W8A8 の活性化量子化） */
    SAAN_PROF_WCOPY,      /* saan_conv1d_i8a の重みの転置/コピー（flash → wt） */
    SAAN_PROF_MAC,        /* saan_conv1d_i8a の積和ループ（float の後処理込み） */
    SAAN_PROF_DW,         /* saan_dwconv1d_i8a 全体（PIE に載らない 0.60%） */
    SAAN_PROF_CONV32,     /* saan_conv1d / saan_dwconv1d（fp32 / W8A32 経路） */
    SAAN_PROF_GELU,
    SAAN_PROF_LN,
    SAAN_PROF_RELU,
    SAAN_PROF_PIPE,       /* pipe_push / pipe_center（memmove / memcpy） */
    /* --- 発話ごとに 1 回 --- */
    SAAN_PROF_INIT,       /* saan_stream_init（duration net 込み） */
    SAAN_PROF_N
};

#if SAAN_PROFILE
extern uint64_t saan_prof_acc[SAAN_PROF_N];   /* 時計の差の合計 */
extern uint32_t saan_prof_cnt[SAAN_PROF_N];   /* 区間に入った回数 */
extern uint64_t saan_prof_n[SAAN_PROF_N];     /* 処理した要素数（QUANT / GELU / MAC など） */

/* ⚠️ **プラットフォームが定義する。** コアは呼ぶだけ（依存を増やさない）。
 *    ESP32: esp_cpu_get_cycle_count() / ホスト: clock_gettime の ns */
uint32_t saan_prof_now(void);

const char *saan_prof_name(int id);
void saan_prof_reset(void);

#define SAAN_PROF_BEGIN(id) const uint32_t saan_prof_t_##id = saan_prof_now()
#define SAAN_PROF_END(id) \
    do { saan_prof_acc[id] += (uint32_t)(saan_prof_now() - saan_prof_t_##id); \
         ++saan_prof_cnt[id]; } while (0)
#define SAAN_PROF_ADD(id, n) do { saan_prof_n[id] += (uint64_t)(n); } while (0)
#else
#define SAAN_PROF_BEGIN(id) ((void)0)
#define SAAN_PROF_END(id)   ((void)0)
#define SAAN_PROF_ADD(id, n) ((void)0)
#endif

#endif /* SAAN_PROF_H */
