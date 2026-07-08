#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <string.h>

void xs_stackchan_wasm_camera_start(xsMachine* the)
{
	int width = (xsmcArgc > 0) ? xsmcToInteger(xsArg(0)) : 0;
	int height = (xsmcArgc > 1) ? xsmcToInteger(xsArg(1)) : 0;
	int useBrowserCamera = (xsmcArgc > 2) ? xsmcToBoolean(xsArg(2)) : 0;
	EM_ASM({
		const camera = globalThis.Host && globalThis.Host.Camera;
		if (!camera || !camera.start)
			return;
		const options = {};
		options.width = $0;
		options.height = $1;
		options.imageType = "rgb565le";
		options.useBrowserCamera = !!$2;
		Promise.resolve(camera.start(options)).catch((error) => {
			console.warn("[bridge] Host.Camera.start failed", error);
		});
	}, width, height, useBrowserCamera);
}

void xs_stackchan_wasm_camera_stop(xsMachine* the)
{
	EM_ASM({
		globalThis.Host && globalThis.Host.Camera && globalThis.Host.Camera.stop && globalThis.Host.Camera.stop();
	});
}

void xs_stackchan_wasm_camera_capture(xsMachine* the)
{
	int width = (xsmcArgc > 0) ? xsmcToInteger(xsArg(0)) : 96;
	int height = (xsmcArgc > 1) ? xsmcToInteger(xsArg(1)) : 96;
	int length = EM_ASM_INT({
		const camera = globalThis.Host && globalThis.Host.Camera;
		let frame;
		try {
			const options = {};
			options.width = $0;
			options.height = $1;
			options.imageType = "rgb565le";
			frame = camera && camera.capture ? camera.capture(options) : undefined;
		}
		catch (error) {
			console.warn("[bridge] Host.Camera.capture failed", error);
			return 0;
		}
		if (!frame || frame.imageType !== "rgb565le" || !(frame.buffer instanceof ArrayBuffer))
			return 0;
		const data = new Uint8Array(frame.buffer);
		const state = {};
		state.width = frame.width | 0;
		state.height = frame.height | 0;
		state.data = data;
		globalThis.__stackchanCameraCapture = state;
		return data.byteLength;
	}, width, height);
	if (length <= 0) {
		xsmcSetUndefined(xsResult);
		return;
	}

	xsmcVars(1);
	xsmcSetNewObject(xsResult);
	xsmcSetInteger(xsVar(0), EM_ASM_INT({
		const state = globalThis.__stackchanCameraCapture;
		return state ? state.width : 0;
	}));
	xsmcSet(xsResult, xsID("width"), xsVar(0));
	xsmcSetInteger(xsVar(0), EM_ASM_INT({
		const state = globalThis.__stackchanCameraCapture;
		return state ? state.height : 0;
	}));
	xsmcSet(xsResult, xsID("height"), xsVar(0));
	xsmcSetString(xsVar(0), "rgb565le");
	xsmcSet(xsResult, xsID("imageType"), xsVar(0));
	void* buffer = xsmcSetArrayBuffer(xsVar(0), NULL, length);
	EM_ASM({
		const state = globalThis.__stackchanCameraCapture;
		if (state && state.data)
			HEAPU8.set(state.data.subarray(0, $1), $0);
	}, buffer, length);
	xsmcSet(xsResult, xsID("buffer"), xsVar(0));
}
