/* sanoTTS-jp int8 カーネル（C99 / 依存は libm のみ）
 *
 * 方式（論文 §II-C / M-39 のシミュレーションと同一）:
 *   - 重み  : **symmetric int8 / per-output-channel**。scale[o] = max|W[o,:,:]| / 127
 *   - 埋め込み・LayerNorm・1-D パラメータ（bias / LayerScale）は **fp32 のまま**
 *   - activation は **2 通り**用意した。どちらを使うかは呼び出し側が決める:
 *
 *       W8A32  saan_conv1d_i8   / saan_dwconv1d_i8    重みだけ int8、activation は fp32
 *       W8A8   saan_conv1d_i8a  / saan_dwconv1d_i8a   activation も per-frame int8、
 *                                                     積和は **int32** で溜める
 *
 *   ⚠️ **既定は W8A32 を推奨する**（`reports/d3c_int8.json` の理由節）。
 *      W8A8 は flash を減らさない（重みのビット幅は同じ）。減るのは演算コストだけで、
 *      その代わり SNR を大きく落とす。ESP32-S3 に載せるときに初めて効く選択なので、
 *      まず W8A32 で fp32 との差を潰し、速度が足りなければ W8A8 に切り替える。
 *
 * ⚠️ **量子化 activation のレイアウトは転置 `[T][C]`**（重み側の `[cout][cin][k]` と
 *    内積が連続になるようにするため）。fp32 の activation は `[C][T]` のままなので
 *    **取り違えると黙って別物になる**。
 */
#ifndef SAANOTTS_INT8_H
#define SAANOTTS_INT8_H

#include <math.h>
#include <stddef.h>
#include <stdint.h>

#include "saanotts.h"

/* --- 検査用の「毒」フック（既定 0 = 本番の挙動）-----------------------------
 * W8A8 のパディング部を 0 ではなく 127 で埋めるビルドを作るためのもの。
 *
 * ⚠️ **なぜ要るか**: 隙間の寄与は `Σ w_pad · a_pad` なので、
 * **片方が 0 なら他方がゴミでも出力は変わらない**。したがって
 * 「片方のゼロ埋めを外して出力が変わるか」では検出できない（**実際に踏んだ**）。
 * **相手側を非ゼロにしたうえで**「出力が変わらないこと」を見るしかない。
 *   - `SAAN_PAD_POISON_W=1` で重み側を汚す → **活性化側**のゼロ埋めを証明する
 *   - `SAAN_PAD_POISON_A=1` で活性化側を汚す → **重み側**のゼロ埋めを証明する
 *   - 両方 1 なら**出力は変わらなければおかしい** = 陽性対照
 * 詳細と実行方法は `csrc/int8_pad_test.c` / `make -C csrc pad`。 */
#ifndef SAAN_PAD_POISON_W
#define SAAN_PAD_POISON_W 0
#endif
#ifndef SAAN_PAD_POISON_A
#define SAAN_PAD_POISON_A 0
#endif
/* ⚠️ **ホストではパディング部が一度も読まれない。**
 * スカラ枝は `for (i < cin)` で回るので、`[cin, cinp)` に何が入っていても
 * 出力は変わらない。読むのは PIE の `ee.vld.128.ip`（16 レーン一括）だけ。
 * したがって上の毒フックは**ホストでは無意味**で、
 * 4 通りのビルドが全部同じチェックサムを出す（**実際にそうなった**）。
 *
 * `SAAN_PIE_EMU=1` は、スカラ枝を **PIE と同じ `cinp` レーン**まで回す。
 * これで毒フックがホストでも効き、QEMU を待たずに検査できる。
 * ⚠️ **本番では 0。** 無駄なレーンを回すぶん遅くなるだけ。 */
#ifndef SAAN_PIE_EMU
#define SAAN_PIE_EMU 0
#endif

#define SAAN_PAD_FILL_W (SAAN_PAD_POISON_W ? 127 : 0)
#define SAAN_PAD_FILL_A (SAAN_PAD_POISON_A ? 127 : 0)

/* --- int8 conv 重みのレイアウト（blob v2。S4）------------------------------------
 *
 * `[cout][ksz][cinp]`、cinp = SAAN_W_STRIDE(cin)。`[cin, cinp)` は 0（exporter が埋める）。
 * これで `W + (o*ksz + k)*cinp` が常に 16 B 境界で、PIE の `ee.vld.128.ip` に**直接**渡せる。
 * 以前は実行時に `[cout][cin][k]` からスタックの `wt` へ転置コピーしていた（1 step に 489 KB。M-80）。
 * ⚠️ cin == 1（depthwise）はバイト列が `[ch][k]` と同一なので padding しない（ストライド 1）。
 * ⚠️ **exporter（scripts/export_c_weights.py の pack_conv_v2）と同じ規則。** 片方だけ変えると
 *    黙って別物の音が出る。int8_test の 2c がバイト単位で突き合わせる。 */
