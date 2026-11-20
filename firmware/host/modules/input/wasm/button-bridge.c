#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>

void xs_stackchan_wasm_button_read(xsMachine* the)
{
	int index = (xsmcArgc > 0) ? xsmcToInteger(xsArg(0)) : -1;
	int pressed = EM_ASM_INT({
		const names = "abc";
		const buttons = stackchanRuntime.host && stackchanRuntime.host.Button;
		if (($0 < 0) || ($0 >= names.length) || !buttons || !buttons.read)
			return 0;
		return buttons.read(names[$0]) ? 1 : 0;
	}, index);
	xsmcSetInteger(xsResult, pressed);
}
