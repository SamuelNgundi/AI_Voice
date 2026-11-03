// Type declarations for the Houndify Browser SDK, which is loaded as a global
// via a <script> tag in public/index.html (see window.Houndify).

declare module "houndify-browser" {
    // Nothing to export; this module shim exists only so TypeScript is happy
    // if anyone ever tries to `import` the SDK instead of using the global.
}

interface HoundifyConversationState {
    [key: string]: unknown;
}

interface HoundifyResult {
    SpokenResponse?: string;
    SpokenResponseLong?: string;
    ConversationState?: HoundifyConversationState;
    AllResults?: unknown;
    ResultInfo?: { Sections?: unknown[] };
    [key: string]: unknown;
}

interface HoundifyResponse {
    AllResults?: HoundifyResult[];
    Result?: HoundifyResult;
    [key: string]: unknown;
}

interface HoundifyTranscriptionUpdate {
    PartialTranscript: string;
    [key: string]: unknown;
}

interface HoundifyVoiceRequestOptions {
    clientId: string;
    authURL: string;
    requestInfo?: {
        UserID?: string;
        Latitude?: number;
        Longitude?: number;
        [key: string]: unknown;
    };
    conversationState?: HoundifyConversationState | null;
    sampleRate?: number;
    enableVAD?: boolean;
    onTranscriptionUpdate?: (transcript: HoundifyTranscriptionUpdate) => void;
    onResponse?: (response: HoundifyResponse, info: unknown) => void;
    onError?: (err: unknown, info: unknown) => void;
}

interface HoundifyVoiceRequest {
    write(data: ArrayBuffer | Int8Array | Uint8Array): void;
    end(): void;
    abort(): void;
}

interface HoundifyAudioRecorderEventMap {
    start: [];
    end: [];
    data: [ArrayBuffer];
    error: [unknown];
}

interface HoundifyAudioRecorder {
    sampleRate: number;
    source: AudioNode | null;
    audioCtx: AudioContext | null;
    start(): void;
    stop(): void;
    isRecording(): boolean;
    on<K extends keyof HoundifyAudioRecorderEventMap>(
        event: K,
        listener: (...args: HoundifyAudioRecorderEventMap[K]) => void
    ): void;
    removeListener<K extends keyof HoundifyAudioRecorderEventMap>(
        event: K,
        listener: (...args: HoundifyAudioRecorderEventMap[K]) => void
    ): void;
}

interface HoundifyAudioRecorderConstructor {
    new (): HoundifyAudioRecorder;
}

interface HoundifyVoiceRequestConstructor {
    new (options: HoundifyVoiceRequestOptions): HoundifyVoiceRequest;
}

interface HoundifyGlobal {
    AudioRecorder: HoundifyAudioRecorderConstructor;
    VoiceRequest: HoundifyVoiceRequestConstructor;
}

interface Window {
    Houndify?: HoundifyGlobal;
}
