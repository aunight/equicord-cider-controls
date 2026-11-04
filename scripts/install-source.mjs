import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(process.argv[2]||'');
const manifest=JSON.parse(await readFile(join(target,'package.json'),'utf8'));
if(manifest.name!=='equicord') throw new Error('Pass the root directory of an Equicord source checkout.');
await cp(join(here,'ciderControls.desktop'),join(target,'src/userplugins/ciderControls.desktop'),{recursive:true});
await mkdir(join(target,'.cider-controls-tests'),{recursive:true});
await cp(join(here,'cider-eq-bridge'),join(target,'.cider-controls-tests/cider-eq-bridge'),{recursive:true});
await cp(join(here,'tests'),join(target,'.cider-controls-tests/tests'),{recursive:true});
const path=join(target,'scripts/build/build.mjs');
let script=(await readFile(path,'utf8')).replace(/\r\n/g, "\n");
if(!script.includes('const ciderDict =')) {
 const marker='await Promise.all([\n    createPackage("dist/desktop"';
 if(!script.includes(marker)) throw new Error('Unsupported Equicord build script; dictionary hook was not applied.');
 script=script.replace(marker,`const ciderFs = await import("node:fs/promises");
const ciderPath = await import("node:path");
const ciderModule = await import("node:module");
const ciderRequire = ciderModule.createRequire(import.meta.url);
const analyzerRequire = ciderModule.createRequire(ciderRequire.resolve("kuroshiro-analyzer-kuromoji"));
const ciderDict = ciderPath.join(ciderPath.dirname(analyzerRequire.resolve("kuromoji/package.json")), "dict");
await Promise.all(["dist/desktop", "dist/equibop"].map(async output => {
    await ciderFs.cp(ciderDict, ciderPath.join(output, "cider-lyrics-dict"), { recursive: true });
    await ciderFs.cp(ciderPath.join(ciderPath.dirname(ciderDict), "LICENSE-2.0.txt"), ciderPath.join(output, "cider-lyrics-dict", "LICENSE-2.0.txt"));
    await ciderFs.cp(ciderPath.join(ciderPath.dirname(ciderDict), "NOTICE.md"), ciderPath.join(output, "cider-lyrics-dict", "NOTICE.md"));
}));

`+marker);
 await writeFile(path,script);
}
console.log('CiderControls source and offline dictionary build hook installed.');
console.log('Next, in Equicord: pnpm add -w opencc-js@1.3.1 kuroshiro@1.2.1 kuroshiro-analyzer-kuromoji@1.1.0 --ignore-scripts');
console.log('Then run pnpm build --dev. No desktop app or user profile was modified.');
