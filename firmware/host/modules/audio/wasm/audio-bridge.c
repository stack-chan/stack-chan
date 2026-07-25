#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <stdlib.h>

void xs_stackchan_wasm_audio_tone(xsMachine* the)
{
	double hz = xsmcToNumber(xsArg(0));
	double duration = xsmcToNumber(xsArg(1));
	double volume = (xsmcArgc > 2) ? xsmcToNumber(xsArg(2)) : 1.0;
	EM_ASM({
		const audioOut = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		if (audioOut && audioOut.tone) {
			audioOut.tone({
				hz: $0,
				duration: $1,
				volume: $2,
			});
		}
	}, hz, duration, volume);
}

void xs_stackchan_wasm_audio_close(xsMachine* the)
{
	EM_ASM({
		const host = stackchanRuntime.host;
		const audioOut = host && host.AudioOut;
		const audioIn = host && host.AudioIn;
		if (audioOut && audioOut.close) audioOut.close();
		if (audioIn && audioIn.close) audioIn.close();
	});
}

void xs_stackchan_wasm_audio_start_record(xsMachine* the)
{
	double duration = xsmcToNumber(xsArg(0));
	EM_ASM({
		let state = stackchanRuntime.state.audioIn;
		if (!state)
			state = stackchanRuntime.state.audioIn = {};
		state.status = 0;
		state.data = new Uint8Array(0);
		state.error = "";
		const host = stackchanRuntime.host;
		const recorder = host && host.AudioIn && host.AudioIn.record;
		Promise.resolve(recorder ? recorder($0) : new ArrayBuffer(0))
			.then((buffer) => {
				state.data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(0);
				state.status = 1;
			})
			.catch((error) => {
				state.error = String(error && error.message ? error.message : error);
				state.status = -1;
			});
	}, duration);
}

void xs_stackchan_wasm_audio_start_play_buffer(xsMachine* the)
{
	uint8_t* buffer = xsmcToArrayBuffer(xsArg(0));
	int length = xsmcGetArrayBufferLength(xsArg(0));
	EM_ASM({
		let state = stackchanRuntime.state.audioOut;
		if (!state)
			state = stackchanRuntime.state.audioOut = {};
		state.status = 0;
		state.error = "";
		const data = new Uint8Array($1);
		data.set(HEAPU8.subarray($0, $0 + $1));
		const host = stackchanRuntime.host;
		const player = host && host.AudioOut && host.AudioOut.play;
		Promise.resolve(player ? player(data.buffer) : false)
			.then((played) => {
				state.status = played ? 1 : -1;
			})
			.catch((error) => {
				state.error = String(error && error.message ? error.message : error);
				state.status = -1;
			});
	}, buffer, length);
}

void xs_stackchan_wasm_audio_play_status(xsMachine* the)
{
	xsmcSetInteger(xsResult, EM_ASM_INT({
		const state = stackchanRuntime.state.audioOut;
		return state && typeof state.status === "number" ? state.status : -1;
	}));
}

void xs_stackchan_wasm_audio_record_status(xsMachine* the)
{
	xsmcSetInteger(xsResult, EM_ASM_INT({
		const state = stackchanRuntime.state.audioIn;
		return state && typeof state.status === "number" ? state.status : -1;
	}));
}

void xs_stackchan_wasm_audio_record_buffer(xsMachine* the)
{
	int length = EM_ASM_INT({
		const state = stackchanRuntime.state.audioIn;
		return state && state.data ? state.data.byteLength : 0;
	});
	if (length <= 0) {
		xsmcSetArrayBuffer(xsResult, NULL, 0);
		return;
	}

	uint8_t* data = malloc(length);
	if (!data)
		xsUnknownError("no memory");
	EM_ASM({
		const state = stackchanRuntime.state.audioIn;
		const data = state && state.data ? state.data : new Uint8Array(0);
		HEAPU8.set(data.subarray(0, $1), $0);
	}, data, length);
	xsmcSetArrayBuffer(xsResult, data, length);
	free(data);
}
