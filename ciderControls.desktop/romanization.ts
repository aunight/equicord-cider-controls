/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Kuroshiro from "kuroshiro";
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";

import type { LyricLine } from "./native";

let engine: Promise<Kuroshiro> | undefined;
const cache = new Map<string, string>();

export async function romanizeJapanese(lines: LyricLine[], language: string, dictPath: string): Promise<LyricLine[]> {
    const japanese = language.toLowerCase().startsWith("ja") || lines.some(line => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text));
    if (!japanese) return lines;
    const missing = lines.some(line => !line.romanization?.trim() && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text));
    if (!missing) return lines;
    engine ??= (async () => {
        const converter = new Kuroshiro();
        await converter.init(new KuromojiAnalyzer({ dictPath }));
        return converter;
    })();
    const converter = await engine;
    return Promise.all(lines.map(async line => {
        if (line.romanization?.trim() || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)) return line;
        let value = cache.get(line.text);
        if (value === undefined) {
            value = (await converter.convert(line.text, { to: "romaji", mode: "spaced", romajiSystem: "hepburn" })).replace(/\s+/g, " ").trim();
            cache.set(line.text, value);
            if (cache.size > 2000) cache.delete(cache.keys().next().value!);
        }
        return { ...line, romanization: value };
    }));
}
