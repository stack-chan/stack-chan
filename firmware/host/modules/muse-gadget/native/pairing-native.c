#include "xs.h"
#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
#include <ctype.h>
#include "mbedtls/platform_util.h"
#include "link_pairing.h"
#include "account-session-core.h"
#include "account-nvs.h"
#include "account-worker.h"
#include "sdk-token-store.h"

#define PAIRING_JSON_MAX 8192
typedef struct { char node[128], device[128], mac[32], firmware[128], sdk[MUSE_SDK_TOKEN_LENGTH+1]; char *staged; uint32_t staged_generation; } PairingOwner;
static PairingOwner *owner;

void xs_pairing_selftest(xsMachine *the) {
  xsmcVars(1);
  xsmcSetNewObject(xsResult);
  xsmcSetBoolean(xsVar(0),link_pairing_counter_selftest());
  xsmcSet(xsResult,xsID("counter"),xsVar(0));
  xsmcSetBoolean(xsVar(0),link_pairing_crypto_selftest());
  xsmcSet(xsResult,xsID("crypto"),xsVar(0));
}

static void discard(PairingOwner *p) {
  if (p->staged) { mbedtls_platform_zeroize(p->staged, strlen(p->staged)); free(p->staged); }
  p->staged = NULL; p->staged_generation = 0;
}
static void expireStage(PairingOwner *p) {
  if (p->staged && !link_pairing_provisioning_session_valid(p->staged_generation)) discard(p);
}
static uint32_t token(xsMachine *the, xsSlot arg) {
  double n = xsmcToNumber(arg);
  if (!isfinite(n) || n < 1 || n > UINT32_MAX || floor(n) != n) xsRangeError("invalid pairing generation");
  return (uint32_t)n;
}

