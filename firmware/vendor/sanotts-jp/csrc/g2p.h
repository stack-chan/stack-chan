/* 端末側 G2P: かな中間表現 → 生徒インデックス列（C99 / 依存なし）
 *
 * `scripts/kana_g2p.py` の**端末側 2 関数**（`intermediate_to_tokens` /
 * `intermediate_to_phonemes`）と `scripts/gen_teacher_labels.py` の
 * `encode_intermediate` を C99 に移したもの。ホスト側（OpenJTalk を使う
 * `text_to_intermediate` / `phonemes_to_intermediate` / `normalize_input`）は
 * **移植しない**。
 *
 *   中間表現(UTF-8) ──▶ トークン ──▶ 音素 ──▶ 生徒インデックス + intersperse PAD
 *   "きょ][おわよ..."      きょ ] [ ...    ky o ] [ ...   1 0 26 0 14 0 9 0 ...
 *
 * 出力はそのまま `saan_synthesize()` / `saan_stream_init()` に渡せる形（`^` + PAD で
 * 始まり `$` で終わる）。**生徒インデックス 0..56 であって教師の音素ID ではない**
 * （D-016 / `src/saanotts_jp/vocab.py`）。
 *
 * 設計方針は推論コア（`saanotts.h`）に揃える:
 *   - **malloc しない。** 出力バッファは呼び出し側が渡す
 *   - 作業メモリは 0 B（ローカル変数のみ）。arena も要らない
 *   - libm も使わない（純整数）
 *
 * ⚠️ **テーブルを手書きしないこと。** `csrc/g2p_table.h` は
 *   `kana_g2p.build_mora_table()` から生成する。C++ の PUA マップが Python と
 *   ずれて 54 音素の ID を黙って取り違えた前例がある（C-002）。
 *
 * 検証: `make -C csrc g2p`（自己完結ベクタ）/ `make -C csrc g2p-corpus`（全コーパス）
 */
#ifndef SAAN_G2P_H
#define SAAN_G2P_H

#include <stddef.h>
#include <stdint.h>

typedef enum {
    SAAN_G2P_OK = 0,
    SAAN_G2P_ERR_UTF8     = -1, /* 不正な UTF-8（下記の規約） */
    SAAN_G2P_ERR_UNKNOWN  = -2, /* 妥当な UTF-8 だが中間表現として解釈できない */
    SAAN_G2P_ERR_OVERFLOW = -3, /* ids バッファが足りない */
    SAAN_G2P_ERR_ARG      = -4  /* 引数が不正（NULL / 負の容量） */
} saan_g2p_status;

/* 変換の副産物。**「黙って落ちたもの」を数えるためにある。**
 *
 * ⚠️ Python 側には例外を出さずに入力を捨てる経路が 2 本あり、C が同じように
 * 黙って捨てても**テストは緑のまま**になる。件数を突き合わせるのが唯一の検出手段。
 */
typedef struct {
    int32_t err_byte;           /* 失敗した入力のバイト位置。成功時は -1 */
    int32_t n_phonemes;         /* intersperse 前の音素数（PAD `_` を含む総数 p） */
    int32_t n_pad_phonemes;     /* うち `_` の数 k */
    int32_t n_dropped_long;     /* 直前に平母音が無く、何も出さなかった `ー` */
    int32_t n_dropped_devoice;  /* 無声化母音を生まなかった `°`（`っ°` `ん°` `ー°`） */
} saan_g2p_info;

/* 中間表現 → 生徒インデックス列。
 *
 * `text` / `nbytes` は **NUL 終端を前提にしない**（入力に NUL が混ざっても
 * `nbytes` までを読む）。`ids_cap` に足りなければ `SAAN_G2P_ERR_OVERFLOW` を返し、
 * **`ids[ids_cap]` 以降を 1 バイトも書かない**。
 * `info` は NULL 可。失敗時も `err_byte` は埋める。
 *
 * 空入力 `nbytes == 0` は成功で、`ids = {^, _, $}`（3 個）を書く。
 */
