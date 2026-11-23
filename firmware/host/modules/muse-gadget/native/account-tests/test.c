#include "../account-session-core.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static const char provision[]="{\"action\":\"provision_v2\",\"ssid\":\"fixture\",\"password\":\"testonly\",\"access_token\":\"access-fixture\",\"refresh_token\":\"hatch_refresh:refresh-fixture\",\"token_type\":\"device\"}";
typedef struct { int writes,requests,mode; bool save; MuseAccount *owner; } Context;
static bool current(void *ctx,uint32_t g) { (void)ctx; return g==7; }
static bool store(void *ctx,const char *ns,const char *key,const void *blob,size_t length) {
  Context *c=ctx; c->writes++;
  assert(!strcmp(ns,"muse_account") && !strcmp(key,"record"));
  assert(length>100 && length<8192 && strstr(blob,"\"version\":1"));
  assert(strstr(blob,"access_token") && strstr(blob,"refresh_token"));
  assert(!strstr(blob,"api_url"));
  if (c->mode==9) muse_account_close(c->owner);
  return c->save;
}
static bool http(void *ctx,const char *origin,const char *path,const char *method,const char *auth,const char *body,char *out,size_t cap,size_t *len,int *status,bool *redirect) {
  Context *c=ctx; int n=++c->requests;
  assert(!strcmp(origin,"https://api.muse.ai") && cap==32768);
  const char *response="{\"vm_list\":[{\"vm_id\":\"vm-fixture\",\"vm_auth_token\":\"vm-bearer-fixture\",\"default\":true}]}";
  *status=200;
  if (c->mode==10) muse_account_close(c->owner);
  if (c->mode==1 || c->mode==2 || c->mode==3 || c->mode==4) {
    if (n==1) { *status=401; response="{}"; }
    if (n==2) {
      assert(!strcmp(path,"/device_token/refresh") && !strcmp(method,"POST"));
      assert(!strcmp(auth,"Bearer hatch_refresh:refresh-fixture"));
      assert(!strcmp(body,"{\"device_id\":\"device-fixture\"}"));
      response="{\"access_token\":\"new-access\",\"refresh_token\":\"new-refresh\"}";
      if (c->mode==2) *status=401;
      if (c->mode==3) *status=403;
      if (c->mode==4) c->save=false;
    }
    if (n==3) assert(!strcmp(auth,"Bearer new-access"));
  }
  if (n!=2 || !c->mode || c->mode>=5) {
    assert(!strcmp(path,"/fetch_vms") && !strcmp(method,"GET") && !body);
  }
  if (c->mode==5) { *status=302; *redirect=true; }
  if (c->mode==6) { *len=cap+1; return true; }
  if (c->mode==7) response="{\"vm_list\":[{\"vm_id\":\"vm\",\"vm_auth_token\":\"a\",\"vm_auth_token\":\"b\"}]}";
  if (c->mode==8) response="{\"vm_list\":[{\"vm_id\":\"vm\",\"vm_auth_token\":\"a\\u0000b\"}]}";
  if (c->mode==11) *status=403;
  if (c->mode==12) response="{\"vm_list\":[{\"vm_id\":\"vm\",\"vm_auth_token\":\"a\",\"default\":false,\"default\":true}]}";
  *len=strlen(response); memcpy(out,response,*len); return true;
}
static bool noise(void *ctx,const char *host,const char *id,const char *bearer) {
  (void)ctx; assert(!strcmp(host,"hatch.metaaivm.com")); assert(!strcmp(id,"vm-fixture")); assert(!strcmp(bearer,"vm-bearer-fixture")); return true;
}
static bool wifi(void *ctx,const char *ssid,const char *password) {
  (void)ctx; assert(!strcmp(ssid,"fixture") && !strcmp(password,"testonly")); return true;
}
int main(void) {
  assert(!strcmp(muse_account_result_error(MA_AUTH),"account access denied"));
  assert(!strcmp(muse_account_result_error(MA_REVOKED),"account refresh rejected"));
  assert(!strcmp(muse_account_result_error(MA_ACCESS_EXPIRED),"account access expired"));
  assert(!strcmp(muse_account_result_error(MA_RESPONSE),"account response invalid"));
  assert(!strcmp(muse_account_result_error((MuseAccountResult)999),"account preparation failed"));
  assert(!muse_account_claim(provision,strlen(provision),6,current,NULL));
  char altered[8193];
  snprintf(altered,sizeof(altered),"%.*s,\"api_url_v2\":\"https://evil.invalid\"}",(int)strlen(provision)-1,provision);
  assert(!muse_account_claim(altered,strlen(altered),7,current,NULL));
  snprintf(altered,sizeof(altered),"%.*s,\"noise_host\":\"hatch.metaaivm.com\",\"api_url_v2\":\"https://api.muse.ai\"}",(int)strlen(provision)-1,provision);
  MuseAccount *valid=muse_account_claim(altered,strlen(altered),7,current,NULL); assert(valid); muse_account_close(valid);
  snprintf(altered,sizeof(altered),"%.*s,\"api_url\":\"https://legacy.invalid/unused\"}",(int)strlen(provision)-1,provision);
  valid=muse_account_claim(altered,strlen(altered),7,current,NULL); assert(valid);
  Context legacy={.save=true}; assert(muse_account_commit_approved(valid,7,store,&legacy)==MA_OK); muse_account_close(valid);
  char too_long[1026]; memset(too_long,'a',1025); too_long[1025]=0;
  snprintf(altered,sizeof(altered),"%.*s,\"api_url\":\"%s\"}",(int)strlen(provision)-1,provision,too_long);
  assert(!muse_account_claim(altered,strlen(altered),7,current,NULL));
  snprintf(altered,sizeof(altered),"%.*s,\"access_token\":\"duplicate\"}",(int)strlen(provision)-1,provision);
  assert(!muse_account_claim(altered,strlen(altered),7,current,NULL));
  for (int mode=0; mode<=8; mode++) {
    Context c={.save=true,.mode=mode};
    MuseAccount *a=muse_account_claim(provision,strlen(provision),7,current,NULL); assert(a);
    assert(muse_account_configure_wifi(a,7,wifi,NULL)==MA_APPROVAL);
    assert(muse_account_connect_approved(a,7,"device-fixture",http,store,&c)==MA_APPROVAL && c.requests==0);
    assert(muse_account_commit_approved(a,6,store,&c)==MA_APPROVAL && c.writes==0);
    assert(muse_account_commit_approved(a,7,store,&c)==MA_OK && c.writes==1);
    assert(muse_account_configure_wifi(a,6,wifi,NULL)==MA_APPROVAL);
    assert(muse_account_configure_wifi(a,7,wifi,NULL)==MA_OK);
    MuseAccountResult expected[]={MA_OK,MA_OK,MA_REVOKED,MA_AUTH,MA_STORE,MA_HTTP,MA_RESPONSE,MA_RESPONSE,MA_RESPONSE};
    assert(muse_account_connect_approved(a,7,"device-fixture",http,store,&c)==expected[mode]);
    assert(muse_account_configure_noise(a,noise,NULL)==(mode<2 ? MA_OK : MA_AUTH));
    assert(c.requests==(mode==1 ? 3 : mode>=2 && mode<=4 ? 2 : 1));
    assert(c.writes==((mode==1 || mode==4) ? 2 : 1));
    if (mode==4) assert(muse_account_connect_approved(a,7,"device-fixture",http,store,&c)==MA_APPROVAL);
    muse_account_close(a);
  }
  Context c={.save=true,.mode=9};
  c.owner=muse_account_claim(provision,strlen(provision),7,current,NULL); assert(c.owner);
  assert(muse_account_commit_approved(c.owner,7,store,&c)==MA_STALE);
  c=(Context){.save=true,.mode=0};
  c.owner=muse_account_claim(provision,strlen(provision),7,current,NULL); assert(c.owner);
  assert(muse_account_commit_approved(c.owner,7,store,&c)==MA_OK);
  c.mode=10;
  assert(muse_account_connect_approved(c.owner,7,"device-fixture",http,store,&c)==MA_STALE);
  assert(c.requests==1);
  for (int mode=11;mode<=12;mode++) {
    c=(Context){.save=true,.mode=mode};
    c.owner=muse_account_claim(provision,strlen(provision),7,current,NULL); assert(c.owner);
    assert(muse_account_commit_approved(c.owner,7,store,&c)==MA_OK);
    assert(muse_account_connect_approved(c.owner,7,"device-fixture",http,store,&c)==(mode==11 ? MA_AUTH : MA_RESPONSE));
    assert(c.requests==1); muse_account_close(c.owner);
  }
  c=(Context){.save=true};
  c.owner=muse_account_claim(provision,strlen(provision),7,current,NULL); assert(c.owner);
  assert(muse_account_update_wifi_approved(c.owner,7,"new","new-password",store,&c)==MA_APPROVAL && !c.writes);
  assert(muse_account_commit_approved(c.owner,7,store,&c)==MA_OK);
  assert(muse_account_update_wifi_approved(c.owner,6,"new","new-password",store,&c)==MA_APPROVAL && c.writes==1);
  assert(muse_account_update_wifi_approved(c.owner,7,"new","",store,&c)==MA_INVALID && c.writes==1);
  assert(muse_account_connect_approved(c.owner,7,"device-fixture",http,store,&c)==MA_OK);
  assert(muse_account_update_wifi_approved(c.owner,7,"new","new-password",store,&c)==MA_OK);
  assert(muse_account_configure_noise(c.owner,noise,NULL)==MA_AUTH);
  c.save=false;
  assert(muse_account_update_wifi_approved(c.owner,7,"newer","new-password",store,&c)==MA_STORE);
  assert(muse_account_connect_approved(c.owner,7,"device-fixture",http,store,&c)==MA_APPROVAL);
  muse_account_close(c.owner);
  puts("MUSE_ACCOUNT_CORE_PASS");
}
