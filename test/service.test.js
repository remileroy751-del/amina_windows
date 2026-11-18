'use strict';
// Test d'intégration : le service complet contre un faux serveur imitant l'API Netlify.

const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { GalleryService } = require('../src/main/service');
const { NetlifyClient, normalizeSite } = require('../src/main/netlify');
const { TOKEN, startServer } = require('./mock-netlify');

(async () => {
  const { server, base, files, log } = await startServer();
  const busy = [];
  const mk = (token, site) =>
    new NetlifyClient(token, site, { apiBase: base + '/api/v1', retryDelayMs: 1, pollDelayMs: 1 });
  const svc = new GalleryService({ clientFactory: mk, onBusy: (t) => busy.push(t) });
  const galleryOnSite = () => {
    const js = files.get('/galerie-data.js').toString('utf8');
    return JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1));
  };

  // normalisation
  assert.strictEqual(normalizeSite(' https://Demo.netlify.app/path '), 'Demo.netlify.app');

  // mauvais jeton -> 401 lisible, rien de mémorisé
  await assert.rejects(svc.login('mauvais', 'demo.netlify.app'), /401/);
  assert.strictEqual(svc.connected, false);

  // mauvais site -> 404
  await assert.rejects(svc.login(TOKEN, 'inconnu.netlify.app'), /404/);

  // connexion OK (URL saisie avec https:// et slash final)
  let r = await svc.login(TOKEN, 'https://demo.netlify.app/');
  assert.strictEqual(r.gallery.categories.length, 2);
  assert.strictEqual(r.baseUrl, base);

  // ajout de 2 photos en UNE publication
  const jpeg = (s) => Buffer.from('JPEG-' + s);
  r = await svc.addPhotos('grex', [
    { data: jpeg('A'), caption: ' Belle vue ' },
    { data: jpeg('B'), caption: '' }
  ]);
  let g = galleryOnSite();
  assert.strictEqual(g.categories[1].photos.length, 2);
  assert.strictEqual(g.categories[1].photos[0].caption, 'Belle vue');
  assert.strictEqual(g.categories[1].photos[1].alt, 'Grèx'); // titre sans « * » si pas de légende
  assert.strictEqual(g.categories[0].extra, 'garde-moi'); // champs inconnus conservés
  const [pa, pb] = g.categories[1].photos.map((p) => p.src);
  assert.ok(/^images\/up-\d{8}-\d{6}-1\.jpg$/.test(pa), pa);
  assert.strictEqual(files.get('/' + pa).toString(), 'JPEG-A');
  assert.strictEqual(files.get('/' + pb).toString(), 'JPEG-B');
  assert.ok(files.has('/index.html') && files.has('/images/orig-1.jpg'), 'fichiers existants intacts');
  assert.ok(busy.some((t) => /Envoi du fichier 1\/3/.test(t)), 'progression affichée : ' + busy.join(' | '));
  assert.strictEqual(busy[busy.length - 1], null);

  // suppression d'une photo ajoutée -> fichier effacé ; d'une photo d'origine -> fichier conservé
  await svc.deletePhoto('grex', pa);
  assert.ok(!files.has('/' + pa), 'photo ajoutée effacée du site');
  await svc.deletePhoto('lave', 'images/orig-1.jpg');
  assert.ok(files.has('/images/orig-1.jpg'), 'photo d\'origine conservée');
  g = galleryOnSite();
  assert.strictEqual(g.categories[0].photos.length, 0);
  assert.strictEqual(g.categories[1].photos.length, 1);

  // vidéo
  const vid = path.join(os.tmpdir(), 'test-video.mp4');
  fs.writeFileSync(vid, Buffer.from('FAKE-MP4-DATA'));
  await svc.addVideo(vid, new Uint8Array(Buffer.from('POSTER')), 'tall');
  g = galleryOnSite();
  assert.strictEqual(g.videos.length, 1);
  assert.strictEqual(g.videos[0].format, 'tall');
  assert.strictEqual(files.get('/' + g.videos[0].src).toString(), 'FAKE-MP4-DATA');
  assert.strictEqual(files.get('/' + g.videos[0].poster).toString(), 'POSTER');
  const v = g.videos[0];
  await svc.deleteVideo(v.src);
  assert.ok(!files.has('/' + v.src) && !files.has('/' + v.poster), 'vidéo + miniature effacées');
  assert.strictEqual(galleryOnSite().videos.length, 0);

  // vidéo sans miniature, mauvais format
  await svc.addVideo(vid, null, 'wide');
  assert.strictEqual(galleryOnSite().videos[0].poster, '');
  await assert.rejects(svc.addVideo(path.join(os.tmpdir(), 'x.mov'), null, 'wide'), /MP4/);

  // le site n'a pas été cassé
  assert.ok(files.has('/index.html'));
  assert.ok(log.length > 10);

  // réutilisation des identifiants enregistrés (restore)
  const svc2 = new GalleryService({ clientFactory: mk });
  const rs = await svc2.restore(TOKEN, 'demo.netlify.app');
  assert.ok(rs.gallery && !rs.error);
  const svc3 = new GalleryService({ clientFactory: mk });
  const bad = await svc3.restore('perime', 'demo.netlify.app');
  assert.ok(bad.error && /401/.test(bad.error) && !bad.gallery);

  server.close();
  console.log('✔ tous les tests passent');
})().catch((e) => {
  console.error('✘ ÉCHEC', e);
  process.exit(1);
});
