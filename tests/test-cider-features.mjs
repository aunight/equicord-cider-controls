import { resolve as resolveFromCwd } from "node:path";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "cider-features-test-"));
await mkdir(join(dir, "sh.cider.dotnet"));
await writeFile(join(dir, "sh.cider.dotnet", "spa-config.yml"), "connectivity:\n  apiTokens:\n    - name: Equicord\n      token: local-test-token\n");
const output = join(dir, "native.cjs");
await build({ entryPoints: ["src/userplugins/ciderControls.desktop/native.ts"], outfile: output, bundle: true, platform: "node", format: "cjs", plugins: [{ name: "electron-test", setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test" }));
    b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(dir)} };` }));
} }] });
const native = createRequire(resolveFromCwd("package.json"))(output);
let equalizer = { enabled: true, gain: Array(10).fill(0), frequencies: [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000], Q: Array(10).fill(.707), mix: 1, vibrantBass: 0 };
let rebuilds = 0;
const messages = new EventTarget();
const window = { __PLUGINSYS__: { ExternalMessages: messages }, CiderApp: { config: {
    getValue: () => equalizer,
    setValue: (key, value) => { assert.equal(key, "audio.equalizer"); equalizer = value; },
    saveConfig: async () => {}
} }, CiderAudio: { _initComplete: true, hierarchical_loading: () => rebuilds++, init: () => rebuilds++ } };
const bridge = await readFile("./.cider-controls-tests/cider-eq-bridge/plugin.js", "utf8");
const context = vm.createContext({ window, console, CustomEvent });
vm.runInContext(bridge.replace("export default", "globalThis.plugin ="), context);
context.plugin.setup();
context.plugin.setup();
let mode = "off";
const requests = [];
globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    assert.equal(options.headers.apptoken, "local-test-token");
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.includes("listening-mode")) {
        if (options.method === "PATCH") mode = body.mode;
        return Response.json({ data: { mode, available: true } });
    }
    if (url.includes("lyrics/current")) return Response.json({ data: { id: "song-1", ttml: "<tt/>", lines: [{ start: 12, end: 15, text: "B", words: [{ start: 12, end: 13, text: "B" }] }, { start: 2, end: 9, text: "A" }, { start: null, text: "untimed" }] } });
    if (url.includes("/translations?language=zh")) return Response.json({ data: { translations: [{ line: "B", translation: "Translation" }] } });
    if (url.includes("config?path=audio.equalizer")) return Response.json({ data: equalizer });
    if (url.includes("messages/message")) { messages.dispatchEvent(new CustomEvent(body.type, { detail: body.data })); return Response.json({ status: "success" }); }
    return Response.json({});
};
try {
    for (const value of ["off", "game", "antifatigue", "cozy"]) {
        assert.equal((await native.listeningMode(null, value)).ok, true);
        assert.equal(mode, value);
    }
    let count = requests.length;
    assert.equal((await native.listeningMode(null, "invalid")).ok, false);
    assert.equal(requests.length, count);
    const lyrics = await native.lyrics(null);
    assert.deepEqual(lyrics.lines.map(l => l.start), [2, 12]);
    assert.equal(lyrics.lines[1].words[0].start, 12);
    assert.equal(lyrics.ttml, "<tt/>");
    assert.equal((await native.translations(null, lyrics.id))[0].translation, "Translation");
    count = requests.length;
    assert.deepEqual(await native.translations(null, "../config"), []);
    assert.equal(requests.length, count);
    assert.equal((await native.setEqualizer(null, { band: 2, gain: 3.4 })).ok, true);
    assert.equal(equalizer.gain[2], 3.4);
    assert.equal(rebuilds, 1);
    assert.equal((await native.setEqualizer(null, { mix: .5, bass: 4 })).ok, true);
    assert.equal(equalizer.mix, .5);
    assert.equal(equalizer.vibrantBass, 4);
    assert.equal((await native.setEqualizer(null, { enabled: false })).ok, true);
    assert.equal(equalizer.enabled, false);
    assert.equal((await native.setEqualizer(null, { reset: true })).ok, true);
    assert.ok(equalizer.gain.every(v => v === 0));
    assert.equal(equalizer.mix, 1);
    assert.equal(equalizer.vibrantBass, 0);
    count = requests.length;
    assert.equal((await native.setEqualizer(null, { band: -1, gain: 5 })).ok, false);
    assert.equal((await native.setEqualizer(null, { band: 1, gain: NaN })).ok, false);
    assert.equal(requests.length, count);
    const previous = rebuilds;
    messages.dispatchEvent(new CustomEvent("equicord-cider:eq", { detail: { arbitrary: "value" } }));
    assert.equal(rebuilds, previous);
    assert.ok(requests.every(r => r.url.startsWith("http://127.0.0.1:10767/api/")));
    console.log("PASS: four listening modes, invalid-mode rejection, sorted timed lyrics, real EQ bridge event flow, gain/mix/bass/toggle/reset, duplicate listener cleanup, invalid EQ rejection.");
} finally {
    assert.equal(dirname(dir), tmpdir());
    assert.ok(basename(dir).startsWith("cider-features-test-"));
    await rm(dir, { recursive: true });
}
