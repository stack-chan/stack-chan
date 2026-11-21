#include "../../host/modules/muse-gadget/native/receive.h"
#include "../../host/modules/muse-gadget/native/lifetime.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
typedef struct { void *the; int object; MuseLifetime life; uint8_t failure_reason; MuseReceive rx; } MuseRecord;
typedef void (*Callback)(void *, void *, uint8_t *, uint16_t);
static Callback queued;
static void *queued_ref;
static uint8_t *copied;
static uint16_t copied_size;
static int delivered_type, calls;
static size_t delivered_size;
static uint8_t delivered_first;
#define xsBeginHost(the) (void)(the)
#define xsEndHost(the) (void)(the)
#define xsTry if (1)
#define xsCatch else
#define xsmcVars(n) (void)(n)
#define xsVar(n) (n)
#define xsID(name) (name)
#define xsInteger(n) (n)
#define xsmcSetArrayBuffer(slot, ptr, length) do { (void)(slot); delivered_size = (length); delivered_first = delivered_size ? *(const uint8_t *)(ptr) : 0; } while(0)
#define xsCall2(object, id, type, slot) do { (void)(object); (void)(id); (void)(slot); delivered_type = (type); calls++; } while(0)
static int modMessagePostToMachine(void *the, uint8_t *bytes, uint16_t size, Callback callback, void *ref) {
  (void)the; assert(!queued);copied=malloc(size ? size : 1);assert(copied);memcpy(copied,bytes,size);copied_size=size;queued=callback;queued_ref=ref;return 0;
}
/* INSERT_PRODUCTION_DELIVERY */
static void flush(void) { Callback cb=queued;queued=NULL;cb(NULL,queued_ref,copied,copied_size);free(copied);copied=NULL; }
static MuseRecord *record(void) { MuseRecord *r=calloc(1,sizeof(*r));assert(r);r->life.references=1;memset(r->rx.payload,0x5a,sizeof(r->rx.payload));return r; }
int main(void) {
  for(size_t size=65534;size<=65535;size++) {
    MuseRecord *r=record();post(r,2,size);assert(copied_size==size);r->rx.payload[0]=0;flush();assert(delivered_type==2 && delivered_size==size && delivered_first==0x5a);release(r);
  }
  MuseRecord *r=record();post(r,2,65536);assert(copied_size==0);flush();assert(delivered_type==3 && delivered_size==1 && delivered_first==23);release(r);
  r=record();post(r,1,0);flush();assert(delivered_type==1 && delivered_size==0);release(r);
  r=record();post(r,2,65535);assert(muse_owner_close(&r->life));release(r);int previous=calls;flush();assert(calls==previous);
  puts("native delivery boundary tests passed");
}
