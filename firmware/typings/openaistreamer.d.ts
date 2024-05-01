declare module "openaistreamer" {
    import type AudioOut from "pins/audioout"
    type OpenAIStreamerOptions = {
        input: string,
        key: string,
        model: string,
        voice: string,
        response_format?: string,
        speed?: number
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
    export default class OpenAIStreamer {
        constructor(options: OpenAIStreamerOptions);
        close(): void;
    }
}
