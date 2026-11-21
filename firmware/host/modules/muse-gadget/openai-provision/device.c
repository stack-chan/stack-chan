#include "xsmc.h"
#include "xsHost.h"
#include "provision-core.h"
void xs_openai_key_input_open(xsMachine *the) {
  if (!openai_key_input_open()) xsUnknownError("USB input unavailable");
}
void xs_openai_key_input_poll(xsMachine *the) { xsmcSetInteger(xsResult, openai_key_input_poll()); }
void xs_openai_key_input_close(xsMachine *the) { (void)the; openai_key_input_close(); }
