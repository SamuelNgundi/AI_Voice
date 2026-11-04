import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./App.module.scss";
import initVoiceRequest from "./lib/initVoiceRequest";
import QueryBar from "./QueryBar";
import ChatLog from "./ChatLog";
import Bubbles from "./Bubbles";
import { useAtom } from "jotai";
import { recorderAtom, recordingAtom, chatLogAtom } from "./store";
import {
    describeHoundifyError,
    getMediaPermissionMessage,
} from "./lib/errorMessage";
import { textQuery } from "./lib/textRequest";

import startSound from "./audio/start.wav";
import stopSound from "./audio/stop.wav";
import playSound from "./lib/playSound";

const sources = {
    start: startSound,
    stop: stopSound,
};

// Language code for spoken responses.
const SPEECH_LANG = "en";

// Coarse location resolved server-side from the client's IP and delivered
// with the Houndify config (no geolocation permission prompt). Omitted when
// the server couldn't resolve one; initVoiceRequest has a static fallback.
interface AssistantLocation {
    latitude: number;
    longitude: number;
}

const say = (text: string) => {
    if (!text) return;
    // Fresh utterance per call; reusing a single SpeechSynthesisUtterance
    // across speak() calls is unreliable in most browsers.
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
};

const cancelSpeech = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
};

// Extract the primary result + spoken text from either a voice or a text
// response. Voice SDKs put results in `AllResults[0]`; the text endpoint
// uses `Result` (or `AllResults[0]` on some configurations).
const extractResult = (
    response: HoundifyResponse
): { result: HoundifyResult | null; spoken: string } => {
    const result =
        response.AllResults?.[0] ??
        ("Result" in response ? (response.Result as HoundifyResult) : null) ??
        null;
    if (!result) return { result: null, spoken: "" };
    const spoken =
        result["SpokenResponseLong"] || result["SpokenResponse"] || "";
    return { result, spoken };
};

