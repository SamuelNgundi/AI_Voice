// lib/errorMessage.ts
// Turn a raw Houndify / getUserMedia error into a human-friendly message.

interface MaybeError {
    code?: string | number;
    name?: string;
    message?: string;
    error?: string;
    Reason?: string;
    DetailedReason?: string;
}

export function getMediaPermissionMessage(err: unknown): string | null {
    // getUserMedia throws DOMException with a specific `name`. Detect those
    // and return friendly instructions instead of dumping raw JSON.
    const e = err as MaybeError | undefined;
    const name = e && typeof e.name === "string" ? e.name : "";
    switch (name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
            return "Microphone access was denied. Click the lock/permissions icon in your browser's address bar, allow the microphone, then try again.";
        case "NotFoundError":
        case "DevicesNotFoundError":
            return "No microphone was found. Please connect a microphone and reload the page.";
        case "NotReadableError":
        case "TrackStartError":
            return "Your microphone is already in use by another application. Close it and try again.";
        case "OverconstrainedError":
            return "The microphone does not satisfy the required audio settings.";
        case "SecurityError":
            return "Microphone access requires HTTPS or localhost. Open the app over a secure origin.";
        default:
            return null;
    }
}

export function describeHoundifyError(err: unknown): string {
    const e = err as MaybeError | undefined;
    if (!e) return "Unknown error.";
    const code = e.code;
    const message = e.message || e.error || e.Reason || "";
    const detail = e.DetailedReason;
    const parts: string[] = [];
    if (code !== undefined && code !== null) parts.push(`[code ${code}]`);
    if (message) parts.push(String(message));
    if (detail) parts.push(`(${detail})`);
    if (parts.length) return parts.join(" ");
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
