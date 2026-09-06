# 音声再生の所有と終了

F2 / F3 / F4の音声出力の共通処理。[AppSessionの再生操作](app-audio-lifecycle.md)と[WASM出力bridgeの停止確認](wasm-playback-lifecycle.md)もこの処理へ接続している。会話・USB・Web Radioとの調停は引き続き残る。

## 完了の意味

`tts-playback-session`が各プロバイダーの状態を所有する。`PlaybackProvider`はTTSとSpeakerで共通の状態・closeを提供する。

Moddableのpreloadで変更可能なWeakMapまで凍結されないよう、所有状態はVMの実行時に初めて生成する。XS試験でも共有モジュールをpreloadしてこの条件を検証する。

1. 開始時に所有者の終了・解放失敗・実行中を検査する。
2. 成功・失敗・取消しを受け取ると、その操作の以降の通知を抑える。
3. コンストラクターとnative callbackから戻ったPromise jobで終了処理を始める。
4. 取得と逆順に解放する。非同期のデータ送信側を閉じ終えてから、その出力を解放する。例外が発生しても残りの解放を試みる。
5. 準備やレンダラーの継続処理も終了してから、streamingをfalseにし、onDone・完了callbackを一度だけ通知する。

`waitFor`で登録する継続処理は、完了を保留する。その継続処理を取り消すためのcleanup自体を待ち行列で塞がない。WASMの音声合成はTimerを取り消し、レンダラーも決着するまで所有する。

取消しの結果は操作側へ通知する。`cancelPlayback` / `close`の戻り値と`released`は解放を待ち、物理的な解放失敗でrejectする。表示用onPlayed / onDoneの例外は操作を失敗にするが、正常に解放できた装置を故障扱いにはしない。

解放失敗は所有者に保持する。RuntimeAudioもその失敗を共通の出力キューへ伝え、別のTTS・素材・Speakerを同じ出力へ渡さない。close後のプロバイダーは再利用できない。取消しだけで正常に解放されたプロバイダーは次の操作に使用できる。

## ネットワークTTS

`tts-http-client`は各操作が生成したHTTPクライアントとDNS resolverを所有する。ストリーマーのコンストラクターが途中で失敗した場合も、そこで取得された接続を解放する。closeは冪等で、片方の解放が失敗しても両方の解放を試み、失敗を親の操作へ残す。

確認したModdableの版は`b6e06ba70506a7381ffb28e09e3175bf4e99f305`（9.5.0）。その[HTTPクライアント](https://github.com/Moddable-OpenSource/moddable/blob/b6e06ba70506a7381ffb28e09e3175bf4e99f305/examples/io/tcp/httpclient/httpclient.js)はconstructorのローカル変数にDNS resolverを持ち、closeではそれを閉じない。DNSのonResolvedからsocketを生成する経路にもclosed状態の検査がない。再生所有者側でresolverを閉じ、遅れたDNS通知を抑止する。

Remote、VOICEVOX、VOICEVOX Web、OpenAI、ElevenLabsをこの所有処理へ接続した。OpenAI / ElevenLabsの要求内容はSDKの既存アダプターと同じ構成を使い、WAV / MP3ストリーマーへ渡すHTTP接続を所有可能にした。JSONの長さ・部分送信も共通のヘルパーで扱う。

VOICEVOXの準備は`tts-http-query`が担当する。

- 準備の開始から30秒、応答JSONは32 KiBまで。Content-Lengthの申告だけに依存せず、受信量も検査する。
- HTTP・JSON・期限の失敗はErrorとして返す。ネットワークの解放に失敗した場合は、親の再生も解放失敗となる。
- 共有のquery.jsonと発話ごとのflash書き込みを廃止し、操作ごとの上限付きデータへ置き換える。outputSamplingRateはJSONのプロパティとして置換する。
- text・token・speakerをそれぞれURLエンコードする。Webの再生URLのqueryとportを保ち、URLやtokenをtraceへ出さない。
- 取消し後の応答でAudioOutを取得しない。準備要求だけを再生所有者から切り離すことはできない。

この変更で、具体的VOICEVOXクラスの旧getQueryは削除した。V2アプリの入口は`audio.say`。旧コードがgetQueryまたはquery.jsonの副作用へ直接依存している場合は移行が必要となる。

## 検証と限界

- Nodeの純粋な所有試験で100回の完了、非同期解放の順序、再入、解放失敗、遅延通知、準備の取消しを確認する。RuntimeAudioでは故障した出力を別プロバイダーへ渡さないことを確認する。
- XSの`playback-lifecycle`と`stackchan-voice-device`は実Timerと注入したAudioOutを使い、native callback中にcloseしないこと、旧出力の通知が新しい出力を操作しないこと、volume / start / stop / close失敗のrollbackを確認する。
- XSの`http-playback`は実Moddable HTTPクライアントとTimer、注入したDNS / TCPを使う。100回の準備成功・取消し、期限、過大な固定長・chunked応答、遅延DNS、コンストラクター失敗、解放失敗、プロバイダーごとの要求を確認する。
- 実サービスへの課金API呼び出し、実機のI2S・DMA・音質・メモリーは未受入。テスト・ビルドの成功をその代用とはしない。

WASMのSpeaker / TTSも共通所有者とレンダラーの終了待ちを使用し、ブラウザー出力の停止確認、toneの実行確認と出力の利用可否を接続している。AppSessionの公開再生操作も解放を待つ。ネイティブの音声合成器そのものの明示的解放、プロバイダー交換、録音・バッファ再生SDKへの接続は継続する。
