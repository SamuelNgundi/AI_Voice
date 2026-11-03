import { atom } from "jotai";

export const recorderAtom = atom<HoundifyAudioRecorder | null>(null);
export const recordingAtom = atom(false);

export interface ChatEntry {
    id: number;
    userText: string;
    assistantText: string;
    timestamp: number;
}

export const chatLogAtom = atom<ChatEntry[]>([]);
