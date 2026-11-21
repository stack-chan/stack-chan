#include "xsmc.h"
#include <stddef.h>
#if defined(ESP32)
extern void *gemini_native_create_diagnostic(const char *, const char *, const void *, size_t, int, int *);
extern int gemini_native_diagnostic(void *);
extern int gemini_native_transport_diagnostic(void *);
extern int gemini_native_read(void *, void *, size_t);
extern void gemini_native_close(void *);
void xs_gemini_native_reader_destructor(void *p) { gemini_native_close(p); }
void xs_gemini_native_reader_constructor(xsMachine *the) {
  if(xsmcTypeOf(xsArg(0))!=xsStringType || xsmcTypeOf(xsArg(1))!=xsStringType)
    xsTypeError("Speech native string arguments");
  int timeout=xsmcToInteger(xsArg(3));
  const char *url=xsmcToString(xsArg(0));
  const char *key=xsmcToString(xsArg(1));
  void *body; xsUnsignedValue size;
  xsmcGetBufferReadable(xsArg(2),&body,&size);
  int reason=0;
  void *p=gemini_native_create_diagnostic(url,key,body,size,timeout,&reason);
  if(!p) xsUnknownError("Speech native unavailable (%d)",reason);
  xsmcSetHostData(xsThis,p);
}
void xs_gemini_native_reader_read(xsMachine *the) {
  void *buffer; xsUnsignedValue size;
  xsmcGetBufferWritable(xsArg(0),&buffer,&size);
  if(size!=4096) xsRangeError("Speech native buffer size");
  xsmcSetInteger(xsResult,gemini_native_read(xsmcGetHostDataValidate(xsThis, (void *)xs_gemini_native_reader_destructor),buffer,size));
}
void xs_gemini_native_reader_transport_diagnostic(xsMachine *the) {
  xsmcSetInteger(xsResult,gemini_native_transport_diagnostic(xsmcGetHostDataValidate(xsThis, (void *)xs_gemini_native_reader_destructor)));
}
void xs_gemini_native_reader_diagnostic(xsMachine *the) {
  xsmcSetInteger(xsResult,gemini_native_diagnostic(xsmcGetHostDataValidate(xsThis, (void *)xs_gemini_native_reader_destructor)));
}
void xs_gemini_native_reader_close(xsMachine *the) {
  void *p=xsmcGetHostDataValidate(xsThis, (void *)xs_gemini_native_reader_destructor);
  xsmcSetHostData(xsThis,NULL);
  gemini_native_close(p);
}

#else
void xs_gemini_native_reader_destructor(void *p) { (void)p; }
void xs_gemini_native_reader_constructor(xsMachine *the) { xsUnknownError("Speech native transport unsupported"); }
void xs_gemini_native_reader_read(xsMachine *the) { xsUnknownError("Speech native transport unsupported"); }
void xs_gemini_native_reader_close(xsMachine *the) { (void)the; }
void xs_gemini_native_reader_diagnostic(xsMachine *the) { xsmcSetInteger(xsResult,0); }
void xs_gemini_native_reader_transport_diagnostic(xsMachine *the) { xsmcSetInteger(xsResult,0); }
#endif
