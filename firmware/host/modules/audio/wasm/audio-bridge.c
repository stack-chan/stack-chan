#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <stdlib.h>

void xs_stackchan_wasm_audio_start_tone(xsMachine* the)
{
	double hz = xsmcToNumber(xsArg(0));
	double duration = xsmcToNumber(xsArg(1));
	double volume = xsmcToNumber(xsArg(2));
	int id = EM_ASM_INT({
		const output = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		try { return output && output.startTone ? output.startTone({hz: $0, duration: $1, volume: $2}) : 0; }
		catch (_) { return -1; }
	}, hz, duration, volume);
	if (id < 0) xsUnknownError("Browser tone failed to start");
	xsmcSetInteger(xsResult, id);
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
	double volume = xsmcToNumber(xsArg(1));
	int limit = xsmcToInteger(xsArg(2));
	if (length <= 0 || length > limit) xsUnknownError("Invalid browser audio buffer");
	int id = EM_ASM_INT({
		const output = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		if (!output || !output.startPlayBuffer) return 0;
		try {
			const data = new Uint8Array($1);
			data.set(HEAPU8.subarray($0, $0 + $1));
			return output.startPlayBuffer(data.buffer, $2);
		} catch (_) { return -1; }
	}, buffer, length, volume);
	if (id < 0) xsUnknownError("Browser audio buffer failed to start");
	xsmcSetInteger(xsResult, id);
}

void xs_stackchan_wasm_audio_play_status(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	xsmcSetInteger(xsResult, EM_ASM_INT({
		const output = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		return output ? output.playStatus($0) : -1;
	}, id));
}

void xs_stackchan_wasm_audio_play_details(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	char details[2048];
	int copied = EM_ASM_INT({
		const output = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		const text = output ? JSON.stringify(output.playDetails($0)) : '{"quiet":true,"error":{"code":"CLOSED","message":"Audio output bridge is closed"}}';
		if (lengthBytesUTF8(text) >= $2) return 0;
		stringToUTF8(text, $1, $2);
		return 1;
	}, id, details, sizeof(details));
	if (!copied) xsUnknownError("Invalid browser playback details");
	xsmcSetString(xsResult, details);
}

void xs_stackchan_wasm_audio_play_available(xsMachine* the)
{
	xsmcSetBoolean(xsResult, EM_ASM_INT({
		const output = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		try { return output && output.playAvailable ? !!output.playAvailable() : 0; }
		catch (_) { return 0; }
	}));
}

void xs_stackchan_wasm_audio_stop_play(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	int failed = EM_ASM_INT({
		const output = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		try { if (output) output.stopPlay($0); return 0; }
		catch (_) { return 1; }
	}, id);
	if (failed) xsUnknownError("Browser audio output failed to stop");
}

void xs_stackchan_wasm_audio_release_play(xsMachine* the)
{
	int id = xsmcToInteger(xsArg(0));
	int failed = EM_ASM_INT({
		const output = stackchanRuntime.host && stackchanRuntime.host.AudioOut;
		try { if (output) output.releasePlay($0); return 0; }
		catch (_) { return 1; }
	}, id);
	if (failed) xsUnknownError("Browser audio output failed to release");
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
