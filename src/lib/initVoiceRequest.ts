// lib/initVoiceRequest.ts
import { RequestHandlers } from "./types";

export default function initVoiceRequest(
    clientId: string,
    recorder: HoundifyAudioRecorder,
    conversationState: HoundifyConversationState | null,
    handlers: RequestHandlers
): HoundifyVoiceRequest {
    if (!clientId) {
        throw new Error("Houndify client ID was not provided by the server.");
    }

    if (!window.Houndify || !window.Houndify.VoiceRequest) {
        throw new Error(
            "Houndify SDK is not loaded. Check your network connection and the script tag in public/index.html."
        );
    }

    const voiceRequest = new window.Houndify.VoiceRequest({
        clientId,
        authURL: "/houndifyAuth",

        //REQUEST INFO JSON
        //See https://houndify.com/reference/RequestInfo
        requestInfo: {
            UserID: "samuelwngundi02@gmail.com",
            //See https://www.latlong.net/ for your own coordinates
            Latitude: -1.292066,
            Longitude: 36.821945,
        },

        //Pass the current ConversationState stored from previous queries
        //See https://www.houndify.com/docs#conversation-state
        conversationState,

        //Sample rate of input audio
        sampleRate: recorder.sampleRate,

        //Enable Voice Activity Detection
        //Default: true
        enableVAD: true,

        //Partial transcript, response and error handlers
        onTranscriptionUpdate: handlers.onTranscriptionUpdate,
        onResponse: function (response, info) {
            recorder.stop();
            handlers.onResponse(response, info);
        },
        onError: function (err, info) {
            recorder.stop();
            handlers.onError(err, info);
        },
    });

    return voiceRequest;
}
