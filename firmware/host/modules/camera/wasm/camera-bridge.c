#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <string.h>
#include <stdlib.h>

void xs_stackchan_wasm_camera_start(xsMachine* the)
{
	int width = (xsmcArgc > 0) ? xsmcToInteger(xsArg(0)) : 0;
	int height = (xsmcArgc > 1) ? xsmcToInteger(xsArg(1)) : 0;
	int useBrowserCamera = (xsmcArgc > 2) ? xsmcToBoolean(xsArg(2)) : 0;
	EM_ASM({
		if (stackchanRuntime.state.cameraStart) stackchanRuntime.state.cameraStart.active = false;
		const state = {};
		state.status = 0;
		state.active = true;
		stackchanRuntime.state.cameraError = "";
		stackchanRuntime.state.cameraStart = state;
		const camera = stackchanRuntime.host && stackchanRuntime.host.Camera;
		if (!camera || !camera.start) {
			state.status = -1;
			stackchanRuntime.state.cameraError = "Browser camera is unavailable";
			return;
		}
		const options = {};
		options.width = $0;
		options.height = $1;
		options.imageType = "rgb565le";
		options.useBrowserCamera = !!$2;
		Promise.resolve().then(() => { if (state.active) return camera.start(options); }).then(
			() => {
				if (state.active) state.status = 1;
			},
			(error) => {
				if (state.active) {
					state.status = -1;
					stackchanRuntime.state.cameraError = String(error && error.message || error).slice(0, 256);
				}
			}
		);
	}, width, height, useBrowserCamera);
}

void xs_stackchan_wasm_camera_start_status(xsMachine* the)
{
	xsmcSetInteger(xsResult, EM_ASM_INT({
		const state = stackchanRuntime.state.cameraStart;
		return state && typeof state.status === "number" ? state.status : -1;
	}));
}

void xs_stackchan_wasm_camera_stop(xsMachine* the)
{
	int failed = EM_ASM_INT({
		const state = stackchanRuntime.state.cameraStart;
		if (state) { state.active = false; state.status = -1; }
		stackchanRuntime.state.cameraCapture = undefined;
		const camera = stackchanRuntime.host && stackchanRuntime.host.Camera;
		try { if (camera && camera.stop) camera.stop(); }
		catch (error) { stackchanRuntime.state.cameraError = String(error && error.message || error).slice(0, 256); return 1; }
		return 0;
	});
	if (failed) xsUnknownError("Browser camera failed to stop");
}

void xs_stackchan_wasm_camera_availability(xsMachine* the)
{
	xsmcSetInteger(xsResult, EM_ASM_INT({
		const camera = stackchanRuntime.host && stackchanRuntime.host.Camera;
		if (!camera) return 0;
		const availability = camera.availability ? camera.availability() : "native";
		return availability === "unavailable" ? 0 : availability === "simulated" ? 1 : 2;
	}));
}

void xs_stackchan_wasm_camera_error(xsMachine* the)
{
	char* message = (char*)EM_ASM_PTR({
		const message = String(stackchanRuntime.state.cameraError || "").slice(0, 256);
		const size = lengthBytesUTF8(message) + 1;
		const pointer = _malloc(size);
		if (pointer) stringToUTF8(message, pointer, size);
		return pointer;
	});
	xsmcSetString(xsResult, message ? message : "Camera error");
	free(message);
}

void xs_stackchan_wasm_camera_capture(xsMachine* the)
{
	int width = (xsmcArgc > 0) ? xsmcToInteger(xsArg(0)) : 96;
	int height = (xsmcArgc > 1) ? xsmcToInteger(xsArg(1)) : 96;
	int length = EM_ASM_INT({
		stackchanRuntime.state.cameraCapture = undefined;
		const camera = stackchanRuntime.host && stackchanRuntime.host.Camera;
		let frame;
		try {
			const options = {};
			options.width = $0;
			options.height = $1;
			options.imageType = "rgb565le";
			frame = camera && camera.capture ? camera.capture(options) : undefined;
		}
		catch (error) {
			stackchanRuntime.state.cameraError = String(error && error.message || error).slice(0, 256);
			return -1;
		}
		if (!frame) return 0;
		if (frame.imageType !== "rgb565le" || !(frame.buffer instanceof ArrayBuffer) || !Number.isInteger(frame.width) || frame.width < 1 || frame.width > 320 || !Number.isInteger(frame.height) || frame.height < 1 || frame.height > 240 || frame.buffer.byteLength !== frame.width * frame.height * 2) return -1;
		const data = new Uint8Array(frame.buffer);
		const state = {};
		state.width = frame.width | 0;
		state.height = frame.height | 0;
		state.data = data;
		state.source = frame.source === "simulated" ? 1 : 2;
		stackchanRuntime.state.cameraCapture = state;
		return data.byteLength;
	}, width, height);
	if (length < 0) xsUnknownError("Browser camera returned an invalid image or capture failed");
	if (length == 0) {
		xsmcSetUndefined(xsResult);
		return;
	}

	xsmcVars(1);
	xsmcSetNewObject(xsResult);
	xsmcSetInteger(xsVar(0), EM_ASM_INT({
		const state = stackchanRuntime.state.cameraCapture;
		return state ? state.width : 0;
	}));
	xsmcSet(xsResult, xsID("width"), xsVar(0));
	xsmcSetInteger(xsVar(0), EM_ASM_INT({
		const state = stackchanRuntime.state.cameraCapture;
		return state ? state.height : 0;
	}));
	xsmcSet(xsResult, xsID("height"), xsVar(0));
	xsmcSetString(xsVar(0), "rgb565le");
	xsmcSet(xsResult, xsID("imageType"), xsVar(0));
	xsmcSetString(xsVar(0), EM_ASM_INT({ return stackchanRuntime.state.cameraCapture.source; }) == 1 ? "simulated" : "native");
	xsmcSet(xsResult, xsID("source"), xsVar(0));
	void* buffer = xsmcSetArrayBuffer(xsVar(0), NULL, length);
	EM_ASM({
		const state = stackchanRuntime.state.cameraCapture;
		if (state && state.data)
			HEAPU8.set(state.data.subarray(0, $1), $0);
		stackchanRuntime.state.cameraCapture = undefined;
	}, buffer, length);
	xsmcSet(xsResult, xsID("buffer"), xsVar(0));
}
