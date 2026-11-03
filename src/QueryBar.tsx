import { FormEvent, useEffect, useRef } from "react";
import { useAtom } from "jotai";
import { Mic, MicOff, Send, Loader } from "react-feather";
import { Wave } from "@foobar404/wave";
import { recorderAtom, recordingAtom } from "./store";
import styles from "./QueryBar.module.scss";

interface QueryBarProps {
    /** Current value shown in the shared input (typed text or live transcription). */
    value: string;
    /** Called when the user edits the field. Ignored while recording. */
    onChange: (next: string) => void;
    /** Submits the trimmed value through the text pipeline. */
    onSubmit: () => void | Promise<void>;
    /** True while a text query is in flight. */
    pending: boolean;
    /** Hard-disable the whole bar (e.g. config not loaded yet). */
    disabled: boolean;
}

/**
 * A single input that supports both flows:
 *  - Type into it and press Enter / Send to run a text query.
 *  - Click the mic to speak; partial transcriptions stream into the same
 *    field. The voice pipeline sends the request automatically on stop, so
 *    the Send button is disabled while recording.
 */
export default function QueryBar({
    value,
    onChange,
    onSubmit,
    pending,
    disabled,
}: QueryBarProps) {
    const canvasEl = useRef<HTMLCanvasElement>(null);
    const [recorder] = useAtom(recorderAtom);
    const [recording] = useAtom(recordingAtom);

    // Attach the waveform visualization once per recorder instance and
    // tear it down cleanly so it doesn't stack listeners across renders.
    useEffect(() => {
        if (!recorder) return;
        const handleStart = () => {
            if (!canvasEl.current) return;
            try {
                const wave = new Wave(
                    {
                        source: recorder.source as MediaElementAudioSourceNode,
                        context: recorder.audioCtx as AudioContext,
                    },
                    canvasEl.current
                );
                wave.addAnimation(new wave.animations.Lines({ top: true }));
            } catch {
                // Waveform is best-effort polish; never break the recording flow.
            }
        };
        recorder.on("start", handleStart);
        return () => {
            if (typeof recorder.removeListener === "function") {
                recorder.removeListener("start", handleStart);
            }
        };
    }, [recorder]);

    const handleMicClick = () => {
        if (!recorder || disabled || pending) return;
        if (recorder.isRecording()) {
            recorder.stop();
        } else {
            recorder.start();
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed || disabled || pending || recording) return;
        await onSubmit();
    };

    const canSend =
        !disabled && !pending && !recording && value.trim().length > 0;
    const MicIcon = recording ? MicOff : Mic;
    const placeholder = recording
        ? "Listening…"
        : disabled
        ? "Loading configuration…"
        : "Type or tap the mic to speak…";

    return (
        <div className={styles.wrapper}>
            <form
                className={styles.form}
                onSubmit={handleSubmit}
                aria-label="Query"
            >
                <button
                    type="button"
                    className={`${styles.iconButton} ${styles.micButton} ${
                        recording ? styles.recording : ""
                    }`.trim()}
                    onClick={handleMicClick}
                    disabled={disabled || pending}
                    title={recording ? "Stop listening" : "Speak your query"}
                    aria-label={recording ? "Stop listening" : "Start listening"}
                    aria-pressed={recording}
                >
                    <MicIcon
                        size={22}
                        color={recording ? "#f02929" : "currentColor"}
                    />
                </button>

                <input
                    type="text"
                    className={styles.input}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    readOnly={recording}
                    disabled={disabled}
                    placeholder={placeholder}
                    maxLength={500}
                    aria-label="Query text"
                    aria-live="polite"
                />

                <button
                    type="submit"
                    className={`${styles.iconButton} ${styles.sendButton}`.trim()}
                    disabled={!canSend}
                    title={pending ? "Sending…" : "Send query"}
                    aria-label="Send"
                >
                    {pending ? (
                        <Loader size={20} className={styles.spin} />
                    ) : (
                        <Send size={20} />
                    )}
                </button>
            </form>
            <canvas
                ref={canvasEl}
                width={320}
                height={40}
                className={
                    recording ? styles.canvasVisible : styles.canvasHidden
                }
                aria-hidden={!recording}
            />
        </div>
    );
}