#define SAAN_W_STRIDE(cin) ((cin) == 1 ? 1 : (int)(((unsigned)(cin) + 15u) & ~15u))

/* `[cout][cin][k]`（saan_quantize_w_i8 の出力。inner = cin*k）→ v2 の `[cout][k][cinp]`。
 * padding は SAAN_PAD_FILL_W（本番 0。毒テストは 127）。**テストと毒テスト専用** —
 * 本番の blob は exporter が同じ配置で書いてくる。 */
void   saan_pack_w_i8(int8_t *dst, const int8_t *q, int cout, int cin, int ksz);
size_t saan_packed_w_bytes(int cout, int cin, int ksz);

/* --- 量子化 -------------------------------------------------------------- */

/* float → 最近接整数（ties-to-even）を int32 で返す。
 *
 * ⚠️ **S2**: 活性化の量子化は要素ごとにこれを呼ぶ（1 step に約 51,000 回。M-80）。
 *    `rintf()` は newlib の関数呼び出しで、Xtensa の FPU には `ROUND.S`（丸めモード 0 =
 *    round-to-nearest-even）が 1 命令である。ホストでは `rintf` のまま（結果は同じ規則）。
 *    ESP32 / ESP32-S3 の gcc は `__XCHAL_HAVE_FP` を定義する。
 * ⚠️ **static inline でヘッダに置く。** 外部関数にすると `-mlongcalls` で要素ごとに
 *    `callx8` が残り、`rintf` の呼び出しを消した意味が無くなる（逆アセンブルで実際に見た）。
 * ⚠️ **同じ丸め規則であることは QEMU で確認する**（esp32/pie_probe の C 節。
 *    0.5 / 1.5 / 2.5 / -0.5 … のタイを両方に通して一致を見る）。 */
static inline int32_t saan_rint_i32(float v) {
#if defined(__XTENSA__) && defined(__XCHAL_HAVE_FP) && __XCHAL_HAVE_FP
    int32_t r;
    __asm__("round.s %0, %1, 0" : "=a"(r) : "f"(v));
    return r;
#else
    return (int32_t)rintf(v);
#endif
}

/* symmetric int8 / per-output-channel。`W` は [cout][inner] 行優先
 * （conv なら inner = cin*ksz）。**丸めは rintf = half-to-even**
 * （PyTorch の torch.round と同じ。roundf は half-away-from-zero で食い違う） */
void saan_quantize_w_i8(int8_t *q, float *scale, const float *W,
                        int cout, int inner);

/* activation を **per-frame**（時刻 t ごとに全チャネル共通の scale）で int8 に。
 * 入力 `x` は [C][T]、出力 `q` は **[T][C]（転置）**、`sx` は [T]。
 * 全チャネルが 0 のフレームは sx[t] = 0 / q = 0 になる。 */
void saan_quantize_act_i8(int8_t *q, float *sx, const float *x, int C, int T);

/* 同上だが **行ストライドを `P` にする**（`P >= C`）。`[C, P)` は**毎フレーム 0 で埋める**。
 * PIE の `ee.vld.128.ip` が 16 バイト境界を要求するため、`P = align16(C)` にして
 * `q + t*P` を常に整列させるのが目的。0 は積和に寄与しないので端数処理も要らない。
 * ⚠️ **`P` を渡す側と読む側でストライドが食い違うと黙って別物になる。** */
void saan_quantize_act_i8p(int8_t *q, float *sx, const float *x, int C, int T,
                           int P);

/* 同上だが **フレーム [u0, u1) だけ**量子化する（S9 / T2）。範囲外の `q` の行と `sx` は触らない
 * （呼び出し側はその行を読まない）。per-frame なので、量子化するフレームを絞っても各フレームの
 * scale と int8 値は [0, T) 版と同じ。`saan_quantize_act_i8p` は (0, T) のラッパ */
void saan_quantize_act_i8pr(int8_t *q, float *sx, const float *x, int C, int T,
                            int P, int u0, int u1);

/* W8A8 の作業領域バイト数（q [T][C] + sx [T]） */
size_t saan_act_scratch_bytes(int C, int T);

/* --- W8A32（重みだけ int8、activation は fp32） -------------------------- */

/* `saan_conv1d` と同じ意味論（両端ゼロパディング、y[o,t] = b[o] + Σ W·x）。
 * `W` は **v2 レイアウト [cout][ksz][SAAN_W_STRIDE(cin)]** の int8、`scale` は [cout] の fp32、
 * `b` は fp32 か NULL。積和の順序（i 外側 / k 内側 / t 最内）は v1 と同じ = **出力は bit 同一**。
 * 積和は int8 を float に上げて溜め、**最後に一度だけ scale[o] を掛ける**
 * （per-output-channel なので出力チャネル内では定数）。 */