static PairingOwner *get(xsMachine *the) {
  PairingOwner *value = xsmcGetHostData(xsThis);
  if (!value || value != owner) xsUnknownError("pairing closed");
  expireStage(value);
  return value;
}
void xs_pairing_destructor(void *data) {
  if (data && data == owner) {
    discard(owner);
    link_pairing_reset();
    link_pairing_init("", "", "", "", NULL);
    owner = NULL;
  }
  if (data) mbedtls_platform_zeroize(data,sizeof(PairingOwner));
  free(data);
}
static void copyIdentity(xsMachine *the, xsSlot arg, char *out, size_t cap) {
  const char *s = xsmcToString(arg);
  if (!*s || strlen(s) >= cap) xsRangeError("invalid pairing identity");
  memcpy(out, s, strlen(s) + 1);
}
static bool makeDeviceIdentity(char *mac,char *device,size_t capacity) {
  if (strlen(mac)!=17 || capacity<29) return false;
  for (unsigned i=0;i<17;i++) {
    if (i%3==2 ? mac[i]!=':' : !isxdigit((unsigned char)mac[i])) return false;
    mac[i]=(char)tolower((unsigned char)mac[i]);
  }
  snprintf(device,capacity,"hatch-link:%s",mac); return true;
}
void xs_pairing_constructor(xsMachine *the) {
  if (owner) xsUnknownError("pairing already open");
  if (!muse_sdk_pairing_privacy()) xsUnknownError("pairing privacy unavailable");
  if (!link_pairing_counter_selftest()) xsUnknownError("pairing counter selftest failed");
  if (!link_pairing_crypto_selftest()) xsUnknownError("pairing crypto selftest failed");
  PairingOwner value = {0};
  copyIdentity(the, xsArg(0), value.node, sizeof(value.node));
  copyIdentity(the, xsArg(2), value.mac, sizeof(value.mac));
  if (!makeDeviceIdentity(value.mac,value.device,sizeof(value.device))) xsRangeError("invalid pairing MAC");
  copyIdentity(the, xsArg(3), value.firmware, sizeof(value.firmware));
  MuseSDKResult sdk=muse_sdk_token_read(value.sdk);
  if (sdk!=MSDK_OK) {
    mbedtls_platform_zeroize(&value,sizeof(value));
    if (sdk==MSDK_ABSENT) xsUnknownError("SDK token not configured");
    if (sdk==MSDK_INVALID) xsUnknownError("SDK token invalid");
    xsUnknownError("SDK token unavailable");
  }
  PairingOwner *p = malloc(sizeof(*p));
  if (!p) { mbedtls_platform_zeroize(&value,sizeof(value)); xsUnknownError("pairing allocation failed"); }
  *p = value;
  mbedtls_platform_zeroize(&value,sizeof(value));
  owner = p;
  xsmcSetHostData(xsThis, p);
  link_pairing_init(p->node, p->device, p->mac, p->firmware, p->sdk);
}
void xs_pairing_close(xsMachine *the) {
  void *p = xsmcGetHostData(xsThis);
  xsmcSetHostData(xsThis, NULL);
  xs_pairing_destructor(p);
}
static cJSON *parse(xsMachine *the) {
  const char *s = xsmcToString(xsArg(0));
  size_t n = strlen(s);
  if (n > PAIRING_JSON_MAX) xsRangeError("pairing record too large");
  unsigned depth = 0; bool quoted = false, escaped = false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (quoted) { if (escaped) escaped = false; else if (c == '\\') escaped = true; else if (c == '"') quoted = false; }
    else if (c == '"') quoted = true;
    else if (c == '{' || c == '[') { if (++depth > 16) xsRangeError("pairing JSON depth"); }
    else if (c == '}' || c == ']') { if (!depth) xsRangeError("pairing JSON shape"); depth--; }
  }
  cJSON *root = cJSON_ParseWithLengthOpts(s, n + 1, NULL, true);
  if (!root || !cJSON_IsObject(root)) { cJSON_Delete(root); xsUnknownError("invalid pairing JSON"); }
  return root;
}
static void returnJson(xsMachine *the, char *json) {
  if (!json) xsUnknownError("pairing response unavailable");
  xsTry { xsResult = xsString(json); }
  xsCatch { free(json); xsThrow(xsException); }
  free(json);
}
static bool addPublicIdentity(cJSON *root, const PairingOwner *p) {
  return cJSON_AddStringToObject(root, "type", "device_info") &&
    cJSON_AddStringToObject(root, "node_id", p->node) &&
    cJSON_AddStringToObject(root, "version", p->firmware);
}
void xs_pairing_info(xsMachine *the) {
  PairingOwner *p = get(the);
  cJSON *root = cJSON_CreateObject();
  if (!root) xsUnknownError("pairing allocation failed");
  if (!addPublicIdentity(root,p)) { cJSON_Delete(root); xsUnknownError("pairing allocation failed"); }
  link_pairing_add_device_info(root);
  char *json = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  returnJson(the, json);
}
void xs_pairing_hello(xsMachine *the) {
  PairingOwner *p = get(the);
  cJSON *root = parse(the);
  discard(p);
  char *json = NULL;
  const char *error = link_pairing_handle_client_hello(root, &json);
  cJSON_Delete(root);
  if (error) { free(json); xsUnknownError("pairing hello rejected"); }
  returnJson(the, json);
}
static void wipeTree(cJSON *root);
static bool shallow(const char *s);
static bool exactFinished(const char *plain) {
  if (!plain || strlen(plain)>PAIRING_JSON_MAX || !shallow(plain)) return false;
  cJSON *root=cJSON_ParseWithLengthOpts(plain,strlen(plain)+1,NULL,true);
  cJSON *only=cJSON_IsObject(root) ? root->child : NULL;
  bool exact=only && !only->next && only->string && !strcmp(only->string,"action") &&
    cJSON_IsString(only) && only->valuestring && !strcmp(only->valuestring,"pairing_client_finished");
  wipeTree(root); cJSON_Delete(root);
  return exact;
}
void xs_pairing_finished(xsMachine *the) {
  get(the);
  if (link_pairing_session_confirmed() || link_pairing_confirmation_required()) xsUnknownError("pairing finished phase mismatch");
  cJSON *root = parse(the);
  char *plain = NULL;
  link_pairing_decrypt_reason_t reason;
  const char *error = link_pairing_decrypt_diagnostic(root, &plain, &reason);
  cJSON_Delete(root);
  bool exact = !error && exactFinished(plain);
  if (plain) { mbedtls_platform_zeroize(plain, strlen(plain)); free(plain); }
  if (error || !exact) {
    link_pairing_reset();
    if (error) {
      switch (reason) {
        case LINK_DECRYPT_EXPIRED: xsUnknownError("pairing decrypt expired");
        case LINK_DECRYPT_STATE: xsUnknownError("pairing decrypt state");
        case LINK_DECRYPT_ENVELOPE: xsUnknownError("pairing decrypt envelope");
        case LINK_DECRYPT_SESSION: xsUnknownError("pairing decrypt session");
        case LINK_DECRYPT_COUNTER: xsUnknownError("pairing decrypt counter");
        case LINK_DECRYPT_MEMORY: xsUnknownError("pairing decrypt memory");
        case LINK_DECRYPT_BASE64: xsUnknownError("pairing decrypt base64");
        case LINK_DECRYPT_AEAD: xsUnknownError("pairing decrypt aead");
        default: xsUnknownError("pairing finished decrypt rejected");
      }
    }
    xsUnknownError("pairing finished command rejected");
  }
  uint32_t generation = link_pairing_handle_client_finished();
  if (!generation) xsUnknownError("pairing finished expired");
  xsmcVars(1);
  xsmcSetNewObject(xsResult);
  xsmcSetNumber(xsVar(0), generation); xsmcSet(xsResult, xsID("generation"), xsVar(0));
  xsmcSetBoolean(xsVar(0), link_pairing_confirmation_required()); xsmcSet(xsResult, xsID("confirmationRequired"), xsVar(0));
}
void xs_pairing_arm(xsMachine *the) { get(the); xsmcSetBoolean(xsResult, link_pairing_arm_confirmation(token(the, xsArg(0)))); }
void xs_pairing_confirm(xsMachine *the) { get(the); xsmcSetNumber(xsResult, link_pairing_confirm_active_session()); }
void xs_pairing_current(xsMachine *the) { get(the); xsmcSetBoolean(xsResult, link_pairing_session_is_current(token(the, xsArg(0)))); }
void xs_pairing_generation(xsMachine *the) { get(the); xsmcSetNumber(xsResult, link_pairing_session_generation()); }
void xs_pairing_record_current(xsMachine *the) { get(the); xsmcSetBoolean(xsResult, link_pairing_record_session_is_current(token(the, xsArg(0)))); }
void xs_pairing_discard(xsMachine *the) { discard(get(the)); }
void xs_pairing_reset(xsMachine *the) { discard(get(the)); link_pairing_reset(); }
static unsigned statusClass(const char *name) {
  if (!strcmp(name,"confirm_required")) return 1;
  if (!strcmp(name,"pairing_confirmed")) return 2;
  const char *progress[]={"wifi_connecting","wifi_connected","auth_ok","wifi_failed","auth_failed","error_storage"};
  for (unsigned i=0;i<6;i++) if (!strcmp(name,progress[i])) return 3;
  return 0;
}
static void returnRecord(xsMachine *the,char *json,uint32_t record) {
  if (!json) xsUnknownError("pairing record unavailable");
  xsmcVars(1);
  xsTry {
    xsmcSetNewObject(xsResult);
    xsmcSetString(xsVar(0), json); xsmcSet(xsResult, xsID("json"), xsVar(0));
    xsmcSetNumber(xsVar(0), record); xsmcSet(xsResult, xsID("recordGeneration"), xsVar(0));
  } xsCatch { free(json); xsThrow(xsException); }
  free(json);
}
void xs_pairing_status(xsMachine *the) {
  get(the);
  const char *name = xsmcToString(xsArg(0));
  unsigned kind=statusClass(name);
  if (!kind) xsRangeError("unsupported pairing status");
  uint32_t generation = token(the, xsArg(1));
  if ((kind==1 && !link_pairing_confirmation_required()) ||
      (kind==2 && (!link_pairing_session_confirmed() || link_pairing_provisioning_session_valid(0))) ||
      (kind==3 && !link_pairing_provisioning_session_valid(generation)))
    xsUnknownError("pairing status phase mismatch");
  uint32_t record = 0;
  char *json = link_pairing_encrypt_status(name, generation, &record);
  returnRecord(the,json,record);
}
static void wipeTree(cJSON *root);
static bool shallow(const char *s);
static char *scanPayload(const char *text) {
  if (!text || strlen(text)>4096 || !shallow(text)) return NULL;
  const char *end=NULL;
  cJSON *networks=cJSON_ParseWithOpts(text,&end,true), *root=NULL;
  char *result=NULL;
  if (!cJSON_IsArray(networks) || cJSON_GetArraySize(networks)>16) goto done;
  for(cJSON *entry=networks->child;entry;entry=entry->next) {
    if(!cJSON_IsObject(entry))goto done;
    unsigned seen=0;
    for(cJSON *field=entry->child;field;field=field->next) {
      unsigned bit=0;
      if(field->string && !strcmp(field->string,"ssid")) {
        bit=1;
        if(!cJSON_IsString(field) || !field->valuestring || !*field->valuestring || strlen(field->valuestring)>32)goto done;
      } else if(field->string && !strcmp(field->string,"rssi")) {
        bit=2;
        if(!cJSON_IsNumber(field) || !isfinite(field->valuedouble) || field->valuedouble < -127 || field->valuedouble > 0 || floor(field->valuedouble)!=field->valuedouble)goto done;
      } else if(field->string && !strcmp(field->string,"secure")) {
        bit=4; if(!cJSON_IsBool(field))goto done;
      } else goto done;
      if(seen & bit)goto done;
      seen|=bit;
    }
    if(seen!=7)goto done;
  }
  root=cJSON_CreateObject();
  if(!root || !cJSON_AddStringToObject(root,"type","wifi_scan_result") || !cJSON_AddItemToObject(root,"networks",networks))goto done;
  networks=NULL;
  result=cJSON_PrintUnformatted(root);
done:
  wipeTree(networks); cJSON_Delete(networks);
  wipeTree(root); cJSON_Delete(root);
  return result;
}
void xs_pairing_scan_result(xsMachine *the) {
  get(the);
  uint32_t generation=token(the,xsArg(0)), record=0;
  if (!link_pairing_session_confirmed() || !link_pairing_session_is_current(generation)) xsUnknownError("pairing scan phase mismatch");
  char *payload=scanPayload(xsmcToString(xsArg(1)));
  if(!payload)xsUnknownError("pairing scan data invalid");
  char *json=link_pairing_encrypt_json(payload,generation,&record);
  mbedtls_platform_zeroize(payload,strlen(payload)); cJSON_free(payload);
  returnRecord(the,json,record);
}

