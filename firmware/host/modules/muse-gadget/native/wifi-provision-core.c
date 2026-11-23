#include "wifi-provision-core.h"
#include "account-nvs.h"
#include "account-wifi-driver.h"
#include "sdk-token-store.h"
#include "driver/usb_serial_jtag.h"
#include "nvs.h"
#include "cJSON.h"
#include "../wifi-provision/wire.h"
#include <string.h>
static bool owned, dropping, ready;
static unsigned length;
static char frame[512], ssid[33], password[64];
static void wipe(void *data,size_t n) { volatile unsigned char *p=data; while(n--)*p++=0; }
static void clear(void) { wipe(frame,sizeof(frame)); length=0; dropping=false; }
static bool fallback(void) {
 nvs_handle_t h;
 if(nvs_open("alloywifi",NVS_READWRITE,&h)!=ESP_OK)return false;
 bool ok=nvs_set_str(h,"ssid",ssid)==ESP_OK && nvs_set_str(h,"password",password)==ESP_OK && nvs_commit(h)==ESP_OK;
 nvs_close(h);
 char a[33]={0},b[64]={0};size_t na=sizeof(a),nb=sizeof(b);
 if(ok && nvs_open("alloywifi",NVS_READONLY,&h)==ESP_OK) {
  ok=nvs_get_str(h,"ssid",a,&na)==ESP_OK && nvs_get_str(h,"password",b,&nb)==ESP_OK && !strcmp(a,ssid) && !strcmp(b,password);nvs_close(h);
 } else ok=false;
 wipe(a,sizeof(a));wipe(b,sizeof(b));return ok;
}
static int process(void) {
 if(!strcmp(frame,"CANARY"))return 2;
 bool valid=wifi_wire_parse(frame,length,ssid,password);
 if(!valid)return 3;
 MuseSDKResult sdk=muse_sdk_token_presence();
 MuseAccountWiFiUpdateResult r=muse_account_nvs_update_wifi_approved(ssid,password);
 int result=r==MA_WIFI_UPDATED?1:r==MA_WIFI_ABSENT&&fallback()?4:3;
 if(sdk!=muse_sdk_token_presence())result=3;
 ready=result==1||result==4;
 if(!ready){wipe(ssid,sizeof(ssid));wipe(password,sizeof(password));}
 return result;
}
bool muse_wifi_provision_open(void) {
 if(owned)return false;
 usb_serial_jtag_driver_config_t c={.rx_buffer_size=1024,.tx_buffer_size=256};
 if(usb_serial_jtag_driver_install(&c)!=ESP_OK)return false;
 owned=true;ready=false;clear();return true;
}
int muse_wifi_provision_poll(void) {
 int result=0;unsigned char bytes[32];
 if(!owned)return 3;
 int n=usb_serial_jtag_read_bytes(bytes,sizeof(bytes),0);
 for(int i=0;i<n;i++) {
  if(bytes[i]=='\n') {result=dropping?3:process();clear();break;}
  if(bytes[i]<32||bytes[i]>126||length>=sizeof(frame)-1){clear();dropping=true;}
  else if(!dropping)frame[length++]=(char)bytes[i];
 }
 wipe(bytes,sizeof(bytes));return result;
}
bool muse_wifi_provision_connect(void) {
 bool ok=ready && muse_account_wifi_apply(NULL,ssid,password);
 ready=false;wipe(ssid,sizeof(ssid));wipe(password,sizeof(password));
 return ok;
}
void muse_wifi_provision_close(void) {
 clear();ready=false;wipe(ssid,sizeof(ssid));wipe(password,sizeof(password));
 if(owned){owned=false;usb_serial_jtag_driver_uninstall();}
}
