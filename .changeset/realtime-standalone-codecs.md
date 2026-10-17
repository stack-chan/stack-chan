---
"stack-chan": patch
---

Keep Opus enabled in the opt-in CoreS3 WebRTC build and initialize the shared media allocator at startup. Exclude standalone MP3 allocation hooks when the standard WebRTC media library supplies them, avoiding duplicate symbols without changing normal host builds.
