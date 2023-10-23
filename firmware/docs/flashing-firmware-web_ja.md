# Webブラウザを使ったプログラムのビルドと書き込み

[English](./flashing-firmware-web.md)

Webブラウザからｽﾀｯｸﾁｬﾝファームウェアを書き込むことができます。
Moddableなどの環境構築が不要なので気軽に試せます。

## 前提

* M5StackのUSBドライバがインストールされていること
* PCがWeb Serial APIに対応していること

## 手順

* PCにM5Stackを接続します
* https://meganetaaan.github.io/stack-chan/web/flash/ にアクセスします

![書き込み画面](./images/web-flash-top.png)

* セレクトボックスでM5Stackの種類を選択（M5Stack、M5Stack Fire、M5Stack Core2、M5Stack CoreS3）します
* 「Flash Stack-chan firmware」を選択します

![接続画面](./images/web-flash-connect.png)

* ｽﾀｯｸﾁｬﾝのシリアルポート（ttyUSB0やttyACM0などと表示されている）を選択

![ダッシュボード](./images/web-flash-dashboard.png)
![確認画面](./images/web-flash-confirm.png)

* 「INSTALL STACK-CHAN」→「INSTALL」を選択
* 2~3分待つ

![書き込み中](./images/web-flash-progress.png)

* 書き込み完了！

![書き込み完了](./images/web-flash-complete.png)

## NOTE

工場出荷時の初期設定のため、サーボはSCS0009を使う設定になっています。
他の種類のサーボを使いたい場合は「[ブラウザからｽﾀｯｸﾁｬﾝの設定を変更する](setting-preferences-web_ja.md)」を参照してください。
