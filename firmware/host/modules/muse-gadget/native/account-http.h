#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdatomic.h>
#include <stdint.h>
typedef enum { MA_HTTP_NONE, MA_HTTP_CLOCK, MA_HTTP_INPUT, MA_HTTP_PRIVACY,
  MA_HTTP_INIT, MA_HTTP_CONFIG, MA_HTTP_CANCEL, MA_HTTP_DEADLINE,
  MA_HTTP_REDIRECT, MA_HTTP_RESPONSE, MA_HTTP_TRANSPORT, MA_HTTP_DNS, MA_HTTP_SOCKET, MA_HTTP_CONNECT,
  MA_HTTP_CONNECT_TIMEOUT, MA_HTTP_CERTIFICATE, MA_HTTP_HANDSHAKE, MA_HTTP_TLS_IO, MA_HTTP_TLS_SETUP, MA_HTTP_INVALID_TRANSPORT, MA_HTTP_SDK_UNAVAILABLE } MuseAccountHTTPReason;
typedef struct { const atomic_bool *cancelled; int64_t deadline_us; MuseAccountHTTPReason reason; } MuseAccountHTTPContext;
const char *muse_account_http_error(MuseAccountHTTPReason);
bool muse_account_http(void *,const char *,const char *,const char *,const char *,const char *,char *,size_t,size_t *,int *,bool *);
