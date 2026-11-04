/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";
import { Converter } from "opencc-js/cn2t";
import type { ReactNode } from "react";

import type { LyricLine, Playback } from "./native";

const Native = VencordNative.pluginHelpers.CiderControls as PluginNative<typeof import("./native")>;
const traditional = Converter({ from: "cn", to: "tw" });
type DisplayLine = LyricLine & { chinese?: boolean; };

function key(text: string) { return text.normalize("NFKC").replace(/[\s\p{P}]/gu, "").toLowerCase(); }

function localizations(lines: LyricLine[], ttml: string): LyricLine[] {
    if (!ttml) return lines;
    try {
        const doc = new DOMParser().parseFromString(ttml, "application/xml");
        if (doc.getElementsByTagName("parsererror").length) return lines;
        const elements = Array.from(doc.getElementsByTagName("*"));
        const translations = elements.filter(e => e.localName === "translation");
        const translation = translations.find(e => (e.getAttribute("xml:lang") || "").startsWith("zh")) ?? translations[0];
        const romanization = elements.find(e => e.localName === "transliteration");
        const collect = (parent: Element | undefined) => new Map(Array.from(parent?.getElementsByTagName("text") ?? []).map(e => [e.getAttribute("for") || "", e.textContent?.replace(/\s+/g, " ").trim() || ""]));
        const translated = collect(translation);
        const romanized = collect(romanization);
        const metadata = new Map<string, { translation: string; romanization: string; }>();
        for (const p of elements.filter(e => e.localName === "p" && e.hasAttribute("begin"))) {
            const id = p.getAttribute("itunes:key") || p.getAttributeNS("http://music.apple.com/lyric-ttml-internal", "key") || "";
            metadata.set(key(p.textContent || ""), { translation: translated.get(id) || "", romanization: romanized.get(id) || "" });
        }
        return lines.map(line => {
            const extra = metadata.get(key(line.text));
            return { ...line, translation: line.translation || extra?.translation, romanization: line.romanization || extra?.romanization };
        });
    } catch { return lines; }
}

export function prepareLyrics(lines: LyricLine[], ttml: string): DisplayLine[] {
    const japanese = lines.some(line => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)) || /xml:lang=["']ja(?:-[^"']*)?["']/.test(ttml);
    return lines.map(line => {
        const chinese = !japanese && /\p{Script=Han}/u.test(line.text);
        const translation = chinese ? "" : traditional(line.translation || "");
        return { ...line, chinese, translation: key(translation) === key(traditional(line.text)) ? "" : translation, romanization: chinese ? "" : line.romanization };
    });
}

export function lyricPosition(playback: Playback, now = Date.now()): number {
    return playback.position + (playback.playing ? Math.max(0, now - playback.sampledAt) / 1000 : 0);
}

export function lyricIndex(lines: LyricLine[], position: number): number {
    let low = 0;
    let high = lines.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (lines[mid].start <= position) low = mid + 1;
        else high = mid;
    }
    return low - 1;
}

function TimedWords({ line, playback, current }: { line: DisplayLine; playback: Playback; current: boolean; }) {
    const root = useRef<HTMLSpanElement>(null);
    const clock = useRef(playback);
    const visible = useRef(current);
    const animations = useRef<Array<{ animation: Animation; start: number; }>>([]);
    clock.current = playback;
    visible.current = current;
    useEffect(() => {
        const position = lyricPosition(clock.current);
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>(".eq-cider-word-fill") ?? []);
        animations.current = items.map((element, index) => {
            const word = line.words[index];
            const animation = element.animate(
                reduced ? [{ opacity: 1 }, { opacity: 1 }] : [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }],
                { duration: Math.max(1, (word.end - word.start) * 1000), fill: "both", easing: "linear" }
            );
            animation.currentTime = (position - word.start) * 1000;
            if (!clock.current.playing || !visible.current) animation.pause();
            return { animation, start: word.start };
        });
        return () => { animations.current.forEach(({ animation }) => animation.cancel()); animations.current = []; };
    }, [line]);
    useEffect(() => {
        const position = lyricPosition(playback);
        for (const { animation, start } of animations.current) {
            const desired = (position - start) * 1000;
            if (Math.abs(Number(animation.currentTime ?? 0) - desired) > 120) animation.currentTime = desired;
            if (current && playback.playing && animation.playState !== "running" && desired < Number(animation.effect?.getTiming().duration ?? 0)) animation.play();
            else if ((!current || !playback.playing) && animation.playState !== "paused") animation.pause();
        }
    }, [playback.sampledAt, playback.playing, current]);
    const display = (text: string) => line.chinese ? traditional(text) : text;
    if (!line.words.length) return display(line.text) || "♪";
    let cursor = 0;
    const rendered: ReactNode[] = [];
    for (let i = 0; i < line.words.length; i++) {
        const word = line.words[i];
        const start = line.text.indexOf(word.text, cursor);
        if (start < 0) return display(line.text);
        rendered.push(<span key={i}>{display(line.text.slice(cursor, start))}<span className="eq-cider-word-static">{display(word.text)}<span className="eq-cider-word-fill" aria-hidden="true">{display(word.text)}</span></span></span>);
        cursor = start + word.text.length;
    }
    rendered.push(display(line.text.slice(cursor)));
    return <span ref={root}>{rendered}</span>;
}

