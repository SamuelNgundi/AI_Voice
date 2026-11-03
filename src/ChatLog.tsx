import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import { chatLogAtom } from "./store";
import styles from "./ChatLog.module.scss";

export default function ChatLog() {
    const [log] = useAtom(chatLogAtom);
    const endRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to the newest turn when the log grows.
    useEffect(() => {
        if (endRef.current) {
            endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
        }
    }, [log.length]);

    if (!log.length) return null;

    return (
        <div className={styles.chatLog} aria-live="polite">
            {log.map((entry) => (
                <div key={entry.id} className={styles.turn}>
                    {entry.userText && (
                        <div className={`${styles.bubble} ${styles.user}`}>
                            {entry.userText}
                        </div>
                    )}
                    {entry.assistantText && (
                        <div
                            className={`${styles.bubble} ${styles.assistant}`}
                        >
                            {entry.assistantText}
                        </div>
                    )}
                </div>
            ))}
            <div ref={endRef} />
        </div>
    );
}
