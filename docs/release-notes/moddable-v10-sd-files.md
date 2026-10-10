# SD Files on Moddable v10

Release impact: patch

M5StackChan CoreS3のSD MOD読出しをModdable標準Files/FAT/SDSPIへ移行しました。
MOD名の制限、partitionサイズ上限、XS archive互換検証、flash書込み後の検証を保持しています。
SD未挿入時の起動を維持するため遅延マウントを使い、マウント失敗時にカードをフォーマットしません。
GPIO35のLCD DC/SD MISO切替だけをボード固有処理として残します。

音声保存UIやカードのhot swap保証は追加していません。詳細と非破壊の検証手順は
`firmware/docs/sd-files.md` を参照してください。実機SD/LCDの検証は別途必要です。
