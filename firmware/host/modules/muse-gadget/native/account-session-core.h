#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MUSE_ACCOUNT_ORIGIN "https://api.muse.ai"
#define MUSE_ACCOUNT_NOISE "hatch.metaaivm.com"
#define MUSE_ACCOUNT_NAMESPACE "muse_account"
#define MUSE_ACCOUNT_KEY "record"
#define MUSE_ACCOUNT_RESPONSE_MAX 32768

typedef struct MuseAccount MuseAccount;
typedef enum {
  MA_OK, MA_INVALID, MA_STALE, MA_APPROVAL, MA_STORE, MA_HTTP,
  MA_AUTH, MA_REVOKED, MA_RESPONSE, MA_BUSY, MA_ACCESS_EXPIRED
} MuseAccountResult;
const char *muse_account_result_error(MuseAccountResult);
typedef bool (*MuseAccountCurrent)(void *, uint32_t);
typedef bool (*MuseAccountStore)(void *, const char *, const char *, const void *, size_t);
/* Native adapters must refuse redirects before issuing another request. */
typedef bool (*MuseAccountHTTP)(void *, const char *origin, const char *path,
  const char *method, const char *authorization, const char *body,
  char *response, size_t capacity, size_t *length, int *status, bool *redirected);
typedef bool (*MuseAccountNoiseSink)(void *, const char *host, const char *vm, const char *bearer);
typedef bool (*MuseAccountWiFiSink)(void *,const char *ssid,const char *password);

MuseAccount *muse_account_claim(const char *json, size_t length, uint32_t generation,
  MuseAccountCurrent current, void *context);
MuseAccount *muse_account_restore_blob(const char *,size_t,uint32_t);
MuseAccountResult muse_account_commit_approved(MuseAccount *, uint32_t, MuseAccountStore, void *);
MuseAccountResult muse_account_connect_approved(MuseAccount *, uint32_t, const char *device_id,
  MuseAccountHTTP, MuseAccountStore, void *);
MuseAccountResult muse_account_configure_noise(MuseAccount *, MuseAccountNoiseSink, void *);
void muse_account_close(MuseAccount *);
void muse_account_invalidate_voice(MuseAccount *);
MuseAccountResult muse_account_configure_wifi(MuseAccount *,uint32_t,MuseAccountWiFiSink,void *);
bool muse_account_wifi_valid(const char *,const char *);
MuseAccountResult muse_account_update_wifi_approved(MuseAccount *,uint32_t,const char *,const char *,MuseAccountStore,void *);
