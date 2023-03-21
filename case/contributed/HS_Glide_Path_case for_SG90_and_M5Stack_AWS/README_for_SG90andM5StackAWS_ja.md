# Stack-chan case for SG90 and M5Stack AWS
日本語 | [English](./README_for_SG90andM5StackAWS.md)

# 注意事項
M5Stackの基板はｽﾀｯｸﾁｬﾝ基板とは寸法が異なるので、ｽﾀｯｸﾁｬﾝ基板はこちらのモデルには使用できません。

# 外観
このモデルは、M5Stack Core2 for AWS - ESP32 IoT 開発キットに合わせ、[既存のケースモデル](../mongonta_case_for_SG90_and_M5GoBottomBoard/case_for_SG90andM5GoBottomBoard/shell_SG90_basicgraybottom.stl)に修正を加えたものです。

材質等も考慮し、全体外観は変更せずフィッティングを重視して現物合わせを行いました。

この度は全面協力いただきました[ホビーショップ・グライドパス](https://hsgp.cart.fc2.com/)様に感謝致します。
今回、ご厚意に甘えSTLファイルを共有いただきましたので、必要に応じてご利用ください。

## 修正点

 * M5Stack本体とケース(ボディ)の隙間をきれいに見せるため、スペーサーを再設計しました。
 * スペーサーをきれいに収める為、1.3㎜ほど四隅にオフセット加工を施しています。
 * ケース(ボディ)は仕上がりの良さとネジなめを抑止する為、3DプリンタではPC材を想定しています。
 * スペーサーはさし色と柔らかさを表現する為にTPU材を想定して設計、角も丸みをつけています。(PLA材の場合1～2%拡大印刷を推奨致します。)
 * コネクタを挿入する上部は少し逃しを設けています。
 * M5Stack Core2 for AWSは左脇にLED透過窓があり、部材を移植してLチカも楽しめます。
 
<img src="./docs/images/case_sg90_m5core2AWS.jpg" width="320">  <img src="./docs/images/LED.jpg" width="320">

<img src="./docs/images/case_sg90_m5core2AWSbody.jpg" width="320"> <img src="./docs/images/case_sg90_m5core2AWSspacer.jpg" width="320">

[case data](./case_for_SG90andM5StackAWS/)はFusion360で作成され、DesignSparkMechanicalで修正しました。


# サーボの挙動に関して
2023年3月現在ホビーショップ・グライドパス様にて、サーボに関する豊富な知識に基づき、ｽﾀｯｸﾁｬﾝに最適なサーボの検証を行っております。

1. 電源問題が解決すれば、MG90Sの方がオススメ。供給方法を再検討？もしくは別途外部バッテリーを増設も考慮…。
2. ドローン界隈の方は慣れているところですが、お約束なリポバッテリー(1S)が利用されている事、増設M5StackバッテリーコネクタがPH2.0だったりも。何か応用できないか？皆さんで考えてみましょうｗ

<img src="./docs/images/tester-core2.gif" width="320">
