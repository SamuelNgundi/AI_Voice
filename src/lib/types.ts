// lib/types.ts
export interface RequestHandlers {
    onResponse(response: HoundifyResponse, info: unknown): void;
    onTranscriptionUpdate(transcript: HoundifyTranscriptionUpdate): void;
    onError(err: unknown, info: unknown): void;
}
