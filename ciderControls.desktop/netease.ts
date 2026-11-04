/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type TranslationTrack = { title: string; artist: string; duration: number; };
type Translation = { line: string; translation: string; };
type LrcLine = { start: number; text: string; };

const cache = new Map<string, { expires: number; value: Promise<Translation[]>; }>();

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function key(value: string): string { return value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase(); }
function titleKey(value: string): string { return key(value.replace(/\s*[（(](?:feat\.?|ft\.?)\s+[^)）]+[)）]/gi, "")); }

export function parseLrc(value: string): LrcLine[] {
    return value.split(/\r?\n/).flatMap(line => {
        const timestamps = [...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
        const content = line.replace(/\[[^\]]*\]/g, "").trim();
        return content ? timestamps.map(t => ({ start: Number(t[1]) * 60 + Number(t[2]) + Number(`0.${t[3] || "0"}`), text: content })) : [];
    }).sort((a, b) => a.start - b.start);
}

export function matchSong(songs: unknown[], track: TranslationTrack): string {
    const candidates = songs.map(record).filter(song => {
        if (titleKey(text(song.name)) !== titleKey(track.title)) return false;
        if (typeof song.duration !== "number" || Math.abs(song.duration / 1000 - track.duration) > 5) return false;
        const artists = Array.isArray(song.artists) ? song.artists.map(a => key(text(record(a).name))) : [];
        const artist = key(track.artist);
        return artists.some(a => a && (a === artist || a.length >= 3 && artist.includes(a)));
    }).sort((a, b) => Math.abs(Number(a.duration) / 1000 - track.duration) - Math.abs(Number(b.duration) / 1000 - track.duration));
    const id = candidates[0]?.id;
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? String(id) : "";
}

export function alignTranslations(original: string, translated: string): Translation[] {
    const source = parseLrc(original);
    const translations = parseLrc(translated);
    return source.flatMap(line => {
        const nearest = translations.reduce<LrcLine | undefined>((best, t) => !best || Math.abs(t.start - line.start) < Math.abs(best.start - line.start) ? t : best, undefined);
        if (!nearest || Math.abs(nearest.start - line.start) > .6 || !/\p{Script=Han}/u.test(nearest.text)
            || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(nearest.text) || key(line.text) === key(nearest.text)) return [];
        return [{ line: line.text, translation: nearest.text }];
    });
}

async function json(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`https://music.163.com/api/${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: "error" });
    if (!response.ok) throw new Error("NetEase lyrics are temporarily unavailable.");
    return record(await response.json());
}

export async function neteaseTranslations(track: TranslationTrack): Promise<Translation[]> {
    if (!track.title || !track.artist || !Number.isFinite(track.duration) || track.duration <= 0) return [];
    const identity = JSON.stringify([track.title, track.artist, track.duration]);
    const existing = cache.get(identity);
    if (existing && existing.expires > Date.now()) return existing.value;
    const entry = { expires: Date.now() + 3600000, value: Promise.resolve<Translation[]>([]) };
    entry.value = (async () => {
        const search = await json("search/get", { s: `${track.title} ${track.artist}`, type: "1", limit: "15", offset: "0" });
        const { songs } = record(search.result);
        const id = matchSong(Array.isArray(songs) ? songs : [], track);
        if (!id) return [];
        const lyrics = await json("song/lyric", { id, lv: "-1", tv: "-1", rv: "-1", kv: "-1", yv: "-1" });
        return alignTranslations(text(record(lyrics.lrc).lyric), text(record(lyrics.tlyric).lyric));
    })().catch(() => []).then(lines => {
        if (!lines.length) entry.expires = Date.now() + 300000;
        return lines;
    });
    if (cache.size >= 100) cache.delete(cache.keys().next().value ?? "");
    cache.set(identity, entry);
    return entry.value;
}