void saan_conv1d_i8(float *y, const float *x, const int8_t *W, const float *scale,
                    const float *b, int cin, int cout, int ksz, int T);

/* depthwise。`saan_dwconv1d` と同じく **bias 無し**。W は [ch][1][ksz] */
void saan_dwconv1d_i8(float *y, const float *x, const int8_t *W, const float *scale,
                      int ch, int ksz, int T);

/* 出力範囲つき（S9 / T2）。出力の時刻 [t0, t1) だけを計算し、y は **圧縮した [cout][t1 - t0]**。
 * 積和の順序は [0, T) 版と同じ（最内ループの上下限を交わすだけ）= bit 同一。
 * 上の 2 つは (0, T) のラッパ。規則は saanotts_internal.h の saan_conv1d_r と同じ */
void saan_conv1d_i8_r(float *y, const float *x, const int8_t *W, const float *scale,
                      const float *b, int cin, int cout, int ksz, int T, int t0, int t1);
void saan_dwconv1d_i8_r(float *y, const float *x, const int8_t *W, const float *scale,
                        int ch, int ksz, int T, int t0, int t1);

/* --- W8A8（activation も int8、int32 で積和） ---------------------------- */

/* `W` は **v2 レイアウト [cout][ksz][SAAN_W_STRIDE(cin)]**（上記）。PIE は `W` を直接読むので
 * **`W` は 16 B 境界**であること（blob のテンソル offset は全部 16 の倍数。テストは aligned(16)）。
 * 整列していなければスカラ経路に落ちる（結果は同じ。遅いだけ）。
 * `qx` は [T][cinp] の int8、`sx` は [T] の fp32。呼び出し側が確保する
 * （`saan_act_scratch_bytes(cin, T)`）。内部で `saan_quantize_act_i8p` を呼ぶ。
 * 積和は **タップ k ごとに int32** で溜め（同一フレームなので scale が共通）、
 * フレームをまたぐ合成だけ fp32 で行う。cin ≤ 304 なので
 * 304 · 127 · 127 = 4.9e6 で int32 は溢れない。 */
void saan_conv1d_i8a(float *y, const float *x, const int8_t *W, const float *scale,
                     const float *b, int cin, int cout, int ksz, int T,
                     int8_t *qx, float *sx);

void saan_dwconv1d_i8a(float *y, const float *x, const int8_t *W, const float *scale,
                       int ch, int ksz, int T, int8_t *qx, float *sx);

/* 出力範囲つき（S9 / T2）。y は圧縮 [cout][t1 - t0]。活性化の量子化は出力が参照する
 * フレーム [t0 − pad, t1 + pad) ∩ [0, T) だけ（per-frame なので値は同じ）。`qx` / `sx` は
 * 従来どおり [T] ぶん確保すること（範囲外の行は触らないが添字は絶対時刻のまま）。
 * 上の 2 つは (0, T) のラッパ */
void saan_conv1d_i8a_r(float *y, const float *x, const int8_t *W, const float *scale,
                       const float *b, int cin, int cout, int ksz, int T, int t0, int t1,
                       int8_t *qx, float *sx);
void saan_dwconv1d_i8a_r(float *y, const float *x, const int8_t *W, const float *scale,
                         int ch, int ksz, int T, int t0, int t1, int8_t *qx, float *sx);

/* --- 測定用（S5b）-------------------------------------------------------
 *
 * `saan_conv1d_i8a_r` は ESP32-S3 では **weight-stationary**（重み行を q レジスタに
 * 常駐させ、o → k → t で回す。S5b）。その前の形は「dot ごとに重み行を丸ごと
 * ロードし直す」もので、これがその dot 1 個ぶん。
 * **本番でも cinp > 96（dec の pw2 = 304）では今もこちらが呼ばれる。**
 * `esp32/pie_probe` の D 節が、これで旧い形のループを組み直して cyc/dot を比べる。
 * ⚠️ ホストや PIE 無効のビルドには**存在しない**。 */
#if defined(__XTENSA__) && defined(SAAN_PIE) && SAAN_PIE
int32_t saan_dot_i8_pie(const int8_t *a, const int8_t *b, int n);
#endif

/* --- ブロブから int8 テンソルを引く -------------------------------------- */

/* `fmt` で名前を組み立てて int8 テンソル（dtype 1）と、
 * `<name>.scale`（dtype 2）を同時に引く。どちらか無ければ NULL を返す。 */
const int8_t *saan_ti8(const saan_weights *w, const float **scale,
                       const char *fmt, ...);

#endif /* SAANOTTS_INT8_H */
