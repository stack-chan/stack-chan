/* 一括版とストリーミング版で共有する内部カーネル。
 *
 * ⚠️ **公開 API ではない。** `saanotts.h` を使うこと。
 * ここを共有するのは「同じカーネルを 2 回書かない」ため —
 * 2 つ書くと bit 一致（D-029 の G2）が構造的に守れなくなる。
 */
#ifndef SAANOTTS_INTERNAL_H
#define SAANOTTS_INTERNAL_H

#include "saanotts.h"

/* --- プラットフォームの注入点（T5-G2）--------------------------------------------------
 *
 * コアは移植可能 C99 のまま（依存は libm のみ）。配置属性だけを外から受ける:
 *   -DSAAN_PORT_HEADER='"saan_port_esp32.h"' を渡すと、そのヘッダをここで include する。
 *   ESP32 は esp32/components/saanotts_core/saan_port_esp32.h が esp_attr.h を include し、
 *   SAAN_HOT_DATA → DRAM_ATTR（内部 DRAM）/ SAAN_HOT_CODE → IRAM_ATTR に定義する。
 * ホスト（csrc/Makefile、CI、scripts/check_esp32_template.sh、esp32/pie_probe）は未定義 →
 * 空に展開されて**コードは 1 バイトも変わらない**。
 *
 * 使う先: erf 表（csrc/erf_table.h、129 節点 × 2 = 1,032 B）に SAAN_HOT_DATA。flash の .rodata に
 * あると、1 step に 584 KB 流れる重みのストリームと D-cache を争う（M-82 §4 / maps [2]）。
 * SAAN_HOT_CODE は**今は使っていない**（定義だけ置く。IRAM は M5 構成で余裕を測ってから）。
 * ⚠️ 配置を変えても値は変わらないので bit 同一（QEMU の checksum で確認。T5 の手順）。 */
#ifdef SAAN_PORT_HEADER
#include SAAN_PORT_HEADER
#endif
#ifndef SAAN_HOT_DATA
#define SAAN_HOT_DATA
#endif
#ifndef SAAN_HOT_CODE
#define SAAN_HOT_CODE
#endif

/* ⚠️ `M_PI` は **C99 標準ではない**（POSIX 拡張）。macOS の clang では
 * `-std=c99` でも見えるが、**xtensa-esp32s3-elf の newlib では見えない**。
 * 実際に ESP32-S3 向けにクロスコンパイルして初めて出た（M-54）:
 *
 *     csrc/saanotts.c:395: error: 'M_PI' undeclared
 *
 * `-std=gnu99` にすれば通るが、それでは「依存は libm のみの C99」という
 * 本コアの主張が嘘になるので、**ここで定義する**。 */
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define SAAN_ALIGN16(x) (((x) + 15u) & ~(size_t)15u)

/* ホットな小関数を呼び出し側に展開する（T5-G1）。C99 の `inline` はヒントなので GCC には
 * always_inline も付ける。動機は Xtensa の呼び出し規約: FP レジスタが全部 caller-saved なので、
 * 要素ごとの call8 の往復で FP 定数（13 個）を毎回 l32r + wfr で再ロードし、引数と戻り値も
 * wfr / rfr とスタック経由で往復していた（M-82 の GELU 118 cyc/要素の主因。maps [2]）。
 * ⚠️ 式は 1 文字も変えない。IDF（gnu17、-ffp-contract=fast）が展開後に madd.s への縮約を
 *    変えると丸め水準で動きうる → QEMU の checksum で判定する（T5 の手順） */
#if defined(__GNUC__)
#define SAAN_INLINE static inline __attribute__((always_inline))
#else
#define SAAN_INLINE static inline
#endif

void *saan_alloc(saan_arena *a, size_t n);

/* y[o,t] = b[o] + Σ_i Σ_k W[o,i,k] · x[i, t+k-pad]。**両端ゼロパディング** */
void saan_conv1d(float *y, const float *x, const float *W, const float *b,
                 int cin, int cout, int ksz, int T);

