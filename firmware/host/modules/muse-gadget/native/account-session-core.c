#include "account-session-core.h"
#include "cJSON.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

struct MuseAccount {
  uint32_t generation;
  bool committed, busy, ready, closing;
  char access[2049], refresh[2049], vm[129], bearer[2049];
};
const char *muse_account_result_error(MuseAccountResult result) {
  switch(result) {
    case MA_INVALID: return "account invalid";
    case MA_STALE: return "account cancelled";
    case MA_APPROVAL: return "account approval required";
    case MA_STORE: return "account storage failed";
    case MA_HTTP: return "account HTTP failed";
    case MA_AUTH: return "account access denied";
    case MA_REVOKED: return "account refresh rejected";
    case MA_RESPONSE: return "account response invalid";
    case MA_BUSY: return "account busy";
    case MA_ACCESS_EXPIRED: return "account access expired";
    default: return "account preparation failed";
  }
}
static void wipe(void *p, size_t n) { volatile unsigned char *b = p; while (n--) *b++ = 0; }
static MuseAccountResult leave(MuseAccount *a, MuseAccountResult rc) {
  a->busy=false;
  if (a->closing) { muse_account_close(a); return MA_STALE; }
  return rc;
}
static void destroy_json(cJSON *j) {
  if (!j) return;
  for (cJSON *p = j->child; p; p = p->next) {
    if (p->valuestring) wipe(p->valuestring, strlen(p->valuestring));
    if (p->child) { cJSON *child = p->child; p->child = NULL; while (child) { cJSON *next = child->next; child->next = NULL; destroy_json(child); child = next; } }
  }
  if (j->valuestring) wipe(j->valuestring, strlen(j->valuestring));
  cJSON_Delete(j);
}
static cJSON *parse(const char *s, size_t n) {
  if (!s || !n || n > MUSE_ACCOUNT_RESPONSE_MAX || memchr(s, 0, n)) return NULL;
  unsigned depth = 0; bool quote = false, escape = false;
  for (size_t i = 0; i < n; i++) {
    if (i + 6 <= n && !memcmp(s+i, "\\u0000", 6)) return NULL;
    char c = s[i];
    if (quote) { if (escape) escape = false; else if (c == '\\') escape = true; else if (c == '"') quote = false; }
    else if (c == '"') quote = true;
    else if (c == '{' || c == '[') { if (++depth > 8) return NULL; }
    else if (c == '}' || c == ']') { if (!depth) return NULL; depth--; }
  }
  if (depth || quote) return NULL;
  const char *end = NULL;
  cJSON *j = cJSON_ParseWithLengthOpts(s, n, &end, false);
  while (end && end < s+n && (*end == ' ' || *end == '\r' || *end == '\n' || *end == '\t')) end++;
  if (!j || end != s+n) { destroy_json(j); return NULL; }
  return j;
}
static const char *field(cJSON *j, const char *name, size_t max) {
  const char *s = NULL; unsigned count = 0;
  for (cJSON *p = j ? j->child : NULL; p; p = p->next) {
    if (p->string && !strcmp(p->string, name)) {
      count++; if (cJSON_IsString(p)) s = p->valuestring;
    }
  }
  return count == 1 && s && *s && strlen(s) <= max && !strchr(s, '\r') && !strchr(s, '\n') ? s : NULL;
}
static bool identifier(const char *s) {
  return s && *s && strlen(s) <= 128 && strspn(s, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") == strlen(s);
}
MuseAccount *muse_account_claim(const char *json, size_t length, uint32_t generation, MuseAccountCurrent current, void *ctx) {
  if (!generation || !current || !current(ctx, generation) || length > 8192) return NULL;
  cJSON *j = parse(json, length); MuseAccount *a = NULL;
  if (!cJSON_IsObject(j)) goto done;
  const char *names[] = {"action","ssid","password","access_token","refresh_token","token_type","username","api_url","api_url_v2","noise_host"};
  unsigned seen = 0;
  for (cJSON *p = j->child; p; p = p->next) {
    unsigned i; for (i=0; i<10; i++) if (p->string && !strcmp(names[i],p->string)) break;
    if (i==10 || (seen & (1u<<i)) || !cJSON_IsString(p)) goto done;
    seen |= 1u<<i;
    if (i==7 && strlen(p->valuestring)>1024) goto done;
    if (i==8 && strcmp(p->valuestring,MUSE_ACCOUNT_ORIGIN)) goto done;
    if (i==9 && strcmp(p->valuestring,MUSE_ACCOUNT_NOISE)) goto done;
    if (i==6 && strlen(p->valuestring)>128) goto done;
  }
  const char *action=field(j,"action",12), *type=field(j,"token_type",6);
  const char *access=field(j,"access_token",2048), *refresh=field(j,"refresh_token",2048);
  if (!action || strcmp(action,"provision_v2") || !type || strcmp(type,"device") || !access || !refresh) goto done;
  a = calloc(1,sizeof(*a)); if (!a) goto done;
  a->generation=generation; strcpy(a->access,access); strcpy(a->refresh,refresh);
  if (!current(ctx,generation)) { muse_account_close(a); a=NULL; }
done: destroy_json(j); return a;
}
static bool persist(MuseAccount *a, MuseAccountStore store, void *ctx) {
  if (!store) return false;
  cJSON *j=cJSON_CreateObject(); char *blob=NULL; bool ok=false;
  if (!j || !cJSON_AddNumberToObject(j,"version",2) || !cJSON_AddStringToObject(j,"access_token",a->access) ||
      !cJSON_AddStringToObject(j,"refresh_token",a->refresh)) goto done;
  blob=cJSON_PrintUnformatted(j);
  if (blob) ok=store(ctx,MUSE_ACCOUNT_NAMESPACE,MUSE_ACCOUNT_KEY,blob,strlen(blob));
done: if (blob) { wipe(blob,strlen(blob)); cJSON_free(blob); } destroy_json(j); a->committed=ok; return ok;
}
MuseAccount *muse_account_restore_blob(const char *json,size_t length,uint32_t generation) {
  if (!generation || length>8192) return NULL;
  cJSON *j=parse(json,length); MuseAccount *a=NULL;
  if (!cJSON_IsObject(j)) goto done;
  const char *names[]={"version","access_token","refresh_token"}; unsigned seen=0;
  for (cJSON *p=j->child;p;p=p->next) {
    unsigned i; for (i=0;i<3;i++) if (p->string && !strcmp(p->string,names[i])) break;
    if (i==3 || (seen & (1u<<i))) goto done;
    seen|=1u<<i;
    if (!i && (!cJSON_IsNumber(p) || p->valuedouble!=2)) goto done;
  }
  if (seen!=7) goto done;
  const char *access=field(j,"access_token",2048), *refresh=field(j,"refresh_token",2048);
  if (!access || !refresh) goto done;
  a=calloc(1,sizeof(*a)); if (!a) goto done;
  strcpy(a->access,access); strcpy(a->refresh,refresh);
  a->generation=generation; a->committed=true;
done: destroy_json(j); return a;
}
MuseAccountResult muse_account_commit_approved(MuseAccount *a,uint32_t generation,MuseAccountStore store,void *ctx) {
  if (!a) return MA_INVALID;
  if (a->busy) return MA_BUSY;
  if (!generation || a->generation!=generation) return MA_APPROVAL;
  a->busy=true; bool ok=persist(a,store,ctx); return leave(a,ok ? MA_OK : MA_STORE);
}
static MuseAccountResult request(MuseAccount *a, MuseAccountHTTP http, void *ctx, bool refresh, const char *device, cJSON **out) {
  char *response=calloc(1,MUSE_ACCOUNT_RESPONSE_MAX+1), auth[2080]={0};
  char *body=NULL; cJSON *j=NULL; MuseAccountResult rc=MA_HTTP;
  if (!response) return MA_HTTP;
  const char *token=refresh ? strrchr(a->refresh,':') : NULL;
  token=refresh ? (token ? token+1 : a->refresh) : a->access;
  if (!*token) { rc=MA_INVALID; goto done; }
  snprintf(auth,sizeof(auth),refresh ? "Bearer hatch_refresh:%s" : "Bearer %s",token);
  if (refresh) { j=cJSON_CreateObject(); if (!j || !cJSON_AddStringToObject(j,"device_id",device)) goto done; body=cJSON_PrintUnformatted(j); if (!body) goto done; }
  size_t length=0; int status=0; bool redirected=false;
  if (!http(ctx,MUSE_ACCOUNT_ORIGIN,refresh ? "/device_token/refresh" : "/fetch_vms",refresh ? "POST" : "GET",auth,body,response,MUSE_ACCOUNT_RESPONSE_MAX,&length,&status,&redirected)) goto done;
  if (a->closing) { rc=MA_STALE; goto done; }
  if (redirected || (status>=300 && status<400)) goto done;
  if (status==401 || status==403) { rc=status==401 ? (refresh ? MA_REVOKED : MA_ACCESS_EXPIRED) : MA_AUTH; goto done; }
  if (status<200 || status>=300) goto done;
  if (length>MUSE_ACCOUNT_RESPONSE_MAX) { rc=MA_RESPONSE; goto done; }
  *out=parse(response,length); rc=cJSON_IsObject(*out) ? MA_OK : MA_RESPONSE;
done:
  wipe(auth,sizeof(auth)); wipe(response,MUSE_ACCOUNT_RESPONSE_MAX+1); free(response);
  if (body) { wipe(body,strlen(body)); cJSON_free(body); } destroy_json(j); return rc;
}
MuseAccountResult muse_account_connect_approved(MuseAccount *a,uint32_t generation,const char *device,MuseAccountHTTP http,MuseAccountStore store,void *ctx) {
  if (!a || !http || !identifier(device)) return MA_INVALID;
  if (a->busy) return MA_BUSY;
  if (!a->committed || !generation || generation!=a->generation) return MA_APPROVAL;
  a->busy=true; a->ready=false; wipe(a->bearer,sizeof(a->bearer)); wipe(a->vm,sizeof(a->vm));
  cJSON *j=NULL; MuseAccountResult rc=request(a,http,ctx,false,device,&j);
  if (rc==MA_ACCESS_EXPIRED) {
    destroy_json(j); j=NULL; rc=request(a,http,ctx,true,device,&j);
    if (rc!=MA_OK) goto done;
    const char *access=field(j,"access_token",2048), *refresh=field(j,"refresh_token",2048);
    if (!access || !refresh) { rc=MA_RESPONSE; goto done; }
    wipe(a->access,sizeof(a->access)); wipe(a->refresh,sizeof(a->refresh)); strcpy(a->access,access); strcpy(a->refresh,refresh);
    if (!persist(a,store,ctx)) { rc=MA_STORE; goto done; }
    if (a->closing) { rc=MA_STALE; goto done; }
    destroy_json(j); j=NULL; rc=request(a,http,ctx,false,device,&j);
  }
  if (rc!=MA_OK) goto done;
  cJSON *list=cJSON_GetObjectItemCaseSensitive(j,"vm_list"), *pick=NULL;
  unsigned lists=0, defaults=0;
  for (cJSON *p=j->child;p;p=p->next) if (p->string && !strcmp(p->string,"vm_list")) lists++;
  if (lists!=1) { rc=MA_RESPONSE; goto done; }
  if (!cJSON_IsArray(list) || cJSON_GetArraySize(list)>8) { rc=MA_RESPONSE; goto done; }
  for (cJSON *p=list->child;p;p=p->next) {
    if (!cJSON_IsObject(p)) { rc=MA_RESPONSE; goto done; }
    unsigned default_fields=0;
    for (cJSON *q=p->child;q;q=q->next) if (q->string && !strcmp(q->string,"default")) default_fields++;
    if (default_fields>1) { rc=MA_RESPONSE; goto done; }
    bool is_default=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(p,"default"));
    if (is_default && ++defaults>1) { rc=MA_RESPONSE; goto done; }
    if (!pick || is_default) pick=p;
  }
  const char *id=field(pick,"vm_id",128), *bearer=field(pick,"vm_auth_token",2048);
  if (!identifier(id) || !bearer) { rc=MA_RESPONSE; goto done; }
  strcpy(a->vm,id); strcpy(a->bearer,bearer); a->ready=true;
done: destroy_json(j); return leave(a,rc);
}
MuseAccountResult muse_account_configure_noise(MuseAccount *a,MuseAccountNoiseSink sink,void *ctx) {
  if (!a || !sink) return MA_INVALID;
  if (a->busy) return MA_BUSY;
  if (!a->ready) return MA_AUTH;
  a->busy=true; bool ok=sink(ctx,MUSE_ACCOUNT_NOISE,a->vm,a->bearer); return leave(a,ok ? MA_OK : MA_INVALID);
}
void muse_account_close(MuseAccount *a) {
  if (!a) return;
  if (a->busy) { a->closing=true; return; }
  wipe(a,sizeof(*a)); free(a);
}
void muse_account_invalidate_voice(MuseAccount *a) {
  if (a && !a->busy) { a->ready=false; wipe(a->bearer,sizeof(a->bearer)); wipe(a->vm,sizeof(a->vm)); }
}
