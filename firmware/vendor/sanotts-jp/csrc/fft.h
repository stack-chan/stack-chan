/* radix-2 実 IFFT (N = 1024)。`csrc/saanotts.c` の naive DFT の置き換え。
 *
 * 契約は naive 版と完全に同じ:
 *   - 入力 `re` / `im` は 513 bin (= N/2+1)。`im[0]` と `im[512]` は**読まれない**
 *     （DC と Nyquist は実数として扱う。naive 版も同じ）
 *   - 出力 `out` は 1024 サンプル。**1/N 正規化済み**
 *   - bit 一致は保証しない（積和の順序が違うため）。SNR は fft_test.c で検証する
 *
 * 依存は libm のみ（twiddle は定数テーブルなので実行時に libm を呼ばない）。
 * malloc / arena を使わない。作業領域は 512 complex の自動変数（stack）のみ。
 *
 * ビルド時オプション:
 *   -DSAAN_FFT_DOUBLE   内部演算と twiddle を double にする（既定は float）。
 *                       ESP32-S3 は単精度 FPU しか持たないので既定は float。
 *
 * twiddle テーブルの再生成:
 *   uv run python scripts/gen_fft_tables.py csrc/fft.c
 */
#ifndef SAAN_FFT_H
#define SAAN_FFT_H

#ifdef __cplusplus
extern "C" {
#endif

#define SAAN_FFT_N 1024

void saan_irfft_1024(const float *re, const float *im, float *out);

#ifdef __cplusplus
}
#endif

#endif /* SAAN_FFT_H */
