'use strict';
// Test visuel (hors livraison) : lance la vraie application Electron contre un faux Netlify,
// pilote l'interface et enregistre des captures d'écran.  Usage :
//   xvfb-run -a npx electron -r ./test/e2e-hook.js .
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { startServer, TOKEN } = require('./mock-netlify');

const OUT = process.env.SHOT_DIR || path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'amina-e2e-')));

process.on('uncaughtException', (e) => console.log('UNCAUGHT', e && e.stack));
process.on('unhandledRejection', (e) => console.log('UNHANDLED', e && e.stack));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = global.fetch;
let mockBase = '';
global.fetch = (url, init) => realFetch(String(url).replace('https://api.netlify.com', mockBase), init);

(async () => {
  const mock = await startServer();
  mockBase = mock.base;
  const logo = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png'));
  mock.files.set('/images/orig-1.jpg', logo);

  await app.whenReady();
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await sleep(100);
  await sleep(1500);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => level >= 2 && !/Content Security Policy/.test(msg) && errors.push(msg));

  await shot('1-connexion');
  await js(`(() => { const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input'));};
    set('token','${TOKEN}'); set('site','https://demo.netlify.app/'); })()`);
  await js(`document.getElementById('login-btn').click()`);
  await sleep(2500);
  await shot('2-photos');
  const photoCount = await js(`document.querySelectorAll('.thumb').length`);

  // Ajout de photos via le vrai pipeline de redimensionnement (fichier synthétique)
  const result = await js(`(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const x = c.getContext('2d'); x.fillStyle = '#c44'; x.fillRect(0,0,3000,2000);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const f = new File([blob], 'grande.png', { type: 'image/png' });
    openPhotoDialog('grex', [f, f]);
    return prepareImage(f).then(u => u.length);
  })()`);
  await sleep(500);
  await shot('3-dialogue-ajout');
  await js(`document.getElementById('photos-ok').click()`);
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const t = await js(`document.getElementById('dlg-busy').open ? document.getElementById('busy-text').textContent : 'FERME'`);
    console.log('busy:', t);
    if (t === 'FERME') break;
  }
  await shot('4-apres-ajout');
  const afterCount = await js(`document.querySelectorAll('.thumb').length`);

  // Vidéo : lecture des dimensions + miniature dans Chromium, puis publication via le vrai chemin du fichier
  const mp4 = fs.readFileSync('/tmp/vertical.mp4').toString('base64');
  const vmeta = await js(`(async () => {
    const bin = Uint8Array.from(atob('${mp4}'), c => c.charCodeAt(0));
    const f = new File([bin], 'vertical.mp4', { type: 'video/mp4' });
    const m = await readVideo(f);
    const r = await window.api.addVideo('/tmp/vertical.mp4', m.poster, m.width / m.height < 0.7 ? 'tall' : 'wide');
    return { w: m.width, h: m.height, poster: m.poster ? m.poster.length : 0, ok: r.ok, err: r.error, videos: r.gallery && r.gallery.videos };
  })()`);
  console.log('VIDEO', JSON.stringify(vmeta));
  await js(`switchTab('videos')`);
  await sleep(500);
  await shot('5-videos');

  const files = [...mock.files.keys()].filter((k) => k.startsWith('/images/up-') && !k.includes('poster'));
  console.log(JSON.stringify({ photoCount, afterCount, resizedBytes: result, uploaded: files, errors }, null, 1));
  const ok = afterCount === photoCount + 2 && files.length === 2 && errors.length === 0 && result > 0 && vmeta.ok && vmeta.w === 360 && vmeta.poster > 0 && vmeta.videos[0].format === 'tall';
  console.log(ok ? 'E2E OK' : 'E2E ECHEC');
  app.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); app.exit(2); });