saan_g2p_status saan_g2p(const char *text, size_t nbytes,
                         int32_t *ids, int32_t ids_cap, int32_t *n_ids,
                         saan_g2p_info *info);

/* `nbytes` バイトの入力に必要な `ids_cap` の上限。
 *
 * 最悪ケースは「入力が全部 1 バイトのマーク」で、マーク 1 個 = 音素 1 個 = ids 2 個。
 * したがって `2 * nbytes + 3`（`^` + PAD + ... + `$`）。 */
int32_t saan_g2p_capacity(size_t nbytes);

const char *saan_g2p_strerror(saan_g2p_status s);

/* --- 入力を 1 経路にする（K-B / T11）------------------------------------
 *
 * 端末のプロンプトは「かな中間表現」と「漢字かな交じり文」の両方を受ける。
 * どちらの経路に回すかを**この関数だけ**が決める。
 *
 * ⚠️ **手書きの文字集合で判定しない。** 「ひらがなならかな経路」は凍結テーブルと
 *    ずれる: `ぁぃぇぉゃゅょゎゐゑゕゖ` は**単独ではモーラになれない**（表に無い）し、
 *    `_ ^ $` はひらがなではないがマーク側にある。判定は
 *    **`saan_g2p()` と同じトークナイザ（パス 0 + パス 1）が行末まで通るか**そのもの。
 *
 * 3 値:
 *   KANA   トークン化が最後まで通った            → `saan_g2p()` に渡す
 *   DICT   通らず、行に**マークが 1 つも無い**    → 漢字経路（辞書 + Viterbi）に渡す
 *   REJECT 通らず、行に**マークがある**          → 拒否。位置を見せる
 *
 * ⚠️ **REJECT を残すのが要点。** 「中間表現 + `。`」のような打ち間違いは、
 *    マークを含むのでかな経路には乗らない。これを黙って辞書経路に回すと、
 *    `[` `]` `#` が記号として読み上げられたり落とされたりして
 *    **それらしい音が出てしまう**（気づけない壊れ方）。
 *
 * ⚠️ **不正な UTF-8 も REJECT。** 辞書経路に回すと MeCab の文字種判定が
 *    化けるだけなので、経路を選ぶ前に落とす（`why` に `ERR_UTF8` が入る）。
 *
 * ⚠️ **空入力は KANA。** `saan_g2p("")` が成功する規約に合わせてある。
 *    「空行です」の案内は呼び出し側の仕事。
 *
 * マークの集合は `kSaanG2pMarks` と `°` から導く（**手書きしない**）。
 * ASCII のマーク文字は UTF-8 の多バイト列の中には現れないので、生バイト走査で厳密。
 *
 * `why` / `err_byte` は NULL 可。KANA のとき `*why = SAAN_G2P_OK` / `*err_byte = -1`。
 * DICT / REJECT のときは**トークン化が止まったバイト位置**が入る。
 *
 * ⚠️ ホスト側 `scripts/kana_g2p.py` の `classify_route()` が同じ 3 値を返す。
 *    一致は `uv run python scripts/k1/kb_route_parity.py`（held-out 298 文 +
 *    その中間表現 298 行）で検査する。**片方だけ直すとそこが落ちる。**
 */
typedef enum {
    SAAN_G2P_ROUTE_KANA   = 0,
    SAAN_G2P_ROUTE_DICT   = 1,
    SAAN_G2P_ROUTE_REJECT = 2
} saan_g2p_route;

saan_g2p_route saan_g2p_classify(const char *text, size_t nbytes,
                                 saan_g2p_status *why, int32_t *err_byte);

const char *saan_g2p_route_name(saan_g2p_route r);

/* --- テーブルのドリフト検出 ---------------------------------------------
 *
 * `scripts/gen_g2p_vectors.py` が同じ正準シリアライズから計算した SHA-256 と
 * 突き合わせる。**ベクタが古いのか実装が古いのかを区別できる**ようにするため。
 * 対象は mora テーブル 195 件 + `ん` 異音 21 件 + 生徒語彙 57 件。 */
