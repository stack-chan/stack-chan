# Chatty Stack-chan with ChatGPT

A demo to have a casual conversation with Stack-chan using the ChatGPT API.
In addition to this MOD, you need to run the "Speech Recognition Server" and "Speech Synthesis Server" on separate PCs.

![Program Structure](../../docs/images/architecture.drawio.png)

## Setting up the Speech Recognition Server

- Please refer to https://github.com/meganetaaan/simple-stt-server.
- If set up and started correctly, transcriptions from the microphone will be displayed as follows:

```
$ npm start

> suburi-vosk@0.0.1 start /path/to/simple-stt-server
> node index.js

LOG (VoskAPI:ReadDataFiles():model.cc:213) Decoding params beam=13 max-active=7000 lattice-beam=6
LOG (VoskAPI:ReadDataFiles():model.cc:216) Silence phones 1:2:3:4:5:6:7:8:9:10
LOG (VoskAPI:RemoveOrphanNodes():nnet-nnet.cc:948) Removed 1 orphan nodes.
LOG (VoskAPI:RemoveOrphanComponents():nnet-nnet.cc:847) Removing 2 orphan components.
LOG (VoskAPI:Collapse():nnet-utils.cc:1488) Added 1 components, removed 2
LOG (VoskAPI:ReadDataFiles():model.cc:248) Loading i-vector extractor from model/ivector/final.ie
LOG (VoskAPI:ComputeDerivedVars():ivector-extractor.cc:183) Computing derived variables for iVector extractor
LOG (VoskAPI:ComputeDerivedVars():ivector-extractor.cc:204) Done.
LOG (VoskAPI:ReadDataFiles():model.cc:279) Loading HCLG from model/graph/HCLG.fst
LOG (VoskAPI:ReadDataFiles():model.cc:294) Loading words from model/graph/words.txt
LOG (VoskAPI:ReadDataFiles():model.cc:303) Loading winfo model/graph/phones/word_boundary.int
LOG (VoskAPI:ReadDataFiles():model.cc:310) Loading subtract G.fst model from model/rescore/G.fst
LOG (VoskAPI:ReadDataFiles():model.cc:312) Loading CARPA model from model/rescore/G.carpa
listening on port 8080
Received Info: 録音中 WAVE 'stdin' : Signed 16 bit Little Endian, レート 16000 Hz, モノラル

{ text: 'テスト' }
```

## Setting up the Speech Synthesis Server

- Please refer to https://github.com/VOICEVOX/voicevox_engine.
- In an environment with Docker installed, it is recommended to start from the [Docker Image](https://hub.docker.com/r/voicevox/voicevox_engine).
  - Different images are used for the GPU and CPU versions.
  - To specify your PC's IP address, use the following startup command:

```console
$ docker pull voicevox/voicevox_engine:cpu-ubuntu20.04-latest
$ docker run --rm -it -p '[Your PC's IP address]:50021:50021' voicevox/voicevox_engine:cpu-ubuntu20.04-latest
...
+ exec gosu user /opt/python/bin/python3 ./run.py --use_gpu --voicelib_dir /opt/voicevox_core/ --runtime_dir /opt/onnxruntime/lib --host 0.0.0.0
Warning: cpu_num_threads is set to 0. ( The library leaves the decision to the synthesis runtime )
INFO:     Started server process [1]
INFO:     Waiting for application startup.
reading /tmp/tmp8qiss_tj ... 57
emitting double-array: 100% |###########################################| 
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:50021 (Press CTRL+C to quit)
```

## Writing the host

Write the host for Stack-chan.
At this time, specify the SSID and password to connect Stack-chan to the wireless LAN network.

```console
# Choose target from esp32/m5stack or esp32/m5stack_core2
$ npm run build --target=esp32/m5stack ssid=[Network SSID to use] password=[Network password to use]
$ npm run deploy --target=esp32/m5stack
```

Reference: [Moddable's official documentation](https://github.com/Moddable-OpenSource/moddable/tree/public/examples#wifi-configuration)

## Writing the mod

Write the ChatGPT integration mod.

1. Add your ChatGPT API key to `api-key.js`.

```
const API_KEY = 'YOUR_API_KEY_HERE'
export default API_KEY
```

2. Write the mod with the following command:

```console
$ npm run mod ./mods/chatgpt/manifest.json
```

## Changing character settings (system messages)

TBD