static void wipeTree(cJSON *root) {
  for (cJSON *p = root; p; p = p->next) {
    if (p->valuestring) mbedtls_platform_zeroize(p->valuestring, strlen(p->valuestring));
    if (p->string) mbedtls_platform_zeroize(p->string, strlen(p->string));
    wipeTree(p->child);
  }
}
static bool shallow(const char *s) {
  if (strstr(s, "\\u0000")) return false;
  unsigned depth = 0; bool quoted = false, escape = false;
  for (; *s; s++) {
    char c = *s;
    if (quoted) { if (escape) escape = false; else if (c == '\\') escape = true; else if (c == '"') quoted = false; }
    else if (c == '"') quoted = true;
    else if (c == '{' || c == '[') { if (++depth > 4) return false; }
    else if (c == '}' || c == ']') { if (!depth) return false; depth--; }
  }
  return !depth && !quoted;
}
static bool validProvision(cJSON *root) {
  const char *names[] = {"action", "ssid", "password", "access_token", "refresh_token", "token_type", "username", "api_url", "api_url_v2", "noise_host"};
  const size_t caps[] = {12, 32, 63, 2048, 2048, 6, 128, 1024, 1024, 512};
  unsigned seen = 0;
  if (!cJSON_IsObject(root)) return false;
  for (cJSON *p = root->child; p; p = p->next) {
    unsigned i;
    for (i = 0; i < 10; i++) if (p->string && !strcmp(p->string, names[i])) break;
    if (i == 10 || (seen & (1u << i)) || !cJSON_IsString(p) || !p->valuestring) return false;
    size_t n = strlen(p->valuestring);
    if ((!n && i != 6) || n > caps[i]) return false;
    seen |= 1u << i;
  }
  return (seen & 63) == 63 && !strcmp(cJSON_GetObjectItemCaseSensitive(root, "action")->valuestring, "provision_v2") &&
    !strcmp(cJSON_GetObjectItemCaseSensitive(root, "token_type")->valuestring, "device");
}
static bool isWifiScan(cJSON *root) {
  cJSON *p=cJSON_IsObject(root) ? root->child : NULL;
  return p && !p->next && p->string && !strcmp(p->string,"action") && cJSON_IsString(p) && !strcmp(p->valuestring,"wifi_scan");
}
void xs_pairing_receive(xsMachine *the) {
  PairingOwner *p = get(the);
  if (!link_pairing_session_confirmed()) {
    xs_pairing_finished(the);
    xsmcVars(1); xsmcSetString(xsVar(0), "finished"); xsmcSet(xsResult, xsID("kind"), xsVar(0));
    return;
  }
  cJSON *encrypted = parse(the);
  char *plain = NULL;
  const char *error = link_pairing_decrypt_command(encrypted, &plain);
  cJSON_Delete(encrypted);
  cJSON *command = NULL;
  bool valid = !error && plain && strlen(plain) <= PAIRING_JSON_MAX && shallow(plain);
  bool scan=false;
  if (valid) { command = cJSON_ParseWithLengthOpts(plain, strlen(plain) + 1, NULL, true); scan=isWifiScan(command); valid = scan || validProvision(command); }
  wipeTree(command); cJSON_Delete(command);
  if (valid && scan) {
    mbedtls_platform_zeroize(plain,strlen(plain)); free(plain);
    uint32_t generation=link_pairing_session_generation();
    if (!generation || !link_pairing_session_confirmed()) xsUnknownError("pairing scan expired");
    xsmcVars(1); xsmcSetNewObject(xsResult);
    xsmcSetString(xsVar(0),"wifi_scan"); xsmcSet(xsResult,xsID("kind"),xsVar(0));
    xsmcSetNumber(xsVar(0),generation); xsmcSet(xsResult,xsID("generation"),xsVar(0));
    return;
  }
  uint32_t generation = valid ? link_pairing_mark_provisioning_active() : 0;
  if (!valid || !generation) {
    if (plain) { mbedtls_platform_zeroize(plain, strlen(plain)); free(plain); }
    discard(p); link_pairing_reset(); xsUnknownError("pairing provision rejected");
  }
  discard(p); p->staged = plain; p->staged_generation = generation;
  xsmcVars(1); xsmcSetNewObject(xsResult);
  xsmcSetString(xsVar(0), "provision"); xsmcSet(xsResult, xsID("kind"), xsVar(0));
  xsmcSetNumber(xsVar(0), generation); xsmcSet(xsResult, xsID("generation"), xsVar(0));
  xsmcSetBoolean(xsVar(0), true); xsmcSet(xsResult, xsID("provisionReady"), xsVar(0));
}

