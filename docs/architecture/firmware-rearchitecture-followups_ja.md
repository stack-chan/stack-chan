# ファームウェア再設計の振り返りと改善課題

作成日：2026-06-30

対象：`firmware/host`、`firmware/mods`、Moddable manifest、CI。

この文書は、ファームウェア再設計移行作業で時間がかかった箇所を、今後の設計改善課題として整理する。

移行計画そのものは [firmware-rearchitecture_ja.md](./firmware-rearchitecture_ja.md) で管理する。

## 1. Moddable manifest の glob と Node.js テスト配置

### 起きた問題

`host/app/default-behavior/startup-choice.test.ts` を実装ファイルの近くに置いたところ、app manifest の `app-default-behavior/*` がそのテストファイルを拾った。

その結果、ESP32 build が Node.js 専用の `node:assert/strict`、`node:test`、`node:path`、`node:url` を解決しようとして失敗した。

これは個別の配置ミスではなく、production manifest の解決範囲と Node.js 専用ファイルの所属が機械的に分離されていないことを示している。

### 解決策

production manifest では、公開したい module surface をできるだけ明示列挙する。

`app-default-behavior/*` のような広い glob は、実装の近くに置いた検査用ファイルまで公開面へ混入させる。

`default-behavior` の公開面は小さいため、次のような明示指定に寄せられる。

```json
{
  "modules": {
    "app-default-behavior": "./default-behavior/behavior",
    "app-default-behavior/on-launch": "./default-behavior/on-launch",
    "app-default-behavior/on-context-created": "./default-behavior/on-context-created",
    "app-default-behavior/startup-choice": "./default-behavior/startup-choice"
  }
}
```

Node.js 専用テストは、production manifest の glob 範囲外に置く。

そのうえで、production manifest が `*.test.ts`、`*.architecture.ts`、`__tests__` を解決対象に含んだら失敗する architecture check を追加する。

## 2. テストと構成検査の境界

### 起きた問題

`assert.match(source, ...)` のような検査が unit test に混ざっていた。

この検査は移行漏れや構成制約の確認としては有効だが、振る舞いを検証していない。

unit test に混ざると、実装行の追認を振る舞いテストと誤認しやすい。

### 解決策

`*.test.ts` は、振る舞い、データ構造、公開 API の検証に限定する。

`*.architecture.ts` は、module 配置、import 禁止、manifest 構造、legacy 名禁止、hot path 制約の検査を担当する。

CI では `npm run test:unit` と `npm run check:architecture` を別ステップとして表示する。

この分離により、失敗したときに「振る舞いが壊れた」のか「構成制約に反した」のかを切り分けられる。

## 3. Node.js で Moddable の module 識別子を扱う方法

### 起きた問題

Moddable では manifest の `modules` によって `app-default-behavior/startup-choice` のような module 識別子を解決する。

Node.js の `node:test` で同じ module 識別子を使うには、alias package を手作業で作る必要があった。

相対 path import に逃げると、Moddable manifest と異なる経路でテストすることになる。

### `mcpack` との関係

`mcpack` は package entry から import graph を読み、package の manifest や相対 source をもとに一時 manifest を生成する。

そのため、「人間が Moddable の module map を手で再現する」問題を減らす方向には近い。

ただし、今回必要だったのは Node.js test runner で Moddable manifest の module 識別子を解決する仕組みである。

`mcpack` は Moddable build 用の manifest 生成には向くが、Node.js 用 loader としてそのまま使うものではない。

### 解決策

短期的には、相対 import の使い方を lint で制限する。

同一 component 内の `./types` のような import は許可し、`../..` で別 module へ抜ける import を禁止する。

`mods` ではより厳しく、host 公開 API は manifest module specifier だけを使う。

中期的には、manifest の `modules` 解決を Node.js テスト用 alias に変換する共通ハーネスを作る。

このハーネスは fake `timer`、fake Piu、fake `Modules`、fake `Preference` の注入も標準化する。

## 4. resource と font の整合性検査

### 起きた問題

resource や font は、単純なファイル存在確認だけでは不十分である。

Moddable manifest は include、platform 条件、resources の pseudo target、font の `characterFiles` などを統合して解決する。

自前の JSON 走査だけでは、Moddable が実際に見る結果とずれる可能性がある。

