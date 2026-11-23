#pragma once
#include "cJSON.h"
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

static void wifi_wire_wipe(void *data,size_t n) {
  volatile unsigned char *p=data; while(n--)*p++=0;
}
static void wifi_wire_wipe_json(cJSON *root) {
  for (cJSON *p=root;p;p=p->next) {
    if (p->valuestring) wifi_wire_wipe(p->valuestring,strlen(p->valuestring));
    if (p->string) wifi_wire_wipe(p->string,strlen(p->string));
    wifi_wire_wipe_json(p->child);
  }
}
static bool wifi_wire_shape(const char *text,size_t length) {
  if (!text || !length || length>511 || memchr(text,0,length)) return false;
  unsigned depth=0; bool quoted=false,escape=false;
  for (size_t i=0;i<length;i++) {
    if (i+6<=length && !memcmp(text+i,"\\u0000",6)) return false;
    char c=text[i];
    if (quoted) {
      if (escape) escape=false;
      else if (c=='\\') escape=true;
      else if (c=='"') quoted=false;
    } else if (c=='"') quoted=true;
    else if (c=='{' || c=='[') { if (++depth>4) return false; }
    else if (c=='}' || c==']') { if (!depth) return false; --depth; }
  }
  return !depth && !quoted;
}
static bool wifi_wire_parse(const char *text,size_t length,char out_ssid[33],char out_password[64]) {
  wifi_wire_wipe(out_ssid,33); wifi_wire_wipe(out_password,64);
  if (!wifi_wire_shape(text,length)) return false;
  const char *end=NULL;
  cJSON *root=cJSON_ParseWithLengthOpts(text,length,&end,false);
  while (end && end<text+length && (*end==' ' || *end=='\t' || *end=='\r' || *end=='\n')) end++;
  cJSON *a=cJSON_GetObjectItemCaseSensitive(root,"ssid"),*b=cJSON_GetObjectItemCaseSensitive(root,"password");
  bool valid=end==text+length && cJSON_IsObject(root) && cJSON_GetArraySize(root)==2 &&
    cJSON_IsString(a) && cJSON_IsString(b) && a->valuestring && b->valuestring &&
    strlen(a->valuestring)>0 && strlen(a->valuestring)<=32 &&
    strlen(b->valuestring)>=8 && strlen(b->valuestring)<=63 &&
    !strpbrk(a->valuestring,"\r\n") && !strpbrk(b->valuestring,"\r\n");
  if (valid) { strcpy(out_ssid,a->valuestring); strcpy(out_password,b->valuestring); }
  wifi_wire_wipe_json(root); cJSON_Delete(root);
  return valid;
}
