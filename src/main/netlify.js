'use strict';
// Client de l'API Netlify + lecture/écriture de galerie-data.js.
// Portage de NetlifyClient.kt et Models.kt de l'application Android.

const crypto = require('crypto');

class NetlifyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetlifyError';
  }
}

function sha1Of(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/** Accepte « nom.netlify.app », « https://nom.netlify.app/ » ou un identifiant de projet. */
function normalizeSite(ref) {
  return String(ref || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split(/[/?#]/)[0]
    .trim();
}

/** Encode chaque segment d'un chemin de fichier. */
function encodePath(p) {
  return p
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

// ---------------------------------------------------------------------------
// Galerie : window.AMINA_GALERIE = { version, categories[], videos[] };
// On conserve l'objet d'origine tel quel (champs inconnus compris).
// ---------------------------------------------------------------------------

function parseGallery(js) {
  const start = js.indexOf('{');
  const end = js.lastIndexOf('}');
  if (start < 0 || end <= start) throw new NetlifyError('Fichier galerie-data.js invalide');
  let root;
  try {
    root = JSON.parse(js.substring(start, end + 1));
  } catch (e) {
    throw new NetlifyError('Fichier galerie-data.js illisible : ' + e.message);
  }
  if (!Array.isArray(root.categories)) root.categories = [];
  if (!Array.isArray(root.videos)) root.videos = [];
  if (root.version === undefined) root.version = 1;
  for (const c of root.categories) {
    if (!Array.isArray(c.photos)) c.photos = [];
  }
  return root;
}

function galleryToJs(gallery) {
  return 'window.AMINA_GALERIE = ' + JSON.stringify(gallery, null, 2) + ';\n';
}

function displayTitle(category) {
  return String(category.title || category.id || '').replace(/\*/g, '');
}

// ---------------------------------------------------------------------------

class NetlifyClient {
  /**
   * @param {string} token    jeton d'accès personnel Netlify
   * @param {string} siteRef  adresse du site ou identifiant
   * @param {object} [opts]   { apiBase, fetchImpl } (surtout pour les tests)
   */
  constructor(token, siteRef, opts = {}) {
    this.token = token;
    this.siteRef = normalizeSite(siteRef);
    this.api = opts.apiBase || 'https://api.netlify.com/api/v1';
    this.fetch = opts.fetchImpl || ((...a) => fetch(...a));
    this.retryDelayMs = opts.retryDelayMs === undefined ? 1500 : opts.retryDelayMs;
    this.pollDelayMs = opts.pollDelayMs === undefined ? 2000 : opts.pollDelayMs;
  }

  async _fetch(url, init, timeoutMs) {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const reason = e && e.name === 'TimeoutError' ? 'délai dépassé' : (e && e.cause && e.cause.code) || (e && e.message) || String(e);
      throw new NetlifyError('Connexion impossible ou interrompue : ' + reason);
    }
  }

  _authHeaders(extra) {
    return { Authorization: 'Bearer ' + this.token, ...(extra || {}) };
  }

  async _execute(url, init = {}, timeoutMs = 120000) {
    const resp = await this._fetch(url, { ...init, headers: this._authHeaders(init.headers) }, timeoutMs);
    const text = await resp.text();
    if (!resp.ok) {
      let msg;
      if (resp.status === 401) msg = 'Jeton Netlify refusé (401). Vérifiez le jeton.';
      else if (resp.status === 404) msg = "Introuvable (404). Vérifiez l'adresse ou l'identifiant du site.";
      else msg = 'Erreur Netlify ' + resp.status + ' : ' + text.slice(0, 200);
      throw new NetlifyError(msg);
    }
    return text;
  }

  /** Vérifie le jeton et le site ; renvoie l'identifiant et l'adresse publique. */
  async getSite() {
    const json = JSON.parse(await this._execute(this.api + '/sites/' + encodeURIComponent(this.siteRef)));
    let base = json.ssl_url || json.url || '';
    if (!base) throw new NetlifyError('Adresse publique du site introuvable.');
    return { id: json.id, baseUrl: base.replace(/\/+$/, '') };
  }

  /** Lit la galerie actuellement en ligne (galerie-data.js). */
  async fetchGallery(baseUrl) {
    const resp = await this._fetch(
      baseUrl + '/galerie-data.js?t=' + Date.now(),
      { headers: { 'Cache-Control': 'no-cache' } },
      60000
    );
    if (resp.status === 404) {
      throw new NetlifyError(
        "galerie-data.js est introuvable sur le site. Publiez d'abord le site mis à jour (zip fourni avec l'application)."
      );
    }
    if (!resp.ok) throw new NetlifyError('Lecture de la galerie impossible (' + resp.status + ').');
    return parseGallery(await resp.text());
  }

  /** Fichiers du site publié : chemin -> empreinte SHA-1. */
  async listFiles(siteId) {
    const arr = JSON.parse(await this._execute(this.api + '/sites/' + siteId + '/files'));
    const out = {};
    for (const o of arr) {
      let p = o.path || o.id || '';
      const sha = o.sha || '';
      if (p && sha) out[p.startsWith('/') ? p : '/' + p] = sha;
    }
    if (Object.keys(out).length === 0) {
      throw new NetlifyError('La liste des fichiers du site est vide : opération annulée pour protéger le site.');
    }
    return out;
  }

  /**
   * Publie une nouvelle version : manifest = liste COMPLÈTE des fichiers (chemin -> SHA-1) ;
   * seuls les fichiers demandés par Netlify parmi uploads [{path, sha1, data}] sont envoyés.
   */
  async deploy(siteId, manifest, uploads, onStep = () => {}) {
    onStep('Préparation de la mise en ligne…');
    const created = JSON.parse(
      await this._execute(this.api + '/sites/' + siteId + '/deploys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: manifest })
      })
    );
    const deployId = created.id;
    const required = Array.from(new Set(created.required || []));

    let n = 0;
    for (const sha of required) {
      const up = uploads.find((u) => u.sha1 === sha);
      if (!up) throw new NetlifyError("Netlify demande un fichier que l'application ne possède pas. Réessayez.");
      n++;
      onStep('Envoi du fichier ' + n + '/' + required.length + ' : ' + up.path.split('/').pop());
      await this._putWithRetry(this.api + '/deploys/' + deployId + '/files/' + encodePath(up.path), up.data);
    }

    onStep('Publication en cours…');
    let info = created;
    let attempts = 0;
    while (info.state !== 'ready') {
      if (info.state === 'error') throw new NetlifyError('Erreur de publication : ' + (info.error_message || ''));
      attempts++;
      if (attempts > 90) throw new NetlifyError('La publication prend trop de temps. Vérifiez sur Netlify.');
      await new Promise((r) => setTimeout(r, this.pollDelayMs));
      info = JSON.parse(await this._execute(this.api + '/deploys/' + deployId));
    }

    // Si le site n'est pas en publication automatique, on publie cette version.
    if (info.published_at === null || info.published_at === undefined) {
      try {
        await this._execute(this.api + '/sites/' + siteId + '/deploys/' + deployId + '/restore', { method: 'POST', body: '' });
      } catch (e) {
        // sans gravité : la version est prête sur Netlify
      }
    }
  }

  async _putWithRetry(url, data) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this._execute(
          url,
          { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data },
          15 * 60 * 1000
        );
        return;
      } catch (e) {
        lastErr = e;
        if (/\((401|404)\)/.test(e.message)) break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
      }
    }
    throw lastErr;
  }
}

module.exports = { NetlifyClient, NetlifyError, sha1Of, normalizeSite, encodePath, parseGallery, galleryToJs, displayTitle };