typedef struct { MuseAccount *core; MuseAccountWorker *worker; uint32_t generation; char device[128]; } AccountOwner;
static uint32_t restoreGeneration=0x80000000;
MuseAccountResult muse_account_owner_configure(xsMachine *the,xsSlot slot,MuseAccountNoiseSink sink,void *context) {
  extern void xs_account_destructor(void *);
  AccountOwner *a=xsmcGetHostDataValidate(slot,xs_account_destructor);
  return a && a->core ? muse_account_configure_noise(a->core,sink,context) : MA_STALE;
}
MuseAccountResult muse_account_owner_wifi(xsMachine *the,xsSlot slot,uint32_t generation,MuseAccountWiFiSink sink,void *context) {
  extern void xs_account_destructor(void *);
  AccountOwner *a=xsmcGetHostDataValidate(slot,xs_account_destructor);
  return a && a->core ? muse_account_configure_wifi(a->core,generation,sink,context) : MA_STALE;
}
void xs_account_destructor(void *data) {
  AccountOwner *a=data;
  if (a) { muse_account_worker_release(a->worker); muse_account_close(a->core); mbedtls_platform_zeroize(a,sizeof(*a)); free(a); }
}
static bool claimCurrent(void *context,uint32_t generation) {
  PairingOwner *p=context;
  return p==owner && p->staged && p->staged_generation==generation && link_pairing_provisioning_session_valid(generation);
}
static AccountOwner *claimAccount(PairingOwner *p,uint32_t generation) {
  if (!p || p!=owner) return NULL;
  expireStage(p);
  if (!claimCurrent(p,generation)) return NULL;
  AccountOwner *a=calloc(1,sizeof(*a)); if (!a) return NULL;
  a->core=muse_account_claim(p->staged,strlen(p->staged),generation,claimCurrent,p);
  if (!a->core) { free(a); return NULL; }
  a->generation=generation;
  memcpy(a->device,p->node,sizeof(a->device));
  discard(p); return a;
}
void xs_account_constructor(xsMachine *the) {
  PairingOwner *p=xsmcGetHostDataValidate(xsArg(0),xs_pairing_destructor);
  uint32_t generation=token(the,xsArg(1));
  AccountOwner *a=claimAccount(p,generation);
  if (!a) xsUnknownError("account staging unavailable");
  xsmcSetHostData(xsThis,a);
}
void xs_account_restore(xsMachine *the) {
  if (restoreGeneration==UINT32_MAX) xsUnknownError("account generation exhausted");
  AccountOwner *a=calloc(1,sizeof(*a)); if (!a) xsUnknownError("account allocation failed");
  a->generation=++restoreGeneration;
  if (!muse_account_device_id(a->device,sizeof(a->device))) { free(a); xsUnknownError("account identity unavailable"); }
  MuseAccountRestoreResult result=muse_account_nvs_restore_result(a->generation,&a->core);
  if (result!=MA_RESTORE_OK) {
    xs_account_destructor(a);
    if (result==MA_RESTORE_ABSENT) xsUnknownError("account record absent");
    if (result==MA_RESTORE_INVALID) xsUnknownError("account record invalid");
    xsUnknownError("account store unavailable");
  }
  xsmcSetHostData(xsThis,a);
}
void xs_account_generation(xsMachine *the) {
  AccountOwner *a=xsmcGetHostDataValidate(xsThis,xs_account_destructor);
  if (!a) xsUnknownError("account closed");
  xsmcSetNumber(xsResult,a->generation);
}
void xs_account_close(xsMachine *the) {
  AccountOwner *a=xsmcGetHostDataValidate(xsThis,xs_account_destructor);
  xsmcSetHostData(xsThis,NULL); xs_account_destructor(a);
}
void xs_account_current(xsMachine *the) {
  AccountOwner *a=xsmcGetHostDataValidate(xsThis,xs_account_destructor);
  uint32_t generation=token(the,xsArg(0));
  xsmcSetBoolean(xsResult,a && a->generation==generation);
}
void xs_account_commit(xsMachine *the) {
  AccountOwner *a=xsmcGetHostDataValidate(xsThis,xs_account_destructor);
  uint32_t generation=token(the,xsArg(0));
  if (!a || a->generation!=generation) xsUnknownError("account owner expired");
  if (a->worker) xsUnknownError("account busy");
  if (muse_account_commit_approved(a->core,generation,muse_account_nvs_store,NULL)!=MA_OK) xsUnknownError("account save failed");
  xsmcVars(1); xsmcSetNewObject(xsResult); xsmcSetBoolean(xsVar(0),true); xsmcSet(xsResult,xsID("saved"),xsVar(0));
}
void xs_account_connect(xsMachine *the) {
  AccountOwner *a=xsmcGetHostDataValidate(xsThis,xs_account_destructor);
  uint32_t generation=token(the,xsArg(0));
  if (!a || a->generation!=generation || !a->core) xsUnknownError("account owner expired");
  if (a->worker) xsUnknownError("account busy");
  a->worker=muse_account_worker_start(&a->core,generation,a->device);
  if (!a->worker) xsUnknownError("account worker unavailable");
}
void xs_account_poll(xsMachine *the) {
  AccountOwner *a=xsmcGetHostDataValidate(xsThis,xs_account_destructor);
  if (!a || !a->worker) xsUnknownError("account worker unavailable");
  if (!muse_account_worker_done(a->worker)) { xsmcSetBoolean(xsResult,false); return; }
  MuseAccountResult result;
  if (!muse_account_worker_take(a->worker,&a->core,&result)) xsUnknownError("account worker result unavailable");
  MuseAccountHTTPReason http_reason=muse_account_worker_http_reason(a->worker);
  muse_account_worker_release(a->worker); a->worker=NULL;
  if (result==MA_HTTP && http_reason!=MA_HTTP_NONE) xsUnknownError("%s",muse_account_http_error(http_reason));
  if (result!=MA_OK) xsUnknownError("%s",muse_account_result_error(result));
  xsmcVars(1); xsmcSetNewObject(xsResult); xsmcSetBoolean(xsVar(0),true); xsmcSet(xsResult,xsID("prepared"),xsVar(0));
}
void xs_account_cancel(xsMachine *the) {
  AccountOwner *a=xsmcGetHostDataValidate(xsThis,xs_account_destructor);
  if (a) muse_account_worker_cancel(a->worker);
}