### 解決策

最初の段階では、自前 manifest の `modules`、`resources`、`data` の source 存在確認を行う。

次の段階で、include と platform 条件を統合した manifest に対して検査する。

最終的には、`mcconfig` が生成する `manifest_flat.json` または Moddable の manifest resolver に寄せて検査する。

検査項目は次を想定する。

- module source が存在する。
- resource source が存在する。
- font source が存在する。
- font の `characterFiles` が存在する。
- production manifest に test 用ファイルが混入していない。
- sample MOD が host 公開 module specifier だけを参照している。

## 5. `default-behavior` と MOD の置換規則

### 起きた問題

旧 `default-mods` は名前に `mods` を含むが、実際には利用者が導入する MOD ではなく、製品組み込みの default behavior だった。

この名前と実態のずれが、host と mods の境界を読み取りづらくしていた。

また、default behavior を app behavior として常時追加すると、installed MOD と同時に実行される。

これは従来挙動と異なる。

従来は、MOD が存在する場合は MOD を優先し、製品既定動作は実行しなかった。

### 解決策

`default-behavior` は `firmware/host/app/default-behavior` に置く。

ただし、実行規則は installed MOD の fallback に限定する。

`Modules.has("mod")` が true の場合、host は `mod` だけを import して実行する。

この場合、product default behavior は `onLaunch` も `onContextCreated` も実行しない。

`Modules.has("mod")` が false の場合だけ、host に同梱した product default behavior を実行する。

この規則により、利用者 MOD のボタン割り当てや画面操作を default behavior が上書きしない。

また、`firmware/mods` は利用者向け MOD と sample MOD だけを置く場所として維持できる。

## 6. sample MOD の TypeScript 化

### 起きた問題

sample MOD の API 齟齬は、MOD が JavaScript で書かれており、`StackchanContext` 型で検査されていなかったことが根本原因の一つである。

TypeScript で書けば、存在しない `driver`、`useTTS`、streaming microphone などの呼び出しを早く検出できる。

標準の `npm run mod` は `mcrun` へ MOD manifest を渡す経路である。

Moddable の `mcconfig`、`mcpack`、および ESP32、lin などの make fragment を持つ `mcrun` 経路は TypeScript source を扱える。

WASM host は、lin や esp32 向けに build した MOD の `.xsb` を読み込める。

そのため、WASM host で実行する MOD であっても、MOD 自体の build target を `wasm` にする必要はない。

WASM `mcrun` の `make.json` 経路に TypeScript support を追加することは、この移行の前提にしない。

### 解決策

sample MOD は TypeScript source で書く。

MOD の build は、Moddable の `mcrun` が持つ TypeScript module 経路をそのまま使う。

ローカル確認と CI では、デバイスなしで実行しやすい `lin` target を標準にする。

ESP32 実機へ install する場合は、従来どおり対象 device target を指定する。

stack-chan 側には、TypeScript を generated JavaScript へ事前変換する独自 workflow を持たない。

WASM host での確認では、`lin` などで build した `.xsb` またはそれを含む archive を読み込ませる。

TypeScript 化では、単に拡張子を変えるだけでは不十分である。

sample MOD は `StackchanContext` の公開 capability だけを import し、host 内部 module へ相対 path で依存しないようにする。

不足している機能がある場合は、sample 側の呼び出しを削るか、host の公開 capability として設計してから追加する。

### 確認すべき点

- `lin` target で build した TypeScript MOD の `.xsb` または archive を WASM host が継続して読み込めるか。
- WASM host 用に配布する MOD で、platform 固有の native code や resource 前提が混入していないか。
- source map や xsbug 上の行番号をどう扱うか。
- sample MOD の型チェックを CI の軽量 preflight に含められるか。
- `StackchanContext` 型を利用者 MOD から import できる公開 module specifier にできるか。
- TypeScript source の相対 import が host 内部境界を越えていないことを lint で保証できるか。

## 7. CI と preflight

### 起きた問題

ESP32 build、CoreS3 build、Moddable manifest test、WASM bundle は重い。

失敗が push 後や重い build の後半で見つかると、修正の往復が大きくなる。

実際に、Node.js 専用テストが production manifest に混入した問題は、ESP32 build で初めて見つかった。

