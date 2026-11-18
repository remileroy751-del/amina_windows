'use strict';
// Faux serveur imitant l'API Netlify (+ le site public) pour les tests.
const http = require('http');
const assert = require('assert');
const { sha1Of, galleryToJs } = require('../src/main/netlify');

const TOKEN = 'secret-token';

const initialGallery = {
  version: 1,
  categories: [
    { id: 'lave', title: 'Granitos *Lavé*', photos: [{ src: 'images/orig-1.jpg', alt: 'a', caption: '' }], extra: 'garde-moi' },
    { id: 'grex', title: 'Grèx', photos: [] }
  ],
  videos: []
};

function startServer() {
  // état du « site »
  const files = new Map(); // chemin -> Buffer
  files.set('/index.html', Buffer.from('<html></html>'));
  files.set('/images/orig-1.jpg', Buffer.from('orig'));
  files.set('/galerie-data.js', Buffer.from(galleryToJs(initialGallery), 'utf8'));
  const deploys = {};
  const log = [];
  let counter = 0;
  let base = '';

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const send = (code, obj, type) => {
        res.writeHead(code, { 'Content-Type': type || 'application/json' });
        res.end(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj));
      };
      log.push(req.method + ' ' + url.pathname);

      // Site public
      if (!url.pathname.startsWith('/api/v1/') && files.has(url.pathname)) {
        return send(200, files.get(url.pathname), url.pathname.endsWith('.js') ? 'application/javascript' : 'image/png');
      }

      // API (authentifiée)
      if (!url.pathname.startsWith('/api/v1/')) return send(404, 'nope');
      if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { message: 'unauthorized' });
      const p = url.pathname.slice('/api/v1'.length);
      let m;

      if (req.method === 'GET' && (m = p.match(/^\/sites\/([^/]+)$/))) {
        if (decodeURIComponent(m[1]) !== 'demo.netlify.app' && m[1] !== 'site-id-1') return send(404, {});
        return send(200, { id: 'site-id-1', ssl_url: base + '/' });
      }
      if (req.method === 'GET' && p === '/sites/site-id-1/files') {
        return send(200, [...files].map(([k, v]) => ({ id: k, path: k, sha: sha1Of(v) })));
      }
      if (req.method === 'POST' && p === '/sites/site-id-1/deploys') {
        const manifest = JSON.parse(body.toString()).files;
        const id = 'dep' + ++counter;
        const have = new Set([...files.values()].map(sha1Of));
        const required = [...new Set(Object.values(manifest).filter((sha) => !have.has(sha)))];
        deploys[id] = { manifest, required, got: {}, polls: 0 };
        return send(200, { id, state: 'prepared', required });
      }
      if (req.method === 'PUT' && (m = p.match(/^\/deploys\/([^/]+)\/files\/(.+)$/))) {
        const d = deploys[m[1]];
        d.got[sha1Of(body)] = body; // Netlify est adressé par contenu
        return send(200, {});
      }
      if (req.method === 'GET' && (m = p.match(/^\/deploys\/([^/]+)$/))) {
        const d = deploys[m[1]];
        d.polls++;
        if (d.polls < 2) return send(200, { id: m[1], state: 'uploading', published_at: null });
        // publication : le site devient exactement le manifeste
        const next = new Map();
        for (const [fp, sha] of Object.entries(d.manifest)) {
          const buf = d.got[sha] || [...files.values()].find((b) => sha1Of(b) === sha);
          assert.ok(buf, 'fichier manquant pour ' + fp);
          assert.strictEqual(sha1Of(buf), sha, 'SHA incohérent pour ' + fp);
          next.set(fp, buf);
        }
        files.clear();
        next.forEach((v, k) => files.set(k, v));
        return send(200, { id: m[1], state: 'ready', published_at: '2026-11-18T00:00:00Z' });
      }
      return send(404, {});
    });
  });

  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      base = 'http://127.0.0.1:' + server.address().port;
      resolve({ server, base, files, log });
    })
  );
}

module.exports = { TOKEN, initialGallery, startServer };
