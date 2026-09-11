# M5StackChan のUSB接続調査

利用者が機種をM5StackChanと確認し、再接続と手動ダウンロードモードを実施した状態で調査した。チップはESP32-S3 QFN56 revision v0.2、USB-Serial/JTAGまで識別できる。フラッシュ容量の読取、バックアップ、書き込み、MOD起動、サーボ・音声・無線の実機試験はまだ完了していない。

## 観測

- WindowsのUSB/IP一覧では対象は303a:1001、busid 2-2。WSLでは `/dev/ttyACM0` として現れるが、WindowsがAttachedを表示したままWSLのポートが消える場合がある。
- stack-chan-dockの実行プロセス、該当するsystem/userサービス、対象serial/USBを開いた別プロセスは確認できなかった。DockがUSB制御を奪ったと結論づける証拠はない。
- `usbipd.exe attach --wsl --busid 2-2 --auto-attach` は実行中で、detach後に自動接続する。これは転送の再接続処理として観測したもので、通信断の原因だとは確定していない。
- esptool 5.4.0、115200 baud、`--before no-reset --after no-reset --no-stub --trace flash-id` は、複数のレジスターを読んだ後、MAC用レジスター0x60007044の読取で応答を失った。CLIの情報表示を省き、接続直後にMACを読む手順でも再現した。
- MAC表示を省いてSPI flash接続を確認する手順でも通信が途切れ、フラッシュの接続確認を完了できなかった。MAC表示だけを省けば検証が完了する状態ではない。
- USB/IP自動接続を一時停止・detachしてWindowsのesptool 5.3.1からCOM6を試したが、COM6を開けなかった。この試みではWindowsでの通信が成功するかは比較できていない。自動接続の設定は元へ戻した。

WSLへ再列挙したdevice nodeはroot:dialoutになるため、今回のノードだけを作業ユーザーへ戻している。永続的なグループ変更、Dockサービスの停止、フラッシュ消去、eFuseの変更はしていない。

## 次に確認する条件

Windowsに実際に列挙されたCOMポートでの接続、USB/IPの転送を介さない経路、または別ポート／ケーブルで安定した識別と読取りを確保する。その後、現状のフラッシュをバックアップし、M5StackChan用ホストの書き込みと実機受入へ進む。接続エラーをソフトウェア試験の成功で埋めない。

ダウンロードモードと端子の手順は [M5Stack公式資料](https://docs.m5stack.com/ja/StackChan)、通信診断は [Espressifのトラブルシューティング](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/troubleshooting.html) を参照する。
