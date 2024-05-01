# Webブラウザを使ったｽﾀｯｸﾁｬﾝの設定変更

[English](./setting-preferences-web.md)

Webブラウザからｽﾀｯｸﾁｬﾝの設定を書き換えることができます。
BLE(Bluetooth Low Engergy)を使って接続するため、事前にWi-Fiの設定をしなくても使えます。

## 前提

* PCやスマートフォンがWeb Bluetooth APIに対応していること

## 手順

* Cボタンを押しながらｽﾀｯｸﾁｬﾝを起動する。タッチパネル搭載のモデル（Core2、CoreS3）はタッチパネルを触りながらｽﾀｯｸﾁｬﾝを起動する
* M5Stackに設定画面が表示される

![設定画面（M5Stack）](./images/web-preference-launch.jpg)

* https://meganetaaan.github.io/stack-chan/web/preference/ を開く

![設定画面（Webブラウザ）](./images/web-preference-top.png)

* 「Connect Stack-chan with BLE」を選択する

![接続画面](./images/web-preference-connect.png)

* 「STK」を選択する

![設定フォーム](./images/web-preference-form.png)

* 設定項目が一覧表示されるので、設定したい項目を編集して「Submit」を選択する
* 「Preference set」という表示が出たら書き込み成功！
