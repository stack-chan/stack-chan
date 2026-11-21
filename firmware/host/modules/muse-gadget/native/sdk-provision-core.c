#include "sdk-provision-core.h"
#include "sdk-token-store.h"
#include "driver/usb_serial_jtag.h"
#include <string.h>
static bool owned, dropping;
static unsigned length;
static char frame[64];
static void wipe(void *data,unsigned n) { volatile unsigned char *p=data;while(n--)*p++=0; }
static void reset(void) { wipe(frame,sizeof(frame));length=0;dropping=false; }
bool muse_sdk_provision_open(void) {
 if(owned)return false;
 usb_serial_jtag_driver_config_t c={.rx_buffer_size=256,.tx_buffer_size=256};
 if(usb_serial_jtag_driver_install(&c)!=ESP_OK)return false;
 owned=true;reset();return true;
}
int muse_sdk_provision_poll(void) {
 if(!owned)return 3;
 unsigned char bytes[32];
 int n=usb_serial_jtag_read_bytes(bytes,sizeof(bytes),0),result=0;
 if(n<0){wipe(bytes,sizeof(bytes));return 3;}
 for(int i=0;i<n;i++) {
  if(bytes[i]=='\n') {
   if(dropping)result=3;
   else if(length==6&&!memcmp(frame,"CANARY",6))result=2;
   else if(length==52&&!memcmp(frame,"SDK:",4)) {
    frame[length]=0;
    MuseSDKResult r=muse_sdk_token_store_if_absent_approved(frame+4);
    result=r==MSDK_OK?1:r==MSDK_EXISTS?4:3;
   } else result=3;
   reset();
   break;
  }
  if(bytes[i]<32||bytes[i]>126||length>=sizeof(frame)-1){reset();dropping=true;}
  else if(!dropping)frame[length++]=(char)bytes[i];
 }
 wipe(bytes,sizeof(bytes));return result;
}
void muse_sdk_provision_close(void) { reset();if(owned){owned=false;usb_serial_jtag_driver_uninstall();} }
