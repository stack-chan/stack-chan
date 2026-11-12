/* sanoTTS-jp 推論コア（C99 / 依存なし）
 *
 * 論文 arXiv:2608.21378 の 3 段構成をそのまま実装する:
 *
 *   音素ID → Duration Dα → d̂ = clip[1,80](round(s_v·r))
 *          → Acoustic Aβ → c[40,T]
 *          → iSTFT Decoder Gγ → 22.05 kHz PCM
 *
 * 設計方針:
 *   - **malloc をコアで呼ばない。** 呼び出し側が arena を渡す（ESP32 で断片化させない）
 *   - 重みは SAAN 形式のバイナリを mmap / flash から読む（コピーしない）
 *   - fp32 でまず正しさを出す。int8 カーネルは golden test が通ってから
 *
 * ⚠️ **参照実装（`src/saanotts_jp/_param_reference.py`）と 1:1 で対応させること。**
 *   片方だけ直すと golden test が落ちる。それが検出手段。
 */
#ifndef SAANOTTS_H
#define SAANOTTS_H

#include <stddef.h>
#include <stdint.h>

#define SAAN_SR        22050
#define SAAN_HOP       256
#define SAAN_NFFT      1024
#define SAAN_NBINS     513      /* NFFT/2 + 1 */
#define SAAN_CDIM      40       /* c-line */
#define SAAN_DUR_W     32

/* MEM-7: duration net を窓分割するときの 1 窓で確定させるトークン数と、片側のハロー。
 *
 * ⚠️ **ハロー 12 は duration net の受容野そのもの**で、選べる値ではない。
 *    3 ブロック × (c1 k=5 + c2 k=5) = ブロックあたり ±4、proj は 1×1 で ±0 → ±12。
 *    `saanotts_stream.c` の `TOK_HALO`（= 3·`TOK_PAD`）と同じ値である。
 * ⚠️ **1 足りないと「ほぼ合う」** — `log_d` は exp → round → clip[1,80] を通るので、
 *    ハロー 11 でも多くの文では `d_hat` が変わらず PCM も変わらない
 *    （[M-143](../docs/measurements.md#m-143) の陽性対照 P1: 350 ids で違う列 20/350 / max|Δ| 0.0133）。
 *    **判定は PCM の checksum ではなく `log_d` の memcmp で行うこと。**
 * K は arena と再計算のつり合いで選ぶ。**値を変えても出力は bit 一致する**:
 *    K=128 で 350 ids のピーク 63,840 B / 再計算 1.21×（`make -C csrc dur` が測る）。 */
#define SAAN_DUR_HALO  12
#ifndef SAAN_DUR_K
#define SAAN_DUR_K     128
#endif
#define SAAN_AC_W      48
#define SAAN_DEC_W     76
#define SAAN_DEC_E     304
#define SAAN_DEC_R     12       /* 条件付けのランク */
#define SAAN_DEC_HEAD  48
#define SAAN_POS_MAX   88       /* 音素内位置埋め込み */
#define SAAN_VOCAB     57       /* 日本語のデプロイ語彙（D-016） */
#define SAAN_CLIP_LO   1
#define SAAN_CLIP_HI   80
#define SAAN_S_V       1.2187f  /* D-019 */

typedef enum {
    SAAN_OK = 0,
    SAAN_ERR_MAGIC = -1,        /* SAAN ヘッダでない */
    SAAN_ERR_VERSION = -2,
    SAAN_ERR_MISSING = -3,      /* 必要なテンソルが無い */
    SAAN_ERR_SHAPE = -4,        /* shape が想定と違う */
    SAAN_ERR_ARENA = -5,        /* arena が足りない */
    SAAN_ERR_RANGE = -6         /* 音素ID が語彙外 */
} saan_status;

/* 重みブロブ（読み取り専用。コアは書き換えない）
 *
 * version: 1 = 旧レイアウト（int8 conv 重みが [cout][cin][k]）/ **2 = S4 以降**
 *   （int8 conv 重みが [cout][k][align16(cin)] で 0 埋め。転置コピー無しで PIE に渡せる）。
 * ⚠️ **v1 の int8 blob は開けない**（SAAN_ERR_VERSION）。fp32 だけの v1（golden / ids）は開ける。 */
typedef struct {
    const uint8_t *base;
    size_t size;
    uint32_t n_tensors;
    uint32_t version;
} saan_weights;

/* 作業領域。**コアは malloc しない** */
typedef struct {
    uint8_t *buf;
    size_t size;
    size_t used;
    /* 高水位。`used` は mark/rollback で戻るので、**一時確保を見落とさない**
     * ためにこちらで測る（W8A8 の activation 作業領域がそれ）。init で 0 に戻る */
    size_t peak;
    /* **粘着する失敗フラグ。** 一度でも確保に失敗したら以降の `saan_alloc` は
     * 必ず NULL を返す。これが無いと「大きい確保だけ失敗して、後続の小さい
     * 確保は成功する」ため、**呼び出し側が最後の 1 個しか NULL 検査していないと
     * init が成功を返したまま NULL を抱える**（実際に踏んだ。arena 175〜191 KB の
     * 15 サイズで再現）。ESP32 では「ログ無しで再起動」に化ける */
    int failed;
} saan_arena;

/* 1 発話の中間結果へのポインタ（すべて arena 上） */
typedef struct {
    int32_t n_ids;
    int32_t n_frames;
    int32_t n_samples;
    float *log_d;       /* [n_ids] */
    int32_t *d_hat;     /* [n_ids] */
    float *c;           /* [SAAN_CDIM * n_frames] */
    float *pcm;         /* [n_samples] */
} saan_output;

/* --- API ---------------------------------------------------------------- */

saan_status saan_weights_open(saan_weights *w, const void *blob, size_t size);

/* 名前でテンソルを引く。見つからなければ NULL。`dims` は 4 要素書かれる */
const void *saan_tensor(const saan_weights *w, const char *name,
                        uint32_t *dtype, uint32_t dims[4], uint64_t *nbytes);

void saan_arena_init(saan_arena *a, void *buf, size_t size);
void saan_arena_reset(saan_arena *a);

/* n_ids トークンを合成するのに必要な arena バイト数（上限）。
 * **実際に走らせる前にこれで足りるか確かめる**（ESP32 で OOM しないため） */
size_t saan_arena_needed(int32_t n_ids);

/* 合成。`ids` は**生徒の埋め込みインデックス**（教師IDではない。D-016） */
saan_status saan_synthesize(const saan_weights *w, saan_arena *a,
                            const int32_t *ids, int32_t n_ids,
                            float s_v, saan_output *out);

/* `d_fixed` に [n_ids] の d̂ を渡すと duration の推定を**上書き**する（NULL なら内部計算）。
 *
 * ⚠️ **測定専用の入口**。fp32 と int8 で d̂ が 1 トークンでもずれるとフレーム数が
 * 変わり、波形 SNR が定義できなくなる（held-out 24 文中 15 文でずれる）。
 * 「SNR が出ない = 実装バグ」と誤読しないため、比較時は fp32 側の d̂ に固定する。
 * `log_d` は上書きしても計算する（どれだけずれたかを見るため）。
 * 本番は `saan_synthesize`（= これに NULL を渡す薄いラッパ）を使う。 */
saan_status saan_synthesize_d(const saan_weights *w, saan_arena *a,
                              const int32_t *ids, int32_t n_ids, float s_v,
                              const int32_t *d_fixed, saan_output *out);

const char *saan_strerror(saan_status s);

#endif /* SAANOTTS_H */
