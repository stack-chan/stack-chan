#include "../account-wifi-driver.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static int mode=1,level,stores,configs,connections,fail;
int esp_log_level_get(const char *tag) { assert(!strcmp(tag,"wifi") || !strcmp(tag,"wifi_init")); return level; }
int esp_wifi_get_mode(wifi_mode_t *p) { *p=mode; return 0; }
int esp_wifi_set_storage(int storage) { assert(storage==WIFI_STORAGE_RAM); stores++; return fail==1 ? -1 : 0; }
int esp_wifi_set_config(int interface,wifi_config_t *config) {
  assert(interface==WIFI_IF_STA && !strcmp((char *)config->sta.ssid,"fixture") && !strcmp((char *)config->sta.password,"fixture-only"));
  configs++; return fail==2 ? -1 : 0;
}
int esp_wifi_connect(void) { connections++; return 0; }
const char *WIFI_EVENT="wifi-event";
static esp_event_handler_t handler;
static void *handlerArg;
static int registers,unregisters,registrationFailure,unregistrationFailure;
int esp_event_handler_instance_register(esp_event_base_t b,int32_t id,esp_event_handler_t fn,void *arg,esp_event_handler_instance_t *out) {
  assert(b==WIFI_EVENT && id==WIFI_EVENT_STA_DISCONNECTED); registers++;
  if(registrationFailure)return -1;
  handler=fn;handlerArg=arg;*out=(void *)1;return 0;
}
int esp_event_handler_instance_unregister(esp_event_base_t b,int32_t id,esp_event_handler_instance_t instance) {
  assert(b==WIFI_EVENT && id==WIFI_EVENT_STA_DISCONNECTED && instance==(void *)1);unregisters++;return unregistrationFailure ? -1 : 0;
}
int main(void) {
  level=3; assert(!muse_account_wifi_apply(NULL,"fixture","fixture-only")); level=0;
  mode=0; assert(!muse_account_wifi_apply(NULL,"fixture","fixture-only")); mode=1;
  assert(!stores && !configs && !connections);
  fail=1; assert(!muse_account_wifi_apply(NULL,"fixture","fixture-only")); assert(!configs && !connections);
  fail=2; assert(!muse_account_wifi_apply(NULL,"fixture","fixture-only")); assert(!connections);
  fail=0; assert(muse_account_wifi_apply(NULL,"fixture","fixture-only"));
  assert(stores==3 && configs==2 && connections==1);
  registrationFailure=1; assert(!muse_account_wifi_watch());registrationFailure=0;
  uint32_t token=muse_account_wifi_watch();assert(token && !muse_account_wifi_watch());
  assert(!strcmp(muse_account_wifi_reason(token),"none"));
  const unsigned reasons[]={WIFI_REASON_NO_AP_FOUND,WIFI_REASON_AUTH_FAIL,WIFI_REASON_HANDSHAKE_TIMEOUT,WIFI_REASON_BEACON_TIMEOUT,999};
  const char *names[]={"ap_not_found","auth","handshake","timeout","other"};
  for(unsigned i=0;i<5;i++) {
    wifi_event_sta_disconnected_t event={.reason=reasons[i]};handler(handlerArg,WIFI_EVENT,WIFI_EVENT_STA_DISCONNECTED,&event);
    assert(!strcmp(muse_account_wifi_reason(token),names[i]));
  }
  void *oldArg=handlerArg;
  assert(muse_account_wifi_unwatch(token) && muse_account_wifi_unwatch(token));assert(unregisters==1);
  uint32_t next=muse_account_wifi_watch();assert(next && next!=token);
  wifi_event_sta_disconnected_t oldEvent={.reason=WIFI_REASON_AUTH_FAIL};handler(oldArg,WIFI_EVENT,WIFI_EVENT_STA_DISCONNECTED,&oldEvent);
  assert(!strcmp(muse_account_wifi_reason(next),"none"));
  assert(muse_account_wifi_unwatch(token) && unregisters==1);
  assert(muse_account_wifi_unwatch(next) && unregisters==2 && registers==3);
  token=muse_account_wifi_watch();assert(token);unregistrationFailure=1;
  assert(!muse_account_wifi_unwatch(token));assert(!muse_account_wifi_watch());
  handler(handlerArg,WIFI_EVENT,WIFI_EVENT_STA_DISCONNECTED,&oldEvent);
  assert(!strcmp(muse_account_wifi_reason(token),"none"));
  unregistrationFailure=0;assert(muse_account_wifi_unwatch(token));
  token=muse_account_wifi_watch();assert(token);assert(muse_account_wifi_unwatch(token));
  puts("MUSE_ACCOUNT_WIFI_MOCK_PASS");
}
