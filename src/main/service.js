'use strict';
// Logique métier : portage de AdminViewModel.kt (sans dépendance à Electron).

const fs = require('fs');
const { NetlifyClient, NetlifyError, sha1Of, galleryToJs, displayTitle } = require('./netlify');

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function stamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

class GalleryService {
  /**
   * @param {object} [opts] { onBusy(text|null), clientFactory(token, site), now() }
   */
  constructor(opts = {}) {
    this.onBusy = opts.onBusy || (() => {});
    this.clientFactory = opts.clientFactory || ((t, s) => new NetlifyClient(t, s));
    this.client = null;
    this.site = null;
    this.gallery = null;
    this.working = false;
  }

  get connected() {
    return !!this.client;
  }

  snapshot() {
    return { gallery: this.gallery, baseUrl: this.site ? this.site.baseUrl : '' };
  }

  /** Exécute une opération en bloquant les opérations concurrentes. */
  async _busy(text, fn) {
    if (this.working) throw new NetlifyError('Une opération est déjà en cours.');
    this.working = true;
    this.onBusy(text);
    try {
      return await fn();
    } finally {
      this.working = false;
      this.onBusy(null);
    }
  }

  async _ensureSite() {
    if (this.site) return this.site;
    if (!this.client) throw new NetlifyError('Non connecté');
    this.site = await this.client.getSite();
    return this.site;
  }

  /** Teste le jeton + site et charge la galerie. Ne mémorise rien d'autre en cas d'échec. */
  async login(token, siteRef) {
    return this._busy('Connexion à Netlify…', async () => {
      const c = this.clientFactory(String(token).trim(), siteRef);
      const s = await c.getSite();
      const g = await c.fetchGallery(s.baseUrl);
      this.client = c;
      this.site = s;
      this.gallery = g;
      return this.snapshot();
    });
  }

  /** Connexion automatique avec des identifiants déjà enregistrés. */
  async restore(token, siteRef) {
    this.client = this.clientFactory(String(token).trim(), siteRef);
    this.site = null;
    this.gallery = null;
    try {
      return await this.refresh();
    } catch (e) {
      return { ...this.snapshot(), error: e.message };
    }
  }

  async refresh() {
    return this._busy('Actualisation…', async () => {
      if (!this.client) throw new NetlifyError('Non connecté');
      const s = await this._ensureSite();
      this.gallery = await this.client.fetchGallery(s.baseUrl);
      return this.snapshot();
    });
  }

  logout() {
    this.client = null;
    this.site = null;
    this.gallery = null;
  }

  /** Relit la galerie en ligne, applique la modification, publie une nouvelle version du site. */
  async _applyChange(mutate, newFiles, removePaths) {
    const c = this.client;
    if (!c) throw new NetlifyError('Non connecté');
    const s = await this._ensureSite();

    this.onBusy('Lecture de la galerie en ligne…');
    const updated = mutate(await c.fetchGallery(s.baseUrl));

    this.onBusy('Lecture des fichiers du site…');
    const existing = await c.listFiles(s.id);

    const dataBuf = Buffer.from(galleryToJs(updated), 'utf8');
    const uploads = [{ path: '/galerie-data.js', sha1: sha1Of(dataBuf), data: dataBuf }];
    for (const nf of newFiles) uploads.push({ path: '/' + nf.path, sha1: sha1Of(nf.data), data: nf.data });

    const manifest = { ...existing };
    for (const r of removePaths) delete manifest['/' + r];
    for (const u of uploads) manifest[u.path] = u.sha1;

    await c.deploy(s.id, manifest, uploads, (step) => this.onBusy(step));
    this.gallery = updated;
    return this.snapshot();
  }

  /**
   * Ajoute une ou plusieurs photos (déjà redimensionnées en JPEG) en UNE seule publication.
   * @param {string} categoryId
   * @param {{data: Uint8Array, caption: string}[]} items
   */
  addPhotos(categoryId, items) {
    return this._busy('Préparation des photos…', async () => {
      if (!items || items.length === 0) throw new NetlifyError('Aucune photo à publier.');
      const st = stamp();
      const files = [];
      const photos = [];
      items.forEach((it, i) => {
        const name = 'images/up-' + st + (items.length > 1 ? '-' + (i + 1) : '') + '.jpg';
        const cap = String(it.caption || '').trim();
        files.push({ path: name, data: Buffer.from(it.data) });
        photos.push({ src: name, cap });
      });
      return this._applyChange(
        (g) => {
          const cat = g.categories.find((c) => c.id === categoryId);
          if (!cat) throw new NetlifyError('Catégorie introuvable : ' + categoryId);
          for (const p of photos) {
            cat.photos.push({ src: p.src, alt: p.cap || displayTitle(cat), caption: p.cap });
          }
          return g;
        },
        files,
        []
      );
    });
  }

  deletePhoto(categoryId, src) {
    return this._busy('Suppression de la photo…', () => {
      // Seules les photos ajoutées par l'application sont effacées physiquement :
      // les images d'origine peuvent aussi servir sur d'autres pages du site.
      const remove = src.startsWith('images/up-') ? [src] : [];
      return this._applyChange(
        (g) => {
          const cat = g.categories.find((c) => c.id === categoryId);
          if (cat) cat.photos = cat.photos.filter((p) => p.src !== src);
          return g;
        },
        [],
        remove
      );
    });
  }

  /**
   * @param {string} videoPath  chemin du fichier .mp4 sur le disque
   * @param {Uint8Array|null} poster  miniature JPEG (facultative)
   * @param {'tall'|'wide'} format
   */
  addVideo(videoPath, poster, format) {
    return this._busy('Lecture de la vidéo…', async () => {
      if (!/\.mp4$/i.test(videoPath)) throw new NetlifyError('Format non pris en charge. Choisissez une vidéo MP4.');
      const stat = await fs.promises.stat(videoPath);
      if (stat.size > MAX_VIDEO_BYTES) {
        throw new NetlifyError('Vidéo trop lourde (plus de 100 Mo). Compressez-la avant l\'envoi.');
      }
      const video = await fs.promises.readFile(videoPath);
      const st = stamp();
      const vPath = 'videos/up-' + st + '.mp4';
      const pPath = 'images/up-poster-' + st + '.jpg';
      const hasPoster = !!poster && poster.length > 0;
      const item = { src: vPath, poster: hasPoster ? pPath : '', format: format === 'tall' ? 'tall' : 'wide' };
      const files = [{ path: vPath, data: video }];
      if (hasPoster) files.push({ path: pPath, data: Buffer.from(poster) });
      return this._applyChange(
        (g) => {
          g.videos.push(item);
          return g;
        },
        files,
        []
      );
    });
  }

  deleteVideo(src) {
    return this._busy('Suppression de la vidéo…', () => {
      const remove = [];
      return this._applyChange(
        (g) => {
          const v = g.videos.find((x) => x.src === src);
          if (v) {
            if (String(v.src).startsWith('videos/')) remove.push(v.src);
            const poster = String(v.poster || '');
            if (poster.startsWith('images/video-poster-') || poster.startsWith('images/up-poster-')) remove.push(poster);
          }
          g.videos = g.videos.filter((x) => x.src !== src);
          return g;
        },
        [],
        remove
      );
    });
  }
}

module.exports = { GalleryService, MAX_VIDEO_BYTES };
