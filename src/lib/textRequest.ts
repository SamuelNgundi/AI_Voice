// lib/textRequest.ts
// Calls our backend's /houndifyText proxy. The client key never leaves the
// server, so we can't reuse window.Houndify.TextRequest from the browser SDK
// (it needs to sign requests). Everything happens server-side.

export interface TextQueryOptions {
    query: string;
    conversationState?: HoundifyConversationState | null;
    userId?: string;
    latitude?: number;
    longitude?: number;
    language?: string;
    signal?: AbortSignal;
}

export interface TextQueryFailure {
    ok: false;
    status: number;
    error: string;
    details?: unknown;
    rawBody?: string;
}

export interface TextQuerySuccess {
    ok: true;
    response: HoundifyResponse;
}

export type TextQueryResult = TextQuerySuccess | TextQueryFailure;

export async function textQuery(opts: TextQueryOptions): Promise<TextQueryResult> {
    try {
        const res = await fetch("/houndifyText", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: opts.query,
                conversationState: opts.conversationState ?? null,
                userId: opts.userId,
                latitude: opts.latitude,
                longitude: opts.longitude,
                language: opts.language,
            }),
            signal: opts.signal,
        });
        // Read the body once as text, then try to parse as JSON. If parsing
        // fails (e.g., CRA proxy returned an HTML error page or empty body),
        // still surface the raw text so the UI shows *something* useful.
        const rawText = await res.text().catch(() => "");
        let body: unknown = null;
        try {
            body = rawText ? JSON.parse(rawText) : null;
        } catch {
            body = null;
        }

        if (!res.ok) {
            const errField =
                body && typeof body === "object" && "error" in body
                    ? String((body as { error?: unknown }).error)
                    : null;
            return {
                ok: false,
                status: res.status,
                error: errField || `Text request failed (${res.status})`,
                details: body ?? undefined,
                rawBody: body ? undefined : rawText || undefined,
            };
        }
        return { ok: true, response: body as HoundifyResponse };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            error:
                err instanceof Error
                    ? err.message
                    : "Network error while contacting the text endpoint.",
        };
    }
}
