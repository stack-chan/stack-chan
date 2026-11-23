#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <stdio.h>
static void *tracked;
static size_t tracked_size;
static unsigned wiped_frees;
static void checked_free(void *p) {
  if (p && p == tracked) {
    for (size_t i = 0; i < tracked_size; i++) assert(((unsigned char *)p)[i] == 0);
    wiped_frees++; tracked = NULL;
  }
  free(p);
}
#define free checked_free
#include "../pairing-native.c"
#undef free
static bool current_session = true;
static unsigned resets;
bool link_pairing_provisioning_session_valid(uint32_t generation) { return current_session && generation == 7; }
void link_pairing_reset(void) { resets++; }
void link_pairing_init(const char *node, const char *device, const char *mac, const char *version, const char *sdk) {
  assert(!*node && !*device && !*mac && !*version && !sdk);
}
void mbedtls_platform_zeroize(void *p, size_t size) { volatile unsigned char *b = p; while (size--) *b++ = 0; }
static void stage(PairingOwner *p) {
  const char *fixture = "synthetic-fixture-not-a-credential";
  p->staged = malloc(strlen(fixture) + 1);
  strcpy(p->staged, fixture); p->staged_generation = 7;
  tracked = p->staged; tracked_size = strlen(fixture);
}

static bool valid(const char *json) {
  if (!shallow(json)) return false;
  cJSON *root = cJSON_Parse(json);
  bool ok = validProvision(root);
  cJSON_Delete(root);
  return ok;
}
int main(void) {
  const char *scanFixture="[{\"ssid\":\"public-fixture\",\"rssi\":-42,\"secure\":true}]";
  char *scanJSON=scanPayload(scanFixture); assert(scanJSON);
  cJSON *scanRoot=cJSON_Parse(scanJSON); assert(scanRoot);
  assert(!strcmp(cJSON_GetObjectItemCaseSensitive(scanRoot,"type")->valuestring,"wifi_scan_result"));
  assert(cJSON_GetArraySize(cJSON_GetObjectItemCaseSensitive(scanRoot,"networks"))==1);
  cJSON_Delete(scanRoot); cJSON_free(scanJSON);
  scanJSON=scanPayload("[]"); assert(scanJSON); cJSON_free(scanJSON);
  const char *badScans[]={"{}","[] trailing","[{}]",
    "[{\"ssid\":\"x\",\"ssid\":\"y\",\"rssi\":-42,\"secure\":true}]",
    "[{\"ssid\":\"x\",\"rssi\":-42.5,\"secure\":true}]",
    "[{\"ssid\":\"x\",\"rssi\":1,\"secure\":true}]",
    "[{\"ssid\":\"x\",\"rssi\":-128,\"secure\":true}]",
    "[{\"ssid\":\"x\",\"rssi\":-42,\"secure\":1}]",
    "[{\"ssid\":\"x\",\"rssi\":-42,\"secure\":true,\"password\":\"no\"}]",
    "[{\"ssid\":\"x\\u0000y\",\"rssi\":-42,\"secure\":true}]",
    "[{\"ssid\":\"123456789012345678901234567890123\\u3042\",\"rssi\":-42,\"secure\":true}]"};
  for(size_t i=0;i<sizeof(badScans)/sizeof(badScans[0]);i++)assert(!scanPayload(badScans[i]));
  char many[4097]="[";
  for(int i=0;i<17;i++)strcat(many,i ? ",{\"ssid\":\"x\",\"rssi\":-1,\"secure\":false}" : "{\"ssid\":\"x\",\"rssi\":-1,\"secure\":false}");
  strcat(many,"]"); assert(!scanPayload(many));
  memset(many,' ',4096); many[4096]=0; assert(!scanPayload(many));

  assert(exactFinished("{\"action\":\"pairing_client_finished\"}"));
  assert(exactFinished(" \n { \"action\" : \"pairing_client_finished\" } \t"));
  assert(exactFinished("{\"act\\u0069on\":\"pairing_client_fin\\u0069shed\"}"));
  assert(!exactFinished(NULL));
  assert(!exactFinished("{\"action\":\"pairing_client_finished\",\"action\":\"pairing_client_finished\"}"));
  assert(!exactFinished("{\"action\":\"pairing_client_finished\",\"other\":true}"));
  assert(!exactFinished("{\"action\":\"pairing_client_finished\\u0000extra\"}"));
  assert(!exactFinished("{\"action\":\"pairing_client_finished\"} trailing"));
  assert(!exactFinished("[\"pairing_client_finished\"]"));
  PairingOwner publicIdentity = {0};
  strcpy(publicIdentity.node,"stopwatch-public-fixture");
  strcpy(publicIdentity.firmware,"public-test-version");
  strcpy(publicIdentity.sdk,"synthetic-secret-not-for-output");
  cJSON *info=cJSON_CreateObject();
  assert(addPublicIdentity(info,&publicIdentity));
  assert(!strcmp(cJSON_GetObjectItemCaseSensitive(info,"type")->valuestring,"device_info"));
  assert(!strcmp(cJSON_GetObjectItemCaseSensitive(info,"node_id")->valuestring,publicIdentity.node));
  assert(!strcmp(cJSON_GetObjectItemCaseSensitive(info,"version")->valuestring,publicIdentity.firmware));
  assert(cJSON_GetArraySize(info)==3 && !cJSON_GetObjectItemCaseSensitive(info,"sdk_token"));
  cJSON_Delete(info);
  char mac[]="AA:BB:CC:01:02:03", device[64];
  assert(makeDeviceIdentity(mac,device,sizeof(device)) && !strcmp(device,"hatch-link:aa:bb:cc:01:02:03"));
  char invalid_mac[]="AA-BB-CC-01-02-03"; assert(!makeDeviceIdentity(invalid_mac,device,sizeof(device)));
  assert(statusClass("confirm_required")==1 && statusClass("pairing_confirmed")==2);
  assert(statusClass("wifi_connecting")==3 && statusClass("wifi_connected")==3 && statusClass("auth_ok")==3);
  assert(statusClass("wifi_failed")==3 && statusClass("auth_failed")==3 && statusClass("error_storage")==3);
  assert(!statusClass("arbitrary_status"));
  cJSON *scan=cJSON_Parse("{\"action\":\"wifi_scan\"}"); assert(isWifiScan(scan)); cJSON_Delete(scan);
  scan=cJSON_Parse("{\"action\":\"wifi_scan\",\"action\":\"wifi_scan\"}"); assert(!isWifiScan(scan)); cJSON_Delete(scan);
  scan=cJSON_Parse("{\"action\":\"wifi_scan\",\"other\":1}"); assert(!isWifiScan(scan)); cJSON_Delete(scan);
  const char *fixture = "{\"action\":\"provision_v2\",\"ssid\":\"synthetic\",\"password\":\"fixture-only\",\"access_token\":\"fixture\",\"refresh_token\":\"fixture\",\"token_type\":\"device\"}";
  assert(valid(fixture));
  assert(!valid("{}"));
  assert(!valid("{\"action\":\"provision_v2\",\"ssid\":\"synthetic\",\"password\":\"fixture\",\"access_token\":\"fixture\",\"refresh_token\":\"fixture\",\"token_type\":\"owner\"}"));
  cJSON *root = cJSON_Parse(fixture);
  cJSON_AddStringToObject(root, "ota_url", "https://invalid.test");
  assert(!validProvision(root));
  cJSON_DeleteItemFromObject(root, "ota_url");
  cJSON_AddStringToObject(root, "api_url", "https://invalid.test");
  cJSON_AddStringToObject(root, "api_url_v2", "https://invalid.test");
  cJSON_AddStringToObject(root, "noise_host", "invalid.test");
  assert(validProvision(root));
  cJSON_AddStringToObject(root, "ssid", "duplicate");
  assert(!validProvision(root));
  cJSON_Delete(root);
  root = cJSON_Parse(fixture);
  char oversized[2050]; memset(oversized, 'x', sizeof(oversized) - 1); oversized[sizeof(oversized) - 1] = 0;
  cJSON_ReplaceItemInObject(root, "access_token", cJSON_CreateString(oversized));
  assert(!validProvision(root));
  cJSON_Delete(root);
  assert(!shallow("[[[[[0]]]]]"));
  assert(!shallow("{\"access_token\":\"fixture\\u0000suffix\"}"));
  assert(!shallow("{\"action\":\"provision_v2\\u0000other\"}"));
  PairingOwner state = {0};
  stage(&state);
  expireStage(&state); assert(state.staged && !wiped_frees);
  current_session = false;
  expireStage(&state); assert(!state.staged && !state.staged_generation && wiped_frees == 1);
  stage(&state); discard(&state); assert(wiped_frees == 2);
  owner = calloc(1, sizeof(*owner)); stage(owner);
  xs_pairing_destructor(owner);
  assert(!owner && wiped_frees == 3 && resets == 1);
  current_session = true;
  owner=calloc(1,sizeof(*owner));
  owner->staged=malloc(strlen(fixture)+1); strcpy(owner->staged,fixture); owner->staged_generation=7;
  tracked=owner->staged; tracked_size=strlen(fixture);
  assert(!claimAccount(owner,6) && owner->staged);
  AccountOwner *account=claimAccount(owner,7);
  assert(account && account->generation==7 && !owner->staged && wiped_frees==4);
  assert(!claimAccount(owner,7));
  xs_pairing_destructor(owner); current_session=false;
  assert(account->generation==7 && account->core);
  xs_account_destructor(account);
  owner=calloc(1,sizeof(*owner));
  owner->staged=malloc(strlen(fixture)+1); strcpy(owner->staged,fixture); owner->staged_generation=7;
  tracked=owner->staged; tracked_size=strlen(fixture);
  assert(!claimAccount(owner,7) && !owner->staged && wiped_frees==5);
  xs_pairing_destructor(owner);
  puts("PAIRING_NATIVE_VALIDATION_PASS");
  return 0;
}
