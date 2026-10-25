#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define MUSE_FRAME_MAX 8192
#define MUSE_BODY_MAX 4096
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
int muse_noise_chunk(MuseNoise *session, const uint8_t *body, size_t size);
int muse_noise_next(MuseNoise *session, const uint8_t **out);
int muse_noise_receive(MuseNoise *session, const uint8_t *data, size_t size, MuseFrame *frame);
size_t muse_noise_size(void);
#ifdef __cplusplus
}
#endif
