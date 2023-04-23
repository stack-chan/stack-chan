# TTS (Text-to-Speech) Auto-Generation Command Description

[日本語](./README_ja.md) | English

## generate-speech-google (for [Google Text-to-Speech](https://cloud.google.com/text-to-speech))

* Preparation  
    First, you need a Google account. If you don't have one, please create one.  
    Refer to Google's [authentication start guide](https://cloud.google.com/docs/authentication/getting-started) to create a project and service account, and create and obtain a key in JSON format. Also, search for "Cloud Text-to-Speech API" in the search bar, open it, and enable it.  
    Copy the acquired key file to the `stack-chan\firmware\scripts` directory and rename it to `key.json`.  
    The usage fee is free up to 1 million characters per month. If you use more than that, it will be $16 for every additional 1 million characters. New users will receive $300 in free credit.  
    For more information, please refer to the [Text-to-Speech documentation](https://cloud.google.com/text-to-speech).

* Unique options for generate-speech-google  
  * --voicename: Specify the text-to-speech voice.  
     The default is ja-JP-Wavenet-A (Japanese) or en-US-Wavenet-F (English).  
     Normally, it generates a speech file in Japanese. However, if the file name without the extension ends with "_en" or if you specify EN with the --lang option, it will be in English.  
     Corresponds to the parameters 'name' and 'languageCode' (generated from 'name').
  * --sample: Sampling rate.  
    The default is 44100 (44.1KHz). However, if you perform a pitch shift with pitch-shift.js, the final output file's sampling rate will always be 44.1KHz, regardless of the settings.
    Corresponds to the parameter 'sampleRateHertz'.
  * --speed: Text-to-speech speed.  
    The default is 0, which corresponds to the parameter 'speakingRate'.
  * --pitch: Pitch shift by Google TTS.  
    The default is 0, which corresponds to the parameter 'pitch'.  
    (The effect may not be very noticeable or the sound may be distorted, depending on the speech.)
  * --lang: Switch between default text-to-speech voices JA or EN.  
    Normally, JA or EN is identified by the end of the file name without the extension. However, you can use this option if you want to intentionally make an English input file be read in Japanese.
  * --shift: Pitch shift by pitch-shift.js.  
    Ranges from 0.5 (1 octave lower) to 2 (1 octave higher), with 1 being normal (Google TTS output as is).  
    If omitted, the value of 'SynthProps.shift' in the input file will be used. However, if it is also undefined, it will be 1.5.  
    Note that if this pitch shift is enabled, the output file's sampling rate will always be 44.1KHz, regardless of the Google TTS settings.

* Common options  
  * --input: Input file name.  
    If omitted, it will be 'speeches.js' in the current directory if it exists.  
    If not, it will be './stackchan/assets/sounds/speeches_ja.js' (assuming execution in the 'stack-chan/firmware' directory).
  * --output: Output directory.  
    If omitted, it will be the 'assets' directory under the directory where the input file is located, if it exists.  
    If there is no 'assets' directory, it will be the same directory as the input file.

* Example of execution  
    `~/stack-chan/firmware$ npm run generate-speech-google -- --input=./mods/monologue/speeches_monologue.js --output=./mods/monologue/assets`
    Note: When specifying options, add ' -- ' after the command as shown above.

## generate-speech-coqui (for [CoquiTTS](https://github.com/coqui-ai/TTS#readme))

* Preparation  
  You need to install CoquiTTS and start the TTS-Server.  
  Follow the [installation instructions](https://github.com/coqui-ai/TTS#install-tts) to install it. Since it is a Python module, you can install it with `pip install TTS`. However, it seems that it doesn't install well on Windows, so if you want to generate audio files on Windows, you will need to use a TTS-Server running on another Linux environment, etc., via the network.  
  Once the installation is complete, execute the following command to start the TTS-Server:  
  `$ tts-server --port 8080 --model_name tts_models/ja/kokoro/tacotron2-DDC`

* Unique options for generate-speech-coqui  
  * --host: Hostname or IP address of the host where the TTS-Server is running.  
    Usually, it is read from stackchan/manifest_local.json, but if you specify it here, it will take precedence. You need to specify it in one of the two places.
  * --port: Port of the TTS-Server.  
    Usually, it is read from stackchan/manifest_local.json, but if you specify it here, it will take precedence. You need to specify it in one of the two places.
  * --shift: Pitch shift by pitch-shift.js.  
    Ranges from 0.5 (1 octave lower) to 2 (1 octave higher), with 1 being normal (CoquiTTS output as is).  
    If omitted, the value of 'SynthProps.shift' in the input file will be used. However, if it is also undefined, it will be 1.5.  
    Note that if this pitch shift is enabled, the output file's sampling rate will be 44.1KHz (CoquiTTS itself outputs at 22.05KHz).

* Common options  
  * --input: Input file name.  
    If omitted, it will be 'speeches.js' in the current directory if it exists.  
    If not, it will be './stackchan/assets/sounds/speeches_ja.js' (assuming execution in the 'stack-chan/firmware' directory).
  * --output: Output directory.  
    If omitted, it will be the 'assets' directory under the directory where the input file is located, if it exists.  
    If there is no 'assets' directory, it will be the same directory as the input file.

* Example of execution  
    `~/stack-chan/firmware$ npm run generate-speech-coqui -- --input=./mods/monologue/speeches_monologue.js --output=./mods/monologue/assets`
    Note: When specifying options, add ' -- ' after the command as shown above.

## generate-speech-voicevox  (For [VOICEVOX](https://voicevox.hiroshiba.jp/))

* Preparation  
    Download and install from the [VOICEVOX website](https://voicevox.hiroshiba.jp/) (Windows/MAC/Linux versions available)  
    Once the installation is complete, launch VOICEVOX (the engine running simultaneously will be used; there seems to be a [method to launch only the engine from the command line](https://qiita.com/yamanohappa/items/b75d069e3cb0708d8709))
* Unique options for generate-speech-voicevox  
  * --list Character list output  
    If no value is specified, a list of all characters will be displayed and then the process will exit  
    If a SpeakerId is specified, only the character with that Id will be displayed  
    To specify a character with the --speaker option, use the SpeakerId displayed here  
  * --host Hostname or IP address of the VOICEVOX engine  
    If omitted, the default is 127.0.0.1 when VOICEVOX is launched normally
  * --port Port number of the VOICEVOX engine  
    If omitted, the default is 50021 when VOICEVOX is launched normally  
  * --speaker Specify character  
    Specify the SpeakerId of the character you want to speak  
    If omitted, the default is SpeakerId:1 Zundamon (Amaama)  
  * --speed Speaking speed  
    Specify the speaking speed, ranging from 0.5 to 2. The default value when omitted is 1
  * --pitch Pitch  
    Adjust the pitch of the voice, ranging from -0.15 to 0.15. The default value when omitted is 0  
  * --intonation Intonation  
    Specify the strength of the voice intonation, ranging from 0 to 2. The default value when omitted is 1  
  * --sample Sampling rate  
    The sampling rate of the output audio file. The default value when omitted is 11025 (11.025KHz)  
* Common options
  * --input Input file name  
    If omitted, it will default to speeches.js in the current directory if present  
    If not present, it will default to ./stackchan/assets/sounds/speeches_ja.js (assuming execution in the ~/stack-chan/firmware directory)
  * --output Output directory  
    If omitted, it will default to the assets directory under the input file's directory if it exists  
    If the assets directory does not exist, it will default to the same directory as the input file  
* Execution example
     ~/stack-chan/firmware$ npm run generate-speech-voicevox -- --input=./mods/monologue/speeches_monologue.js --output=./mods/monologue/assets
     ※ If you want to specify options, add ' -- ' after the command as shown above

## About License

Please check and use the terms of use for VOICEVOX and each voice library.

* VOICEVOX: Credit notation is required to indicate that VOICEVOX has been used.  
  For example, if you embed the voice of "Zundamon" in your app and distribute it, you need to include "VOICEVOX: Zundamon" on the app's introduction screen. ([Zundamon Voice Source Usage Agreement](https://zunko.jp/con_ongen_kiyaku.html))
  The details of the terms of use may vary depending on the voice library you use, so please check the [list of characters on the VICEVOX website](https://voicevox.hiroshiba.jp/#characters).