/* --- 出力範囲つき（S9 / T2）-----------------------------------------------------------
 *
 * 同じ conv を **出力の時刻 [t0, t1) だけ**計算する版。x は従来どおり [cin][T]（両端ゼロパディング）、
 * **y は圧縮した [cout][t1 - t0]**（y[o*(t1-t0) + (t - t0)] = 従来の y[o*T + t]）。
 * ストリーミングは窓 W（= 2·pad + CH）に conv を掛けて中央 CH しか下流へ渡さないので、
 * 捨てられる列（AC の 8/16、DEC の 6/14、TOKEN の (6n−84)/6n）を計算しないためのもの。
 *
 * ⚠️ **bit 同一の根拠**: 出力要素 (o, t) ごとの積和の順序（bias → i 外側 → k 内側、
 *    ゼロ重みの枝刈り、パディングの判定）は [0, T) 版と 1 つも変わらない。
 *    範囲は最内ループの上下限を [t0, t1) と交わすだけで、要素の中の順序には触れない。
 *    W8A8 の活性化量子化は per-frame（時刻ごとに独立）なので、[t0−pad, t1+pad) ∩ [0, T) の
 *    フレームだけ量子化しても各フレームの scale と int8 値は同じ。
 * ⚠️ **LayerNorm / GELU / ReLU に範囲版は要らない。** 出力が圧縮されているので、下流の
 *    要素演算はその圧縮バッファ全体（= 必要な範囲ちょうど）に従来の関数をそのまま掛ける。
 * ⚠️ 従来の `saan_conv1d(...)` は `saan_conv1d_r(..., 0, T)` の薄いラッパ（2 回書かない）。
 *    fp32 ゴールデン経路も一括版 `saan_synthesize` もこの関数を [0, T) で通る。 */
void saan_conv1d_r(float *y, const float *x, const float *W, const float *b,
                   int cin, int cout, int ksz, int T, int t0, int t1);

/* 左右のコンテキストを外から与える版。`left`/`right` は [cin * pad]
 * （NULL ならゼロ = 発話の端）。**これが bit 一致の要**:
 * 一括版の「両端ゼロパディング」を、チャンク境界では実データで置き換える。
 * 内部で x を [cin][pad + T + pad] に展開してから既存カーネルを呼ぶので、
 * **積和の順序が一括版と同一**になる（float の加算は非結合なので順序が命）。 */
void saan_conv1d_ctx(float *y, const float *x, const float *left,
                     const float *right, const float *W, const float *b,
                     int cin, int cout, int ksz, int T, float *scratch);

void saan_dwconv1d(float *y, const float *x, const float *W, int ch, int ksz, int T);
/* depthwise の出力範囲つき版（y は圧縮 [ch][t1 - t0]。上の saan_conv1d_r と同じ規則） */
void saan_dwconv1d_r(float *y, const float *x, const float *W, int ch, int ksz, int T,
                     int t0, int t1);
void saan_dwconv1d_ctx(float *y, const float *x, const float *left,
                       const float *right, const float *W,
                       int ch, int ksz, int T, float *scratch);

void saan_layernorm_c(float *x, const float *g, const float *b, int C, int T);
void saan_relu(float *x, size_t n);
void saan_gelu(float *x, size_t n);

/* erf の近似（S3）。x ∈ [0, 4] を h = 1/32 の 3 次 Hermite（csrc/erf_table.h）、|x| ≥ 4 は ±1。
 * libm の erff との max|Δ| は 2e-7 以下（`make -C csrc erf`。線形補間に落とした陽性対照つき）。
 * ⚠️ **これは erf_test.c 向けの外部ラッパ**（T5-G1）。本番の saan_gelu は saanotts.c 内の
 *    インライン版 saan_erf_approx_inl() を直接展開する（同じ本体。2 回書いていない）。
 * ⚠️ **丸め水準の変更。** これを入れた時点で fp32 / W8A32 / W8A8 すべての出力 checksum が
 *    変わる（GELU が全経路で使われる）。新しい基準値は docs/measurements.md の M-81。 */
float saan_erf_approx(float x);

const float *saan_tf(const saan_weights *w, const char *fmt, ...);

/* --- fp32 / int8 のディスパッチ（D-3c'-2） --------------------------------
 *
 * **どちらの経路を通るかは「読み込んだブロブの dtype」だけで決まる**（実行時）。
 * `student.bin` を渡せば fp32、`student_i8.bin` を渡せば int8。
 * 同じバイナリで両方が動くので、fp32 のゴールデンテストは今までどおり通る。
 *
 * ⚠️ **fp32 が無ければ int8、という「フォールバック」にしない。**
 * 名前を打ち間違えたときに黙って NULL になり、その層だけ消えた音声が出る。
 * `saan_w()` はどちらも引けなければ **両方 NULL** を返し、
 * 呼び出し側は `SAAN_W_OK()` で弾いて `SAAN_ERR_MISSING` にすること。
 */
typedef struct {
    const float  *f32;    /* fp32 ブロブのとき。int8 なら NULL */
    const int8_t *q;      /* int8 ブロブのとき。fp32 なら NULL。**v2 レイアウト [cout][k][cinp]** */
    const float  *scale;  /* int8 の per-output-channel scale [cout] */
    int32_t cinp;         /* int8 の行ストライド = SAAN_W_STRIDE(cin)。fp32 なら 0 */
} saan_wref;

