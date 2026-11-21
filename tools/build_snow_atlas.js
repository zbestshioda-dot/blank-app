// Bake the winter atlas once (public/assets/atlas_snow.webp) with the same snowAtlas() the game used to run on every phone
// at load time (that extra full-size canvas pushed iPhones out of memory: black screen + reconnect loop).
//   node tools/build_snow_atlas.js        (run again after the atlas changes, then bump the atlas ?v= in game.js)
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), A = path.join(ROOT, 'public/assets');
const src = fs.readFileSync(path.join(ROOT, 'public/game.js'), 'utf8');
const i0 = src.indexOf('function snowAtlas('); let d = 0, i = src.indexOf('{', i0);
for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
const fn = src.slice(i0, i + 1);
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  const img = 'data:image/webp;base64,' + fs.readFileSync(path.join(A, 'atlas.webp')).toString('base64');
  const j = JSON.parse(fs.readFileSync(path.join(A, 'atlas.json'), 'utf8'));
  const out = await p.evaluate(async ([fn, img, j]) => {
    eval(fn + ';window.__s=snowAtlas');
    const im = new Image(); await new Promise(r => { im.onload = r; im.src = img; });
    return window.__s(im, j).toDataURL('image/webp', 0.92);
  }, [fn, img, j]);
  fs.writeFileSync(path.join(A, 'atlas_snow.webp'), Buffer.from(out.split(',')[1], 'base64'));
  console.log('atlas_snow.webp', fs.statSync(path.join(A, 'atlas_snow.webp')).size, 'bytes'); await b.close();
})();
