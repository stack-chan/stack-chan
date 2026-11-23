/* ESP32 向けの配置属性（T5-G2）。
 *
 * csrc/saanotts_internal.h が `-DSAAN_PORT_HEADER='"saan_port_esp32.h"'`（CMakeLists.txt が注入）
 * で include する。**コアは移植可能 C99 のまま**で、ESP-IDF に触るのはこのファイルだけ。
 *
 *   SAAN_HOT_DATA … 内部 DRAM（.dram1.*）。flash の .rodata だと重みのストリームと D-cache を争う。
 *                    今の使い先は erf 表 1,032 B（csrc/erf_table.h）だけ。
 *   SAAN_HOT_CODE … 内部 IRAM（.iram1.*）。**今は使っていない**（定義だけ）。
 *
 * ⚠️ 配置が変わるだけで値は変わらない（bit 同一。QEMU の checksum で確認）。
 * ⚠️ .map で確認すること: kSaanErfV / kSaanErfDh が `.dram1.N` に入っているか
 *    （build ディレクトリの saanotts_jp.map を kSaanErf で grep する）。
 *    ⚠️ コメント内に `*` と `/` を続けて書かない（コメントが閉じる。1 回踏んだ）。 */
#ifndef SAAN_PORT_ESP32_H
#define SAAN_PORT_ESP32_H

#include "esp_attr.h"

#define SAAN_HOT_DATA DRAM_ATTR
#define SAAN_HOT_CODE IRAM_ATTR

#endif /* SAAN_PORT_ESP32_H */
