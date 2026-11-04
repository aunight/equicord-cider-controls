/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare module "kuroshiro" {
    export default class Kuroshiro {
        init(analyzer: unknown): Promise<void>;
        convert(text: string, options: { to: "romaji"; mode: "spaced"; romajiSystem: "hepburn"; }): Promise<string>;
    }
}
declare module "kuroshiro-analyzer-kuromoji" {
    export default class KuromojiAnalyzer {
        constructor(options: { dictPath: string; });
    }
}
