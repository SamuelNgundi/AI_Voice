// lib/initVoiceRequest.ts
import { RequestHandlers } from "./types";

export interface VoiceRequestLocation {
    latitude: number;
    longitude: number;
}

// Last-resort coarse fallback (Nairobi) used only when the server could not
// resolve a location for the client's IP (private network, VPN, outage).
const FALLBACK_LOCATION: VoiceRequestLocation = {
    latitude: -1.292066,
    longitude: 36.821945,
};

export default function initVoiceRequest(
    clientId: string,
    recorder: HoundifyAudioRecorder,
    conversationState: HoundifyConversationState | null,
    handlers: RequestHandlers,
    location?: VoiceRequestLocation | null
): HoundifyVoiceRequest {
    if (!clientId) {
        throw new Error("Houndify client ID was not provided by the server.");
    }

    if (!window.Houndify || !window.Houndify.VoiceRequest) {
        throw new Error(
            "Houndify SDK is not loaded. Check your network connection and the script tag in public/index.html."
        );
    }

    // Server-resolved IP coordinates when available; static fallback keeps
    // location-dependent domains (weather, nearby) working otherwise.
    const coords = location ?? FALLBACK_LOCATION;

    const voiceRequest = new window.Houndify.VoiceRequest({
        clientId,
        authURL: "/api/houndifyAuth",

        //REQUEST INFO JSON
        //See https://houndify.com/reference/RequestInfo
        requestInfo: {
            UserID: "samuelwngundi02@gmail.com",
            Latitude: coords.latitude,
            Longitude: coords.longitude,
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
