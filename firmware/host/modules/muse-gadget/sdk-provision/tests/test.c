#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "sdk-provision-core.c"
static const char *input;static size_t offset;static int stores,installs,removed;
int usb_serial_jtag_driver_install(const usb_serial_jtag_driver_config_t *c){assert(c->rx_buffer_size==256);installs++;return ESP_OK;}
void usb_serial_jtag_driver_uninstall(void){removed++;}
int usb_serial_jtag_read_bytes(void *out,size_t cap,int ticks){assert(!ticks);size_t n=strlen(input+offset);if(n>cap)n=cap;memcpy(out,input+offset,n);offset+=n;return (int)n;}
MuseSDKResult muse_sdk_token_store_if_absent_approved(const char *s){stores++;assert(strlen(s)==48&&!strncmp(s,"mgst_",5));return MSDK_OK;}
static int run(const char *s){input=s;offset=0;assert(muse_sdk_provision_open());int code=0;for(int i=0;i<16&&!code;i++)code=muse_sdk_provision_poll();muse_sdk_provision_close();for(unsigned i=0;i<sizeof(frame);i++)assert(!frame[i]);return code;}
int main(void){
 assert(run("CANARY\n")==2&&stores==0);
 assert(run("garbage\n")==3&&stores==0);
 assert(run("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n")==3&&stores==0);
 assert(run("SDK:mgst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n")==1&&stores==1);
 input="SDK:mgst_AAA";offset=0;assert(muse_sdk_provision_open());assert(muse_sdk_provision_poll()==0);muse_sdk_provision_close();assert(!length&&!owned);for(unsigned i=0;i<sizeof(frame);i++)assert(!frame[i]);
 assert(installs==removed);puts("MUSE_SDK_USB_MOCK_PASS");
}
