/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { readFile } from "fs/promises";
import { join } from "path";
import { load } from "yaml-js";

import { neteaseTranslations, type TranslationTrack } from "./netease";
import { romanizeJapanese } from "./romanization";

export type Playback = {
    connected: boolean;
    message: string;
    title: string;
    artist: string;
    artwork: string;
    playing: boolean;
    duration: number;
    position: number;
    volume: number;
    trackId: string;
    sampledAt: number;
    mode: string;
};

export type Action = "playpause" | "previous" | "next" | "seek" | "volume";

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function number(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

let token = "";
let tokenChecked = 0;
let tokenRead: Promise<string> | undefined;

async function getToken(): Promise<string> {
    if (tokenRead) return tokenRead;
    if (Date.now() - tokenChecked < 5000) return token;
    tokenRead = (async () => {
        const config = record(load(await readFile(join(app.getPath("appData"), "sh.cider.dotnet", "spa-config.yml"), "utf8")));
        const tokens = record(config.connectivity).apiTokens;
        const entries = Array.isArray(tokens) ? tokens.map(record) : [];
        // Prefer the existing client token, never the most recently installed plugin token.
        const selected = entries.find(t => /equicord|equibop/i.test(text(t.name)))
            ?? entries.find(t => /discord/i.test(text(t.name)))
            ?? entries.find(t => Array.isArray(t.scopes) && t.scopes.includes("lyrics") && t.scopes.includes("playback"))
            ?? entries.at(-1);
        token = selected ? text(selected.token) : "";
        tokenChecked = Date.now();
        return token;
    })();
    try { return await tokenRead; } finally { tokenRead = undefined; }
}

async function request(path: string, body?: Record<string, unknown>, method = body ? "POST" : "GET", timeout = 3000): Promise<unknown> {
    const key = await getToken();
    const response = await fetch(`http://127.0.0.1:10767/api/${path}`, {
        method,
        headers: { apptoken: key, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
        redirect: "error"
    });
    if (response.status === 401 || response.status === 403) {
        tokenChecked = 0;
        throw new Error("Create an Equicord App Token in Cider API settings.");
    }
    if (!response.ok) throw new Error(`Cider request failed (${response.status}).`);
    if (response.status === 204) return {};
    const raw = await response.text();
    return raw ? JSON.parse(raw) : {};
}

export async function status(_event: unknown): Promise<Playback> {
    try {
        const [now, state, volume, mode] = await Promise.all([
            request("v1/playback/now-playing"),
            request("v2/playback/state"),
            request("v1/playback/volume"),
            request("v2/audio/listening-mode").catch(() => null)
        ]);
        const info = record(record(now).info);
        const artwork = text(record(info.artwork).url).replace(/\{w\}|\{h\}/g, "128");
        const url = artwork ? new URL(artwork) : null;
        return {
            connected: true,
            message: "",
            title: text(info.name),
            artist: text(info.artistName),
            artwork: url?.protocol === "https:" ? url.href : "",
            playing: record(record(state).data).state === "playing",
            duration: Math.max(0, number(info.durationInMillis) / 1000),
            position: Math.max(0, number(info.currentPlaybackTime)),
            volume: Math.min(1, Math.max(0, number(record(volume).volume, 0.5))),
            trackId: text(record(info.playParams).catalogId) || text(record(info.playParams).id) || text(info.name),
            sampledAt: Date.now(),
            mode: text(record(record(mode).data).mode)
        };
    } catch (error) {
        return {
            connected: false,
            message: error instanceof Error && error.message.startsWith("Create an Equicord") ? error.message : "Open Cider to connect automatically.",
            title: "", artist: "", artwork: "", playing: false, duration: 0, position: 0, volume: 0.5,
            trackId: "", sampledAt: Date.now(), mode: ""
        };
    }
}

export async function listeningMode(_event: unknown, mode: string): Promise<{ ok: boolean; message: string; }> {
    try {
        if (!["off", "game", "antifatigue", "cozy"].includes(mode)) throw new Error("Unsupported listening mode.");
        const result = record(await request("v2/audio/listening-mode", { mode }, "PATCH"));
        if (record(result.data).mode !== mode) throw new Error("Cider did not apply the listening mode.");
        return { ok: true, message: "" };
    } catch {
        return { ok: false, message: "Could not change listening mode. Check Cider Audio API permissions." };
    }
}

export type LyricWord = { start: number; end: number; text: string; };
export type LyricLine = LyricWord & { words: LyricWord[]; translation?: string; romanization?: string; };
export async function lyrics(_event: unknown): Promise<{ id: string; lines: LyricLine[]; message: string; ttml: string; }> {
    try {
        const data = record(record(await request("v2/lyrics/current?words=true&ttml=true", undefined, "GET", 12000)).data);
        if (!Array.isArray(data.lines)) return { id: "", lines: [], message: "No synced lyrics for this track.", ttml: "" };
        const lines = data.lines.map(record).filter(l => typeof l.start === "number" && Number.isFinite(l.start)).map(l => ({
            start: number(l.start), end: number(l.end, number(l.start)), text: text(l.text),
            translation: text(l.translation), romanization: text(l.romanization),
            words: Array.isArray(l.words) ? l.words.map(record).filter(w => typeof w.start === "number" && Number.isFinite(w.start) && typeof w.end === "number" && Number.isFinite(w.end)).map(w => ({ start: number(w.start), end: number(w.end), text: text(w.text) })) : []
        })).sort((a, b) => a.start - b.start);
        const localized = await romanizeJapanese(lines, text(record(data.source).language), join(__dirname, "cider-lyrics-dict")).catch(() => lines);
        return { id: text(data.id), lines: localized, message: lines.length ? "" : "No synced lyrics for this track.", ttml: text(data.ttml) };
    } catch {
        return { id: "", lines: [], message: "Synced lyrics are temporarily unavailable.", ttml: "" };
    }
}

export async function translations(_event: unknown, id: string, track?: TranslationTrack): Promise<Array<{ line: string; translation: string; }>> {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(id)) return [];
    const cider = (async () => { try {
        const result = record(record(await request(`v2/lyrics/${encodeURIComponent(id)}/translations?language=zh`, undefined, "GET", 8000)).data);
        return Array.isArray(result.translations) ? result.translations.map(record).map(t => ({ line: text(t.line), translation: text(t.translation) })) : [];
    } catch { return []; } })();
    const [fallback, netease] = await Promise.all([cider, track ? neteaseTranslations(track) : []]);
    return [...fallback, ...netease];
}

export type Equalizer = { enabled: boolean; frequencies: number[]; gain: number[]; Q: number[]; mix: number; vibrantBass: number; };
export type EQPatch = { band?: number; gain?: number; mix?: number; bass?: number; enabled?: boolean; reset?: boolean; };

export async function equalizer(_event: unknown): Promise<Equalizer | null> {
    try {
        const data = record(record(await request("v2/config?path=audio.equalizer")).data);
        if (!Array.isArray(data.gain) || !Array.isArray(data.frequencies)) return null;
        return {
            enabled: data.enabled === true,
            frequencies: data.frequencies.map(v => number(Number(v))),
            gain: data.gain.map(v => number(Number(v))),
            Q: Array.isArray(data.Q) ? data.Q.map(v => number(Number(v), 0.707)) : [],
            mix: number(Number(data.mix), 1), vibrantBass: number(Number(data.vibrantBass))
        };
    } catch { return null; }
}

export async function setEqualizer(_event: unknown, patch: EQPatch): Promise<{ ok: boolean; message: string; }> {
    try {
        const data: EQPatch = {};
        if (typeof patch.enabled === "boolean") data.enabled = patch.enabled;
        if (patch.reset === true) data.reset = true;
        if (patch.band !== undefined) {
            if (!Number.isInteger(patch.band) || patch.band < 0 || patch.band > 9 || typeof patch.gain !== "number" || !Number.isFinite(patch.gain)) throw new Error("Invalid EQ band");
            data.band = patch.band; data.gain = Math.max(-12, Math.min(12, patch.gain));
        }
        for (const [key, max] of [["mix", 1], ["bass", 10]] as const) {
            if (patch[key] !== undefined) {
                const value = patch[key];
                if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid EQ value");
                data[key] = Math.max(0, Math.min(max, value));
            }
        }
        if (!Object.keys(data).length) throw new Error("Empty EQ command");
        await request("v1/messages/message", { type: "equicord-cider:eq", data });
        for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 150));
            const applied = await equalizer(null);
            if (applied && (data.enabled === undefined || applied.enabled === data.enabled)
                && (data.band === undefined || Math.abs(applied.gain[data.band] - Number(data.gain)) < 0.01)
                && (data.mix === undefined || Math.abs(applied.mix - data.mix) < 0.01)
                && (data.bass === undefined || Math.abs(applied.vibrantBass - data.bass) < 0.01)
                && (!data.reset || applied.gain.every(v => v === 0) && applied.vibrantBass === 0 && applied.mix === 1)) return { ok: true, message: "" };
        }
        return { ok: false, message: "Cider has not applied the EQ. Enable the Equicord EQ Bridge plugin in Cider." };
    } catch { return { ok: false, message: "Could not adjust Cider EQ." }; }
}

export async function control(_event: unknown, action: Action, value?: number): Promise<{ ok: boolean; message: string; }> {
    try {
        if (!["playpause", "previous", "next", "seek", "volume"].includes(action)) throw new Error("Unsupported playback action.");
        let body: Record<string, number> = {};
        if (action === "volume" || action === "seek") {
            if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid playback value.");
            body = action === "volume" ? { volume: Math.max(0, Math.min(1, value)) } : { position: Math.max(0, value) };
        }
        await request(`v1/playback/${action}`, body);
        return { ok: true, message: "" };
    } catch (error) {
        return { ok: false, message: error instanceof Error && error.message.startsWith("Create an Equicord") ? error.message : "Could not control Cider. Make sure it is running." };
    }
}