### pre-commit

pre-commit では、`biome check --staged --error-on-warnings` を通す。

この検査は format、lint、import 整理、Biome warning の検出に向く。

一方で、TypeScript 型チェック、manifest 解決、resource 解決、ESP32 固有 build 失敗は検出できない。

### `mcconfig` の生成だけを使う preflight

`mcconfig` は `-m` を付けない場合、make を実行しない。

たとえば次のコマンドは、manifest 解決と生成物作成で止まる。

```sh
mcconfig -d -p esp32/m5stack -t build "$PWD/host/app/manifest_local.json"
```

この段階で確認できるものは、manifest parse、include 解決、platform 条件の merge、`modules`、`resources`、`data` の glob 展開、Moddable 用 tsconfig 生成である。

`-m` なしでは `tsc` は実行されない。

Moddable の実装では、`-m` が指定されたときだけ `this.make = true` になり、`make` または `nmake` が実行される。

`tsc -p ...` は生成された makefile の rule として書かれるため、make が走るまで実行されない。

### preflight の候補

CI の build 前に、軽量な manifest preflight を置く。

```sh
mcconfig -d -p esp32/m5stack -t build "$PWD/host/app/manifest_local.json"
mcconfig -d -p esp32/m5stack_cores3 -t build "$PWD/host/app/manifest_local.json"
mcconfig -d -p wasm -t build "$PWD/host/app/manifest_wasm.json"
```

このpreflightでは、Moddable が出す `no modules match` や `no resources match` の warning を分類する。

既知の warning は許可し、許可リスト外の missing module や missing resource は失敗にする。

### 型チェックだけの候補

公式オプションだけでは、manifest 解決後の TypeScript 型チェックだけを実行する方法は見当たらない。

実現するなら、次の手順を独自スクリプトにする。

1. `mcconfig` を `-m` なしで実行する。
2. 生成された `$MODDABLE/build/tmp/.../modules/*-tsconfig.json` を読む。
3. 対象 module の `tsc -p` を実行する。

この方法なら、Moddable が生成した module specifier 解決を使いながら、native build より前に TypeScript error を検出できる。

## 8. bundle workflow

### 起きた問題

bundle は時間がかかる。

PR ごとに実行すると、フィードバックが遅くなる。

### 解決策

本物の bundle は `develop` への merge 後に実行する。

PR では、bundle できる可能性を軽量に保証する preflight を実行する。

軽量 preflight では、bundle manifest の存在、bundle metadata、対象 manifest の解決、resource path の存在、WASM manifest の解決を確認する。

必要であれば、`mcbundle` を `-m` なしで実行し、shell script 生成までを確認する。

`mcbundle` も `-m` を付けた場合に実ビルドへ進むため、PR では生成のみ、merge 後に実ビルドという分担にできる。

## 9. 今後の優先順位

短期の改善は次の順で進める。

1. production manifest の広い glob を明示列挙へ寄せる。(実装済み)
2. production manifest に test 用ファイルが混入しない architecture check を追加する。(実装済み)
3. `mcconfig` 生成だけの `check:manifest` を追加する。(実装済み: `npm run check:manifest`)
4. `check:manifest` で Moddable warning を分類し、未知の missing module と missing resource を失敗扱いにする。(実装済み: `scripts/check-manifest.js` の allowlist)
5. 相対 import の lint を追加し、module 境界を越える相対 import を禁止する。
6. sample MOD の TypeScript 化と公開型 specifier を追加する。
7. 生成済み Moddable tsconfig を使った TypeScript preflight を検討する。

この順序なら、重い build を減らす前に、build でしか見つからなかった問題を軽量検査へ移せる。

## 10. 設計上の結論

今回の作業で見えた課題は、`host` と `mods` の境界だけではない。

各 source file がどの build world に属するかを、manifest と lint で宣言的に保証する必要がある。

具体的には、production firmware、Node.js unit test、architecture check、Moddable manifest test、利用者 MOD、sample MOD を、配置と検査で区別する。

この区別が曖昧なままだと、機能追加時に build 対象の混入、相対 import の漏れ、resource path の不整合が再発する。

再設計後の次の課題は、module の所有権だけでなく、検査対象と build world の所有権も明文化することである。
