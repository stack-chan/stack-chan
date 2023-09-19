declare module "elevenlabsstreamer" {
    import type AudioOut from "pins/audioout"
    type ElevenLabsStreamerOptions = {
        key: string,
        voice?: string,
        latency?: number,
        text: string,
        audio: {
            out: AudioOut,
            sampleRate?: number,
            stream: number,
        },
        onPlayed?: (buffer: ArrayBuffer) => void
        onReady?: (state: boolean) => void
        onError?: (message: string) => void
        onDone?: () => void
    }
    export default class ElevenLabsStreamer {
        constructor(options: ElevenLabsStreamerOptions);
        close(): void;
    }
}
