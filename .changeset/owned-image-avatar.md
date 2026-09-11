---
"stack-chan": major
---

Move the ImageAvatarLite example to the SDK UI extension and host API 6. Select complete image packs with `ui(app).setImageAvatar(pack)`; validate and copy the data, prepare all expressions before replacing the current face, and restore the configured appearance when the app closes. Use SDK emotion names consistently and represent eye and mouth strips with one texture, one frame size and a frame count. Preserve all six characters, twelve expressions and the original licensed images. Remove the global pack registry, named fallback and `ui.avatar` selection. Keep the visual center when replacing faces of different sizes, so a full-screen avatar is not cropped by the previous small face’s origin. Existing packs and MODs using those interfaces must adopt the new data format and rebuild.