extern const uint8_t saan_g2p_table_sha256[32];
extern const int32_t saan_g2p_table_entries;   /* == 195 */

#endif /* SAAN_G2P_H */

/* --- 移植上の規約（ここを外すと黙って壊れる）-----------------------------
 *
 * 1. **intersperse PAD**: 先頭に `^`(1) と PAD(0)、各音素の後ろに PAD
 *    （**その音素自身が PAD なら挟まない**）、末尾に `$`(2)。
 *    外すと発話が約 2.4 倍速になるが**例外は出ない**（C-007）。
 *    不変量: `n_ids == 2*p + 3 - k`（p = 総音素数、k = PAD 音素数）。
 *    ⚠️ `n_phonemes` を「PAD 抜き」で数えると `2*(p-k) + 3 + k` になり**符号が逆**。
 *    CLAUDE.md の式は後者の単位（C-019 と同型の罠）。
 *
 * 2. **最長一致**: 2 文字キー → 1 文字キーの順。短一致だと `とぅ` 系 11 件が
 *    **例外なしに別の音素列**になる（`とぅ` → `t o u`）。
 *
 * 3. **`ー` は直前の平母音 `a i u e o` だけを複製する。**
 *    無声化母音 `A I U E O` はマッチせず、走査を止めもしない。
 *    遡って見つからなければ**何も出力せず、例外も出さない**
 *    （`ー` 単独 / `[ー` / `っー` / `んー` / `き°ー`）。
 *
 * 4. **`°` は最後の音素が平母音のときだけ**大文字化する。そうでなければ黙って捨てる
 *    （`っ°` `ん°` `ー°`）。`ー` と `ん` は先に分岐するので `°` は届かない。
 *
 * 5. **`ん` の異音は後続の最初の非マークトークンを生でテーブル引き**して決める。
 *    後続の `ん`/`ー`/`っ` を再帰的に解決しない（生の値 `N_m`/`a`/`cl` を使う）。
 *    マークは何個でも跨ぐ。該当なし・後続なしは `N_uvular`(23)。
 *    ⚠️ テーブルの `ん` → `N_m` は**キャリア法の副産物**。素直に引くと `ん` が
 *    `N_m` 固定になり異音規則が丸ごと死ぬが、**音は出るので気づかない**。
 *
 * 6. **`てぃ` → `ty i` / `でぃ` → `dy i`**（規則生成が実測値を上書きしている）。
 *    直感で `t i` / `d i` と書くと食い違う。
 *
 * 7. `は` `へ` `を` は表音固定（`h a` / `h e` / `o`）。中間表現は表音なので、
 *    助詞の「は」は `わ` と書かれている。
 *
 * --- UTF-8 の扱い（⚠️ Python に対応物が無い。**C 側の設計判断**）-----------
 *
 * Python の `str` は既にデコード済みなので、以下は参照実装との一致では検証できない。
 * ここで決めた規約を `scripts/gen_g2p_vectors.py` が期待値として持つ。
 *
 * - 途中で切れた列 / 単独の継続バイト / オーバーロング符号化 / サロゲート
 *   (U+D800..U+DFFF) / 5 バイト以上のリード / 0xFE 0xFF は `SAAN_G2P_ERR_UTF8`。
 * - **妥当な UTF-8 だが中間表現に無いコードポイント**（漢字・絵文字・NUL・U+301C）は
 *   `SAAN_G2P_ERR_UNKNOWN`。⚠️ ここを UTF8 側に倒すと「不正入力は全部 UTF8 エラー」で
 *   テストが満点を取れてしまう。
 * - `err_byte` は**不正シーケンスの先頭バイト**の位置。
 * - どちらの失敗でも入力バッファの外を読まない（`nbytes` で止める）。
 */
