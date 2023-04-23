# TTS（音声合成）の自動生成用コマンドの説明

日本語 | [English](./README.md)

## generate-speech-google  （[Google Test-to-Speech](https://cloud.google.com/text-to-speech)用）

* 利用準備  
    まず Googleアカウント が必要です、無い場合は作成してください  
    Google[認証のスタートガイド](https://cloud.google.com/docs/authentication/getting-started)を参照しプロジェクト、サービスアカウントを作成してキーをJSON形式で作成・取得します、また検索バーで「Cloud Text-to-Speech API」を検索して開き有効にします  
    取得したキーファイルは stack-chan\firmware\scripts ディレクトリにコピーしてファイル名を key.json に変更します  
    利用料は月当たり100万文字の読み上げまでは無料、それ以上利用すると100万文字を超えるたびに$16となりますが新規利用で無料クレジット$300分が付与される様です  
    詳細は[Text-to-Speechのドキュメント](https://cloud.google.com/text-to-speech)を参照願います
* generate-speech-google の独自オプション  
  * --voicename  読み上げ音声の指定  
     デフォルトはja-JP-Wavenet-A（日本語）または en-US-Wavenet-F（英語）となります  
     通常は日本語で読み上げた音声ファイルを生成しますが入力ファイル名の拡張子を除いたファイル名末尾が"_en" の場合 もしくは--langオプションでENを指定した場合には英語となります  
     パラメータname及びlanguageCode（nameょり生成）に相当します  
  * --sample サンプリングレート  
    デフォルト 44100(44.1KHz)  ただし  pitch-shift.js によるピッチシフトを行う場合は最終的な出力ファイルのサンプリングレートは常に44.1Khzになります
    パラメータ sampleRateHertz に相当します
  * --speed 読み上げスピード  
    デフォルト 0　パラメータspeakingRateに相当します
  * --pitch GoogleTTSによるピッチシフト  
    デフォルト 0　パラメータpitchに相当します  
    （読み上げ音声によってはかすれたり効果があまりない場合があります）
  * --lang デフォルト読み上げ音声のJAまたはENの切り替え  
    通常入力ファイル名の拡張子を除いたファイル名末尾によりJAまたはENが識別されますが英語の入力ファイルを意図的に日本語で読み上げさせたい場合等に利用します
  * --shift  pitch-shift.js によるピッチシフト  
    0.5(1オクターブ下げる) ～ 2(1オクターブ上げる)　 1でノーマル(GoogleTTSの出力そのまま)となります  
    省略時は入力ファイルの SynthProps.shift の値となりますがそちらも未定義の場合は1.5となります  
    なおこちらのピッチシフトが有効の場合は出力ファイルのサンプリングレートはGoogleTTSの設定に関わらず常に44.1KHzとなります
* 共通オプション  
  * --input 入力ファイル名  
    省略時はカレントディレクトリに speeches.js がある場合はそちらになります  
    無い場合は ./stackchan/assets/sounds/speeches_ja.js となります（～stack-chan/firmware ディレクトリでの実行を想定）
  * --output 出力ディレクトリ  
    省略時は入力ファイルのあるディレクトリの配下に assets ディレクトリがある場合はそちらになります  
    assets ディレクトリがない場合は入力ファイルと同じディレクトリになります
  
* 実行例  
    `～/stack-chan/firmware$ npm run generate-speech-google -- --input=./mods/monologue/speeches_monologue.js --output=./mods/monologue/assets`
    ※オプションを指定する場合はコマンドの後に上記のように ' -- ' をつけてください

## generate-speech-coqui  （[CoquiTTS](https://github.com/coqui-ai/TTS#readme)用）

* 利用準備  
  CoquiTTSをインストールしてTTS-Serverを起動する必要があります  
   [インストール方法](https://github.com/coqui-ai/TTS#install-tts) を参考にインストールを行います Pythonのモジュールになっているのでインストールは `pip install TTS` で行えますが Windowsではうまくインストールできない様ですので windowsで音声ファイルを生成する場合は他のLinux環境等で立ち上げたTTSーServerをネットワーク経由で利用して音声ファイルを作成することになります  
  インストールが完了したら下記を実行してTTS-Serverを立ち上げます  
  `$ tts-server --port 8080 --model_name tts_models/ja/kokoro/tacotron2-DDC`
* generate-speech-coqui の独自オプション  
  * --host TTS-Serverの動いているホストのホスト名またはIPアドレス  
    通常 stackchan/manifest_local.json から読み込みますがこちらを指定した場合はこちらが優先されます どちらかで指定が必要です
  * --port TTS-Serverのポート  
    通常 stackchan/manifest_local.json から読み込みますがこちらを指定した場合はこちらが優先されます どちらかで指定が必要です
  * --shift  pitch-shift.js によるピッチシフト  
    0.5(1オクターブ下げる) ～ 2(1オクターブ上げる)　 1でノーマル(CoquiTTSの出力そのまま)となります  
    省略時は入力ファイルの SynthProps.shift の値となりますがそちらも未定義の場合は1.5となります  
    なおこちらのピッチシフトが有効の場合は出力ファイルのサンプリングレートは44.1KHzになります(CoquiTTS自体は22.05KHｚで出力)
* 共通オプション
  * --input 入力ファイル名  
    省略時はカレントディレクトリに speeches.js がある場合はそちらになります  
    無い場合は ./stackchan/assets/sounds/speeches_ja.js となります（～stack-chan/firmware ディレクトリでの実行を想定）
  * --output 出力ディレクトリ  
    省略時は入力ファイルのあるディレクトリの配下に assets ディレクトリがある場合はそちらになります  
     assets ディレクトリがない場合は入力ファイルと同じディレクトリになります

* 実行例  
    `～/stack-chan/firmware$ npm run generate-speech-coqui -- --input=./mods/monologue/speeches_monologue.js --output=./mods/monologue/assets`
    ※オプションを指定する場合はコマンドの後に上記のように ' -- ' をつけてください

## generate-speech-voicevox  （[VOICEVOX](https://voicevox.hiroshiba.jp/)用）

* 利用準備  
    [VOICEVOXのWebサイト](https://voicevox.hiroshiba.jp/)よりダウンロードしてインストールします （Windws/MAC/Linux版があります）  
    インストールが完了したらVOICEVOXを起動した状態にします（同時に立ち上がっているエンジンを利用します、[コマンドラインからエンジンのみ起動する方法](https://qiita.com/yamanohappa/items/b75d069e3cb0708d8709)もあるようです）
* generate-speech-voicevoxの独自オプション  
  * --list キャラクタ一覧出力  
    値なしの場合は全キャラクターの一覧を出して終了します  
    SpeakerIdが指定された場合はそのIdの物のみ表示します  
    --speaker オプションでキャラクタを指定する場合はここで表示される SpeakerId で指定します  
  * --host VOICEVOXエンジンのホスト名またはIPアドレス  
    省略時はVOICEVOXを普通に起動した場合の 127.0.0.1 となります
  * --port VOICEVOXエンジンのポート番号  
    省略時はVOICEVOXを普通に起動した場合の 50021 となります  
  * --speaker キャラクタの指定  
    発声させたいキャラクタの SpeakerId を指定します  
    省略時は SpeakerId:1 ずんだもん(あまあま)  となります  
  * --speed 話速  
    話す速さを指定します 0.5 ～ 2　省略時のデフォルトは 1
  * --pitch 音高  
  　音声の高さを上げ下げします -0.15 ～ 0.15　省略時のデフォルトは  0  
  * --intonation 抑揚  
    音声のイントネーションの強弱の指定です 0 ～ 2　省略時のデフォルトは 1  
  * --sample サンプリングレート  
    出力時の音声ファイルのサンプリングレートです 　省略時のデフォルトは 11025（11.025KHz）  
* 共通オプション
  * --input 入力ファイル名  
    省略時はカレントディレクトリに speeches.js がある場合はそちらになります  
    無い場合は ./stackchan/assets/sounds/speeches_ja.js となります（～stack-chan/firmware ディレクトリでの実行を想定）
  * --output 出力ディレクトリ  
    省略時は入力ファイルのあるディレクトリの配下に assets ディレクトリがある場合はそちらになります  
     assets ディレクトリがない場合は入力ファイルと同じディレクトリになります  
* 実行例
     ～/stack-chan/firmware$ npm run generate-speech-voicevox -- --input=./mods/monologue/speeches_monologue.js --output=./mods/monologue/assets
      ※オプションを指定する場合はコマンドの後に上記のように ' -- ' をつけてください  

## ライセンスについて

VOICEVOX及び音声ライブラリ毎に利用規約がありますので確認して利用願います。

* VOICEVOX：利用の際はVOICEVOX を利用したことがわかるクレジット表記が必要です。  
  たとえば「ずんだもん」の音声をアプリに埋め込んで配布をする場合、アプリの紹介画面に「VOICEVOX:ずんだもん」の記載が必要となります。（[ずんだもん音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)）
  利用規約の詳細は使用する音声ライブラリによって異なりますので[VICEVOXのサイトのキャラクター一覧](https://voicevox.hiroshiba.jp/#characters) より確認願います。
  