/*
 * Stack-chan voice — Moddable native module.
 *
 * Wraps the clean-room formant synth (8 kHz, 16-bit mono PCM). Feed it the
 * frontend's supported hiragana/ASCII via say(), or raw romanized "koe"
 * notation via koe(), then pull PCM frames
 * with read() and hand them to AudioOut (or any I2S/DAC sink).
 *
 *   import StackchanVoice from "stackchanvoice";
 *   const v = new StackchanVoice(StackchanVoice.Cute, dictionaryResource);
 *   v.say("こんにちは");
 *   const buf = new Int16Array(256);
 *   let n;
 *   while ((n = v.read(buf.buffer)) > 0) sink.enqueue(buf.subarray(0, n));
 */

class StackchanVoice @ "xs_scv_destructor" {
	// voice: 0 = normal, 1 = cute (optional; default 0)
	constructor(voice, dictionaryResource) @ "xs_scv";

	// select a voice preset at any time (0 normal, 1 cute)
	setVoice(voice) @ "xs_scv_setVoice";

	// set an utterance from UTF-8 Japanese text using the external dictionary
	say(text, speed) @ "xs_scv_say";

	// set an utterance from raw romanized "koe" notation (accent ' + breaks / ? ...).
	// '#' note annotations sing the next mora at a pitch/length (see readme):
	//   v.koe("#C4,450ki#C4ra#G4ki#G4ra#A4hi#A4ka#G4,900ru");  // きらきらひかる♪
	koe(koe, speed) @ "xs_scv_koe";

	// render the next PCM into an Int16 ArrayBuffer; returns the sample count
	// written, 0 when the current utterance is finished.
	read(buffer) @ "xs_scv_read";

	// render 24 kHz PCM using the streaming 3x linear converter. The converter
	// state is kept per instance, so arbitrary buffer lengths stay continuous.
	read24(buffer) @ "xs_scv_read24";
}

StackchanVoice.sampleRate = 8000;
StackchanVoice.outputSampleRate = 24000;
StackchanVoice.Normal = 0;
StackchanVoice.Cute = 1;

export default StackchanVoice;
