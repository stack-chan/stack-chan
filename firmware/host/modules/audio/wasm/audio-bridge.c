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
		if (audioOut && audioOut.close) audioOut.close();
	});
}

void xs_stackchan_wasm_audio_start_record(xsMachine* the)
{
	double duration = xsmcToNumber(xsArg(0));
	int id = EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		try { return input ? input.startRecord($0) : 0; }
		catch (_) { return -1; }
	}, duration);
	if (id < 0) xsUnknownError("Browser microphone failed to start");
	xsmcSetInteger(xsResult, id);
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
	int id = xsmcToInteger(xsArg(0));
	xsmcSetInteger(xsResult, EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		return input ? input.recordStatus($0) : -1;
	}, id));
}

void xs_stackchan_wasm_audio_record_buffer(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	int limit = xsmcToInteger(xsArg(1));
	int length = EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		const data = input && input.recordBuffer($0);
		return data instanceof ArrayBuffer ? data.byteLength : 0;
	}, id);
	if (length <= 0 || length > limit) xsUnknownError("Invalid browser recording buffer");
	void* buffer = xsmcSetArrayBuffer(xsResult, NULL, length);
	int copied = EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		const data = input && input.recordBuffer($2);
		if (!(data instanceof ArrayBuffer) || data.byteLength !== $1) return 0;
		HEAPU8.set(new Uint8Array(data), $0);
		return 1;
	}, buffer, length, id);
	if (!copied) xsUnknownError("Browser recording was released before copying");
}

void xs_stackchan_wasm_audio_record_details(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	char details[2048];
	int copied = EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		const text = input ? JSON.stringify(input.recordDetails($0)) : '{"quiet":true,"error":{"code":"CLOSED","message":"Microphone bridge is closed"}}';
		if (lengthBytesUTF8(text) >= $2) return 0;
		stringToUTF8(text, $1, $2);
		return 1;
	}, id, details, sizeof(details));
	if (!copied) xsUnknownError("Invalid browser recording details");
	xsmcSetString(xsResult, details);
}

void xs_stackchan_wasm_audio_record_available(xsMachine* the)
{
	xsmcSetBoolean(xsResult, EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		try { return input && input.recordAvailable ? !!input.recordAvailable() : 0; }
		catch (_) { return 0; }
	}));
}

void xs_stackchan_wasm_audio_stop_record(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	int failed = EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		try { if (input) input.stopRecord($0); return 0; }
		catch (_) { return 1; }
	}, id);
	if (failed) xsUnknownError("Browser microphone failed to stop");
}

void xs_stackchan_wasm_audio_release_record(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	int failed = EM_ASM_INT({
		const input = stackchanRuntime.host && stackchanRuntime.host.AudioIn;
		try { if (input) input.releaseRecord($0); return 0; }
		catch (_) { return 1; }
	}, id);
	if (failed) xsUnknownError("Browser microphone failed to release");
}