function App() {
    // Persistent conversation state so follow-up queries keep context.
    const conversationState = useRef<HoundifyConversationState | null>(null);
    const voiceRequest = useRef<HoundifyVoiceRequest | null>(null);
    const clientIdRef = useRef<string | null>(null);
    const locationRef = useRef<AssistantLocation | null>(null);

    // Single shared field value used for BOTH flows: typed manually or
    // overwritten by streaming voice transcription. The ref mirrors the
    // latest value so stable callbacks (onResponse, handleTextSubmit) can
    // read it without adding state to their deps array.
    const [query, setQueryState] = useState("");
    const queryRef = useRef<string>("");
    const setQuery = useCallback((next: string) => {
        queryRef.current = next;
        setQueryState(next);
    }, []);

    // Any errors from the voice request will be stored here
    const [error, setError] = useState("");
    const [clientId, setClientId] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const [, setRecorder] = useAtom(recorderAtom);
    const [recording, _setRecording] = useAtom(recordingAtom);
    const [, setChatLog] = useAtom(chatLogAtom);

    const setRecording = useCallback(
        (value: boolean) => {
            playSound(sources[value ? "start" : "stop"]);
            _setRecording(value);
        },
        [_setRecording]
    );

    const onResponse = useCallback(
        (response: HoundifyResponse) => {
            const { result, spoken } = extractResult(response);
            if (!result) return;
            conversationState.current =
                (result.ConversationState as HoundifyConversationState) ?? null;

            const userText = queryRef.current;
            if (spoken) say(spoken);

            if (userText || spoken) {
                setChatLog((prev) => [
                    ...prev,
                    {
                        id: Date.now(),
                        userText,
                        assistantText: spoken,
                        timestamp: Date.now(),
                    },
                ]);
            }

            // Clear the shared field after a completed voice turn so the
            // user sees a fresh input for the next turn.
            setQuery("");
        },
        [setChatLog, setQuery]
    );

    const onTranscriptionUpdate = useCallback(
        (transcript: HoundifyTranscriptionUpdate) => {
            setQuery(transcript.PartialTranscript);
        },
        [setQuery]
    );

    const onError = useCallback((err: unknown) => {
        setError(describeHoundifyError(err));
    }, []);

    // Text query flow: POST /houndifyText using the shared field value,
    // update conversation state, append to the chat log, speak the response.
    const handleTextSubmit = useCallback(async () => {
        const trimmed = queryRef.current.trim();
        if (!trimmed) return;
        setError("");
        cancelSpeech();
        setPending(true);
        // Optimistically clear so a slow response doesn't leave the query
        // sitting in the input looking unsent. Chat log still shows it.
        setQuery("");

        try {
            const outcome = await textQuery({
                query: trimmed,
                conversationState: conversationState.current,
                // IP-derived coords when the server provided them; the
                // server ignores non-numeric values, so null is safe.
                latitude: locationRef.current?.latitude,
                longitude: locationRef.current?.longitude,
            });

            if (!outcome.ok) {
                // Surface the Houndify error type + reason so auth failures
                // are debuggable from the UI, not just the browser console.
                const details = outcome.details as
                    | {
                          type?: string;
                          exception?: unknown;
                          Reason?: string;
                          DetailedReason?: string;
                          rawBody?: string;
                      }
                    | undefined;
                const exception = details?.exception as
                    | {
                          Reason?: string;
                          DetailedReason?: string;
                          Message?: string;
                      }
                    | string
                    | undefined;
                const exceptionMsg =
                    typeof exception === "string"
                        ? exception
                        : exception?.DetailedReason ||
                          exception?.Reason ||
                          exception?.Message ||
                          "";
                let upstreamMsg = "";
                if (details?.rawBody) {
                    try {
                        const parsed = JSON.parse(details.rawBody);
                        upstreamMsg =
                            parsed?.DetailedReason || parsed?.Reason || "";
                    } catch {
                        /* ignore */
                    }
                }
                const reason =
                    exceptionMsg ||
                    upstreamMsg ||
                    details?.DetailedReason ||
                    details?.Reason ||
                    outcome.rawBody?.slice(0, 200) ||
                    outcome.error;
                setError(
                    `Text query failed (${outcome.status}${
                        details?.type ? `, ${details.type}` : ""
                    }): ${reason}`
                );
                setChatLog((prev) => [
                    ...prev,
                    {
                        id: Date.now(),
                        userText: trimmed,
                        assistantText: "",
                        timestamp: Date.now(),
                    },
                ]);
                return;
            }

            const { result, spoken } = extractResult(outcome.response);
            if (result?.ConversationState) {
                conversationState.current =
                    result.ConversationState as HoundifyConversationState;
            }
            if (spoken) say(spoken);
            setChatLog((prev) => [
                ...prev,
                {
                    id: Date.now(),
                    userText: trimmed,
                    assistantText: spoken,
                    timestamp: Date.now(),
                },
            ]);
        } finally {
            setPending(false);
        }
    }, [setChatLog, setQuery]);

    useEffect(() => {
        const controller = new AbortController();

        const loadHoundifyConfig = async () => {
            try {
                const response = await fetch("/api/houndifyConfig", {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(
                        `Unable to load Houndify configuration (${response.status}).`
                    );
                }

                const config: unknown = await response.json();
                if (
                    typeof config !== "object" ||
                    config === null ||
                    !("clientId" in config) ||
                    typeof config.clientId !== "string" ||
                    !config.clientId.trim()
                ) {
                    throw new Error(
                        "The server returned an invalid Houndify configuration."
                    );
                }

                // Best-effort coarse location piggybacked on the config
                // response; simply stays null when unavailable.
                const { latitude, longitude } = config as {
                    latitude?: unknown;
                    longitude?: unknown;
                };
                if (typeof latitude === "number" && typeof longitude === "number") {
                    locationRef.current = { latitude, longitude };
                }

                clientIdRef.current = config.clientId;
                setClientId(config.clientId);
            } catch (error) {
                if (
                    error instanceof DOMException &&
                    error.name === "AbortError"
                ) {
                    return;
                }
                setError(
                    error instanceof Error
                        ? error.message
                        : "Unable to load Houndify configuration."
                );
            }
        };

        loadHoundifyConfig();
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!window.Houndify || !window.Houndify.AudioRecorder) {
            setError(
                "Houndify SDK failed to load. Check your network connection or the script tag in public/index.html."
            );
            return;
        }

        const audioRecorder = new window.Houndify.AudioRecorder();
        setRecorder(audioRecorder);

        audioRecorder.on("start", () => {
            // Barge-in: stop the assistant from talking over the user.
            cancelSpeech();
            setRecording(true);
            setError("");
            const id = clientIdRef.current;
            if (!id) {
                setError("Houndify configuration has not loaded yet.");
                audioRecorder.stop();
                return;
            }
            try {
                voiceRequest.current = initVoiceRequest(
                    id,
                    audioRecorder,
                    conversationState.current,
                    {
                        onResponse,
                        onTranscriptionUpdate,
                        onError,
                    },
                    locationRef.current
                );
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Unable to initialize the Houndify voice request."
                );
                audioRecorder.stop();
            }
        });

        audioRecorder.on("data", (data) => {
            voiceRequest.current?.write(data);
        });

        audioRecorder.on("end", () => {
            voiceRequest.current?.end();
            voiceRequest.current = null;
            setRecording(false);
        });

        audioRecorder.on("error", (err) => {
            voiceRequest.current?.abort();
            voiceRequest.current = null;
            // Prefer a friendly microphone-permission message when the
            // underlying error came from getUserMedia.
            const friendly = getMediaPermissionMessage(err);
            setError(friendly ?? describeHoundifyError(err));
            setRecording(false);
        });

        return () => {
            try {
                if (audioRecorder.isRecording()) audioRecorder.stop();
            } catch {
                // Recorder already torn down or in a bad state; ignore.
            }
            cancelSpeech();
        };
    }, [
        setRecorder,
        setRecording,
        onResponse,
        onTranscriptionUpdate,
        onError,
    ]);

    return (
        <div
            className={`${styles.root} ${recording ? styles.listening : ""}`.trim()}
        >
            {/* Ambient, decorative layers: glossy orb hero + rising bubbles. */}
            <div className={styles.orb} aria-hidden="true" />
            <div className={styles.orbFade} aria-hidden="true" />
            <Bubbles active={recording} />

            <div className={styles.content}>
                <h1 className={styles.h1}>Voice Assistant AI</h1>
                <p className={styles.subtitle}>
                    Ask anything, by voice or text. Your words are the interface.
                </p>
                <QueryBar
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleTextSubmit}
                    pending={pending}
                    disabled={!clientId}
                />
                <ChatLog />
                {error && (
                    <div className={styles.errorContainer}>
                        <div>{error}</div>
                        <button
                            type="button"
                            className={styles.errorDismiss}
                            onClick={() => setError("")}
                        >
                            Dismiss
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
