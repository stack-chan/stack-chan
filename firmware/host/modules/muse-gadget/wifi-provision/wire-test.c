#include "wire.h"
#include <assert.h>
#include <stdio.h>
static void assert_wiped(cJSON *root) {
  for(cJSON *p=root;p;p=p->next) {
    if(p->valuestring) assert(!*p->valuestring);
    if(p->string) assert(!*p->string);
    assert_wiped(p->child);
  }
}
int main(void) {
  char ssid[33],password[64];
  const char *good="{\"ssid\":\"public-fixture\",\"password\":\"public-password\"}";
  assert(wifi_wire_parse(good,strlen(good),ssid,password));
  assert(!strcmp(ssid,"public-fixture") && !strcmp(password,"public-password"));
  const char *bad[]={
    "{\"ssid\":\"public\\u0000suffix\",\"password\":\"public-password\"}",
    "{\"ssid\":\"public\",\"password\":\"public-password\\u0000suffix\"}",
    "{\"ssid\":\"first\",\"ssid\":\"second\"}",
    "{\"ssid\":\"public\",\"password\":\"public-password\",\"other\":\"fixture\"}",
    "{\"ssid\":\"public\",\"password\":\"short\"}",
    "{\"ssid\":\"public\\n\",\"password\":\"public-password\"}",
    "{\"ssid\":{},\"password\":\"public-password\"}",
    "{\"other\":[[[[\"fixture\"]]]]}",
    "{\"ssid\":\"public\",\"password\":\"public-password\"} trailing"
  };
  for(unsigned i=0;i<sizeof(bad)/sizeof(*bad);i++) {
    memset(ssid,42,sizeof(ssid));memset(password,42,sizeof(password));
    assert(!wifi_wire_parse(bad[i],strlen(bad[i]),ssid,password));
    for(unsigned n=0;n<sizeof(ssid);n++)assert(ssid[n]==0);
    for(unsigned n=0;n<sizeof(password);n++)assert(password[n]==0);
  }
  cJSON *tree=cJSON_Parse("{\"unknown\":[\"fixture\",{\"nested\":\"fixture\"}],\"ssid\":\"one\",\"ssid\":\"two\"}");
  assert(tree);wifi_wire_wipe_json(tree);assert_wiped(tree);cJSON_Delete(tree);
  char oversize[513];memset(oversize,'x',sizeof(oversize));
  assert(!wifi_wire_parse(oversize,sizeof(oversize),ssid,password));
  puts("WIFI_WIRE_VALIDATION_PASS");
}
