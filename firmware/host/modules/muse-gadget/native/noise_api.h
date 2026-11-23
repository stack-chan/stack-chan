#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define MUSE_FRAME_MAX 65535
#define MUSE_BODY_MAX 4096
#define MUSE_SERVICE_MAX (64 * 1024)
typedef struct MuseNoise MuseNoise;
typedef struct {
  int stream;
  int kind; /* 2=response, 3=body, 4=reset */
  int status;
  int end;
  const uint8_t *body; /* borrowed until the next call; XS must copy */
  size_t size;
} MuseFrame;
MuseNoise *muse_noise_new(void);
void muse_noise_delete(MuseNoise *session);
int muse_noise_start(MuseNoise *session, const uint8_t **out);
int muse_noise_handshake(MuseNoise *session, const uint8_t *data, size_t size, const uint8_t **out);
int muse_noise_request(MuseNoise *session, int stream, int route, const uint8_t *body, size_t size);
int muse_noise_tts_request(MuseNoise *session, int stream, const char *message_id, int legacy);
int muse_noise_chunk(MuseNoise *session, const uint8_t *body, size_t size);
int muse_noise_next(MuseNoise *session, const uint8_t **out);
int muse_noise_receive(MuseNoise *session, const uint8_t *data, size_t size, MuseFrame *frame);
int muse_noise_voice_request(MuseNoise *session, int stream, const char *call_id, const uint8_t *body, size_t size);
int muse_noise_end_call(MuseNoise *session, int stream, const uint8_t *body, size_t size);
int muse_noise_body_chunk(MuseNoise *session, int stream, const uint8_t *body, size_t size, int end);
int muse_noise_reset(MuseNoise *session, int stream);
size_t muse_noise_size(void);
#ifdef __cplusplus
}
#endif
