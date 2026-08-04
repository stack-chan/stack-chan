# AudioDuplex AEC waveform capture

This hardware test records three synchronized 16 kHz mono signals from one
CoreS3 run:

- the raw microphone signal before AEC (the AEC-off equivalent);
- the delayed post-volume speaker reference used by AEC;
- the AEC output.

Using one run avoids room-noise and timing differences between separate AEC-on
and AEC-off recordings.

The probe uses AW88298 attenuation of 60 dB and restores 96 dB attenuation
before transferring the capture. The device also waits three seconds before
starting the audible probe.

From `firmware/`, run:

```sh
source "$HOME/.local/share/xs-dev-export.sh"
UPLOAD_PORT=/dev/ttyACM0 npm run test:audio-duplex-waveform:capture
```

For an audible double-talk capture, use:

```sh
UPLOAD_PORT=/dev/ttyACM0 npm run test:audio-duplex-waveform:doubletalk
```

This profile uses 48 dB attenuation, 12 dB louder than the quiet profile. It
waits ten seconds, plays the probe for about 10.5 seconds, and records about
8.5 seconds after a two-second AEC warmup. Start speaking at a normal volume
after the first two seconds of probe audio and continue until the audio stops.
The same 96 dB post-capture attenuation and silent-firmware restore apply.

The command asks for confirmation, deploys the capture firmware, and creates
WAV files plus an HTML waveform report under `dist/aec-waveforms/`. The report
contains synchronized raw-microphone and AEC-output waveforms, audio players,
RMS levels, energy reduction, and reference-correlated echo suppression.

If report generation is interrupted after the device data has been saved, it
can be repeated without replaying the probe:

```sh
npm run test:audio-duplex-waveform:render -- dist/aec-waveforms/<capture>/xsbug-raw.log
```
