#include "xsmc.h"

#ifdef mxInstrument
extern void modInstrumentMachineEnd(xsMachine* the);
#endif

void xs_face_rendering_benchmark_take_instrumentation_control(xsMachine* the)
{
#ifdef mxInstrument
	modInstrumentMachineEnd(the);
#else
	xsUnknownError("face rendering benchmark requires instrumentation");
#endif
}
