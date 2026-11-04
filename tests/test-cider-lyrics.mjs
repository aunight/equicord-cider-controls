import { resolve as resolveFromCwd } from "node:path";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

await mkdir("./.cider-test-output", { recursive: true });
await build({
    entryPoints: ["src/userplugins/ciderControls.desktop/Lyrics.tsx"],
    outfile: "./.cider-test-output/lyrics.cjs",
    bundle: true, platform: "node", format: "cjs", jsxFactory: "React.createElement",
    plugins: [{ name: "react-stub", setup(b) {
        b.onResolve({ filter: /^@webpack\/common$/ }, () => ({ path: "common", namespace: "test" }));
        b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const useEffect = () => {}; export const useLayoutEffect = () => {}; export const useState = () => {}; export const useRef = () => {};" }));
    } }]
});
globalThis.VencordNative = { pluginHelpers: { CiderControls: {} } };
const { prepareLyrics, lyricPosition, lyricIndex } = createRequire(resolveFromCwd("package.json"))("./.cider-test-output/lyrics.cjs");
const line = (text, translation = "", romanization = "") => ({ start: 0, end: 1, text, words: [], translation, romanization });
const chinese = prepareLyrics([line("简体歌词", "簡體歌詞", "jian ti ge ci")], "")[0];
assert.equal(chinese.chinese, true);
assert.equal(chinese.translation, "");
assert.equal(chinese.romanization, "");
const english = prepareLyrics([line("Hello", "这就是爱")], "")[0];
assert.equal(english.chinese, false);
assert.equal(english.translation, "這就是愛");
const japanese = prepareLyrics([line("夢", "梦想", "yume")], '<tt xml:lang="ja">')[0];
assert.equal(japanese.chinese, false);
assert.equal(japanese.translation, "夢想");
assert.equal(japanese.romanization, "yume");
const kana = prepareLyrics([line("夢を見る", "梦想")], "")[0];
assert.equal(kana.chinese, false);
assert.equal(prepareLyrics([line("Hello", "Hello")], "")[0].translation, "");
console.log("PASS: Chinese translation and pinyin hidden, Japanese recognized, English/Japanese translations converted to Traditional, duplicate translation removed.");

const clock = { position: 10, playing: true, sampledAt: 1000 };
assert.equal(lyricPosition(clock, 1250), 10.25);
assert.equal(lyricPosition({ ...clock, playing: false }, 1250), 10);
assert.equal(lyricPosition(clock, 0), 10);
const timed = [0, 5, 10, 10, 20].map(start => ({ ...line("x"), start }));
assert.equal(lyricIndex([], 10), -1);
assert.equal(lyricIndex(timed, -1), -1);
assert.equal(lyricIndex(timed, 9.99), 1);
assert.equal(lyricIndex(timed, 10), 3);
assert.equal(lyricIndex(timed, 8), 1);
assert.equal(lyricIndex(timed, 25), 4);
console.log("PASS: boundary-based lyric scheduling, pause clock, seek backwards, duplicate timestamps and empty lyrics.");

