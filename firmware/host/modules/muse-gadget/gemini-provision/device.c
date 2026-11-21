#include "xsmc.h"
#include "xsHost.h"
#include "provision-core.h"
void xs_gemini_key_input_open(xsMachine *the) {
  if (!gemini_key_input_open()) xsUnknownError("USB input unavailable");
}
void xs_gemini_key_input_poll(xsMachine *the) { xsmcSetInteger(xsResult, gemini_key_input_poll()); }
void xs_gemini_key_input_close(xsMachine *the) { (void)the; gemini_key_input_close(); }
