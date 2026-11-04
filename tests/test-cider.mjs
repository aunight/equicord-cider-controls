import { resolve as resolveFromCwd } from "node:path";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "cider-controls-test-"));
const configDir = join(dir, "sh.cider.dotnet");
await mkdir(configDir);
await writeFile(join(configDir, "spa-config.yml"), "connectivity:\n  apiTokens:\n    - name: Discord\n      token: test-local-token\n    - name: Better Discovery\n      token: unrelated-plugin-token\n");
const output = join(dir, "native.cjs");
await build({
    entryPoints: ["src/userplugins/ciderControls.desktop/native.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    plugins: [{ name: "electron-test", setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test" }));
        b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(dir)} };` }));
    } }]
});
const native = createRequire(resolveFromCwd("package.json"))(output);
const requests = [];
let fail = false;
globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    if (fail) return new Response("{}", { status: 403 });
    if (options.method === "POST") return new Response(null, { status: 204 });
    const data = url.endsWith("now-playing") ? { info: { name: "測試歌曲", artistName: "Artist", artwork: { url: "https://example.com/{w}x{h}.jpg" }, durationInMillis: 180000, currentPlaybackTime: 20 } }
        : url.endsWith("/state") ? { data: { state: "playing" } } : { volume: 0.6 };
    return Response.json(data);
};
try {
    const state = await native.status(null);
    assert.equal(state.connected, true);
    assert.equal(state.title, "測試歌曲");
    assert.equal(state.playing, true);
    assert.equal(state.duration, 180);
    assert.equal(state.position, 20);
    assert.equal(state.volume, 0.6);
    assert.equal(state.artwork, "https://example.com/128x128.jpg");
    assert.ok(requests.every(r => r.url.startsWith("http://127.0.0.1:10767/api/") && r.headers.apptoken === "test-local-token" && r.redirect === "error"));
    assert.ok(!JSON.stringify(state).includes("test-local-token"));
    assert.equal((await native.control(null, "playpause")).ok, true);
    assert.equal(requests.at(-1).url, "http://127.0.0.1:10767/api/v1/playback/playpause");
    await native.control(null, "volume", 5);
    assert.deepEqual(JSON.parse(requests.at(-1).body), { volume: 1 });
    await native.control(null, "seek", -5);
    assert.deepEqual(JSON.parse(requests.at(-1).body), { position: 0 });
    const count = requests.length;
    assert.equal((await native.control(null, "volume", NaN)).ok, false);
    assert.equal((await native.control(null, "../config")).ok, false);
    assert.equal(requests.length, count);
    fail = true;
    const offline = await native.status(null);
    assert.equal(offline.connected, false);
    assert.match(offline.message, /App Token/);
    assert.ok(!JSON.stringify(offline).includes("test-local-token"));
    console.log("PASS: playback normalization, Unicode, local-only auth, no token exposure, POST commands, clamping, invalid actions and auth failure.");
} finally {
    await rm(dir, { recursive: true });
}
