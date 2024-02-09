declare module "elevenlabsstreamer" {
    import type AudioOut from "pins/audioout"
    type ElevenLabsStreamerOptions = {
        key: string,
        voice?: string,
        latency?: number,
        format?: string,
        text: string,
        model?: string,
        voice_settings?: {
            similarity_boost: number,
            stability: number,
            style?: number,
            use_speaker_boost?: boolean
        }
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