export function Lyrics({ playback, active, showTranslation, showRomanization }: { playback: Playback; active: boolean; showTranslation: boolean; showRomanization: boolean; }) {
    const root = useRef<HTMLDivElement>(null);
    const [lines, setLines] = useState<DisplayLine[]>([]);
    const [message, setMessage] = useState("Loading lyrics…");
    const [index, setIndex] = useState(-1);
    useEffect(() => {
        if (!active) return;
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        setLines([]);
        setMessage("Loading lyrics…");
        const load = async () => {
            try {
                const result = await Native.lyrics();
                if (!alive) return;
                const localized = prepareLyrics(localizations(result.lines, result.ttml), result.ttml);
                setLines(localized);
                setMessage(result.message);
                if (!result.lines.length) timer = setTimeout(load, 15000);
                else if (result.id && localized.some(l => l.text.trim() && !l.chinese)) {
                    const translated = await Native.translations(result.id, { title: playback.title, artist: playback.artist, duration: playback.duration });
                    if (!alive) return;
                    const map = new Map(translated.map(t => [key(t.line), t.translation]));
                    setLines(localized.map(line => {
                        if (line.chinese) return line;
                        const translation = traditional(map.get(key(line.text)) || line.translation || "");
                        return { ...line, translation: key(translation) === key(traditional(line.text)) ? "" : translation };
                    }));
                }
            } catch { if (alive) { setMessage("Synced lyrics are temporarily unavailable."); timer = setTimeout(load, 15000); } }
        };
        void load();
        return () => { alive = false; clearTimeout(timer); };
    }, [playback.trackId, active]);
    useEffect(() => {
        if (!active) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const update = () => {
            const position = lyricPosition(playback);
            const current = lyricIndex(lines, position);
            setIndex(previous => previous === current ? previous : current);
            const next = lines[current + 1]?.start;
            if (playback.playing && next !== undefined) {
                timer = setTimeout(update, Math.max(10, (next - position) * 1000));
            }
        };
        update();
        return () => clearTimeout(timer);
    }, [active, lines, playback.playing, playback.position, playback.sampledAt]);
    useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;
        const cards = Array.from(element.querySelectorAll<HTMLElement>(".eq-cider-lyric-line"));
        const measure = () => {
            const heights = cards.map(card => card.textContent?.trim() ? card.offsetHeight : 0);
            const current = heights[1] || 28;
            const previous = (heights[0] || 0) * .72;
            const next = (heights[2] || 0) * .72;
            cards.forEach((card, slot) => card.style.setProperty("--eq-cider-line-y", `${slot === 0 ? -(current / 2 + previous / 2 + 9) : slot === 2 ? current / 2 + next / 2 + 9 : 0}px`));
            element.closest<HTMLElement>(".eq-cider-lyrics-expander")?.style.setProperty("--eq-cider-lyrics-height", `${Math.ceil(Math.max(144, current + 2 * Math.max(previous, next) + 36))}px`);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        cards.forEach(card => observer.observe(card));
        return () => observer.disconnect();
    }, [lines, index, showTranslation, showRomanization]);
    const visible = [index - 1, index, index + 1];
    return <div ref={root} className="eq-cider-lyrics" aria-label="Synced lyrics">
        {!lines.length ? <div className="eq-cider-lyrics-message">{message}</div> : visible.map((i, slot) => (
            <div key={i} className="eq-cider-lyric-line" data-slot={slot} data-current={slot === 1}>
                <div className="eq-cider-lyric-original">{i === -1 && slot === 1 ? "♪" : lines[i] ? <TimedWords line={lines[i]} playback={playback} current={slot === 1} /> : ""}</div>
                {showTranslation && lines[i]?.translation && <div className="eq-cider-lyric-translation">{lines[i].translation}</div>}
                {showRomanization && lines[i]?.romanization && key(lines[i].romanization || "") !== key(lines[i].text) && <div className="eq-cider-lyric-romanization">{lines[i].romanization}</div>}
            </div>
        ))}
    </div>;
}