#define SAAN_W_OK(r) ((r).f32 != NULL || (r).q != NULL)

saan_wref saan_w(const saan_weights *w, const char *fmt, ...);

/* activation の量子化（W8A8）を使うか。**既定は 0 = W8A32**
 * （重みだけ int8 / activation は fp32）。理由は「W8A8 が危険だから」ではなく
 * 「flash が 1 バイトも減らず、ホストの速度利得も 0.86 倍しかない」から。
 * 実機で足りなければ `-DSAAN_INT8_ACT=1` で切り替える。
 * ⚠️ W8A8 は conv ごとに `[T][cin]` の作業領域を arena から取る。
 * `saan_arena_needed` / `saan_stream_arena_needed` はその分を数えている。 */
#ifndef SAAN_INT8_ACT
#define SAAN_INT8_ACT 0
#endif

/* W8A8 の作業領域（16 B 境界込み）。W8A32 なら 0 を返す */
size_t saan_act_scratch_needed(int cin, int T);

/* `saan_conv1d` / `saan_dwconv1d` と同じ意味論。重みが fp32 なら
 * **まったく同じ関数を呼ぶ**ので bit 一致する。`a` は W8A8 の作業領域用
 * （W8A32 では触らない。NULL 可） */
saan_status saan_conv1d_w(float *y, const float *x, saan_wref W, const float *b,
                          int cin, int cout, int ksz, int T, saan_arena *a);
saan_status saan_dwconv1d_w(float *y, const float *x, saan_wref W,
                            int ch, int ksz, int T, saan_arena *a);

/* 出力範囲つき（S9 / T2）。y は圧縮 [cout][t1 - t0]。fp32 / W8A32 / W8A8 のどの経路でも
 * 対応する `*_r` カーネルを呼ぶ。`saan_conv1d_w(...)` は `saan_conv1d_wr(..., 0, T, a)` のラッパ */
saan_status saan_conv1d_wr(float *y, const float *x, saan_wref W, const float *b,
                           int cin, int cout, int ksz, int T, int t0, int t1,
                           saan_arena *a);
saan_status saan_dwconv1d_wr(float *y, const float *x, saan_wref W,
                             int ch, int ksz, int T, int t0, int t1, saan_arena *a);

/* ⚠️ **失敗すると呼び出し元から return する。** W8A8 の arena 不足を
 * 黙って握りつぶさないため。名前の TRY がその意味 */
#define SAAN_TRY(expr) do { const saan_status s_ = (expr); \
                            if (s_ != SAAN_OK) return s_; } while (0)

/* 一括版とストリーミング版で共有する前段。**2 回書かない**（bit 一致のため） */
saan_status saan_run_duration(const saan_weights *w, saan_arena *a,
                              const int32_t *ids, int T, float *log_d);

/* ⚠️ **ゲート専用の入口**（`make -C csrc dur`）。MEM-7 の窓の取り方を外から壊せる。
 * `saan_run_duration` は `(SAAN_DUR_K, SAAN_DUR_HALO, 1, 1)` でこれを呼ぶだけ。
 *
 * **なぜ要るか。** 窓分割が正しいことを「テストの中に一括版の写しを置いて比べる」形で
 * 示そうとすると**できない** — `h[i] += gm[0] * t2[i]` をコンパイラが FMA に契約するかは
 * 翻訳単位で違い、写しと本番が **1 ulp** ずれる（[C-103](../docs/decisions.md#c-103) で実際に踏んだ）。
 * **同じ関数を違う引数で呼んで比べる**のが唯一空虚でない形である:
 *   - `K` を振って同じ値が出るか（K ≥ T なら 1 窓 = 一括版と同じ形）
 *   - `halo` を 1 減らす / ゼロクリアを外すと**変わる**か（陽性対照）
 * ⚠️ 一括版そのものとの一致は [M-144](../docs/measurements.md#m-144) が
 *    **MEM-7 の前後の PCM checksum** で 1 度だけ証明してある（両レーン / 4 つの長さ）。
 *    一括版のコードはもう存在しないので、以後の不変量は上の 2 つである。
 * ⚠️ `d_fixed`（一括版）や `stage_mask`（`accent_apply`）と同じ扱い = **測定用の引数**。 */
saan_status saan_run_duration_ex(const saan_weights *w, saan_arena *a,
                                 const int32_t *ids, int T, float *log_d,
                                 int K, int halo, int zero_c1, int zero_h);
saan_status saan_run_acoustic_tokens(const saan_weights *w, saan_arena *a,
                                     const int32_t *ids, int L, float *ht);

#endif
