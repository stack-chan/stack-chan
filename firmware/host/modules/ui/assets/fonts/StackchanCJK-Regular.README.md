# StackchanCJK-Regular.ttf

This is a shared build-time subset of Noto Sans CJK SC 2.004 Regular. It contains printable ASCII, the selection mark (●), and the glyphs used by the Japanese, English, and Simplified Chinese host and Podcast catalogs.

- Source: <https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf>
- Source SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`
- Transformation: instantiate `wght=400`, then subset to printable ASCII, ●, and all values in `host/app/strings/{ja,en,zh-CN}.json` and `mods/examples/podcast/strings/{ja,en,zh-CN}.json`
- Copyright: © 2014-2021 Adobe (<http://www.adobe.com/>), with Reserved Font Name “Source”
- License: SIL Open Font License 1.1; see `StackchanCJK-Regular.LICENSE.txt`

The host manifest publishes the bitmap resource as `StackchanCJK-12`, using only the host catalog glyphs. Podcast reuses this TTF source to build a separate `PodcastCJK-12` resource, using only the characters in its `assets/PodcastCJK-chars.txt`. Sharing the build-time font does not add Podcast glyphs to the host bitmap resource. The source font's internal family metadata remains `Noto Sans SC`.
