'use strict';

const $ = (id) => document.getElementById(id);

const state = { gallery: null, baseUrl: '', tab: 'photos', loadError: null };

// ---------------------------------------------------------------- utilitaires

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function assetUrl(src) {
  const clean = String(src).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return state.baseUrl + '/' + clean;
}

function displayTitle(cat) {
  return String(cat.title || cat.id || '').replace(/\*/g, '');
}

let toastTimer = null;
function toast(text, isError) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 9000 : 4000);
}

function formatSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' Mo';
  return Math.max(1, Math.round(bytes / 1024)) + ' Ko';
}

function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = okLabel || 'Confirmer';
    const dlg = $('dlg-confirm');
    const done = (v) => {
      $('confirm-ok').onclick = null;
      $('confirm-cancel').onclick = null;
      dlg.close();
      resolve(v);
    };
    $('confirm-ok').onclick = () => done(true);
    $('confirm-cancel').onclick = () => done(false);
    dlg.oncancel = (e) => {
      e.preventDefault();
      done(false);
    };
    dlg.showModal();
  });
}

// --------------------------------------------------------- opération en cours

const busyDlg = $('dlg-busy');
busyDlg.addEventListener('cancel', (e) => e.preventDefault());
window.api.onBusy((text) => setBusy(text));

function setBusy(text) {
  if (text) {
    $('busy-text').textContent = text;
    if (!busyDlg.open) busyDlg.showModal();
  } else if (busyDlg.open) {
    busyDlg.close();
  }
}

/** Appelle l'API ; affiche l'erreur éventuelle et met à jour la galerie. */
async function call(fn, successMessage) {
  const r = await fn();
  setBusy(null);
  if (!r.ok) {
    toast(r.error, true);
    return null;
  }
  if (r.gallery) {
    state.gallery = r.gallery;
    state.baseUrl = r.baseUrl;
    state.loadError = null;
    render();
  }
  if (successMessage) toast(successMessage);
  return r;
}

// ------------------------------------------------------------------ connexion

function showSetup(site) {
  $('app').classList.add('hidden');
  $('setup').classList.remove('hidden');
  if (site) $('site').value = site;
  $('token').value = '';
  updateLoginButton();
  ($('site').value ? $('token') : $('site')).focus();
}

function showApp() {
  $('setup').classList.add('hidden');
  $('app').classList.remove('hidden');
  render();
}

function updateLoginButton() {
  $('login-btn').disabled = !($('token').value.trim() && $('site').value.trim());
}
$('token').addEventListener('input', updateLoginButton);
$('site').addEventListener('input', updateLoginButton);
$('toggle-token').addEventListener('click', () => {
  const t = $('token');
  const show = t.type === 'password';
  t.type = show ? 'text' : 'password';
  $('toggle-token').textContent = show ? 'Masquer' : 'Afficher';
});

$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('login-btn').disabled) return;
  const r = await call(() => window.api.login($('token').value, $('site').value, $('remember').checked));
  if (r) {
    $('token').value = '';
    showApp();
    if (r.wantedSave && !r.tokenSaved) {
      toast("Le chiffrement Windows n'est pas disponible : le jeton ne sera pas mémorisé.", true);
    }
  }
});

$('btn-logout').addEventListener('click', async () => {
  const ok = await confirmDialog(
    'Se déconnecter ?',
    'Le jeton Netlify sera effacé de cet ordinateur. Vous devrez le saisir à nouveau.',
    'Se déconnecter'
  );
  if (!ok) return;
  const r = await window.api.logout();
  state.gallery = null;
  showSetup(r.site);
});

$('btn-refresh').addEventListener('click', () => call(() => window.api.refresh()));
$('btn-site').addEventListener('click', () => {
  if (state.baseUrl) window.api.openSite(state.baseUrl);
});

$('tab-photos').addEventListener('click', () => switchTab('photos'));
$('tab-videos').addEventListener('click', () => switchTab('videos'));
function switchTab(tab) {
  state.tab = tab;
  $('tab-photos').classList.toggle('active', tab === 'photos');
  $('tab-videos').classList.toggle('active', tab === 'videos');
  render();
}

// ------------------------------------------------------------------- affichage

function render() {
  const content = $('content');
  const scroll = content.scrollTop;
  content.replaceChildren();
  const g = state.gallery;
  if (!g) {
    content.append(
      h(
        'div',
        { class: 'center-box' },
        h('p', {}, state.loadError ? 'La galerie n\'est pas chargée : ' + state.loadError : "La galerie n'est pas chargée."),
        h('button', { class: 'primary', onclick: () => call(() => window.api.refresh()) }, 'Réessayer')
      )
    );
    return;
  }
  content.append(h('div', { class: 'inner' }, state.tab === 'photos' ? renderPhotos(g) : renderVideos(g)));
  content.scrollTop = scroll;
}

function thumb({ url, caption, play, onDelete }) {
  return h(
    'div',
    { class: 'thumb' },
    url ? h('img', { src: url, alt: caption || '', loading: 'lazy' }) : null,
    play ? h('div', { class: 'play' }, '▶') : null,
    caption ? h('div', { class: 'cap' }, caption) : null,
    h('button', { class: 'del', title: 'Supprimer', 'aria-label': 'Supprimer', onclick: onDelete }, '🗑')
  );
}

function renderPhotos(g) {
  return g.categories.map((cat) => {
    const section = h(
      'div',
      { class: 'cat' },
      h(
        'div',
        { class: 'cat-head' },
        h('div', {}, h('h3', {}, displayTitle(cat)), h('span', { class: 'muted small' }, cat.photos.length + ' photo(s)')),
        h('button', { class: 'outline', onclick: () => pickPhotos(cat.id) }, '+ Ajouter des photos')
      ),
      cat.photos.length === 0
        ? h('div', { class: 'empty' }, 'Aucune photo dans cette catégorie.')
        : h(
            'div',
            { class: 'grid' },
            cat.photos.map((p) =>
              thumb({
                url: assetUrl(p.src),
                caption: p.caption,
                onDelete: () => removePhoto(cat.id, p.src)
              })
            )
          )
    );
    // Glisser-déposer des photos directement sur une catégorie
    section.addEventListener('dragover', (e) => {
      e.preventDefault();
      section.classList.add('dragover');
    });
    section.addEventListener('dragleave', () => section.classList.remove('dragover'));
    section.addEventListener('drop', (e) => {
      e.preventDefault();
      section.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length) openPhotoDialog(cat.id, files);
    });
    return section;
  });
}

function renderVideos(g) {
  return [
    h(
      'div',
      { class: 'video-bar' },
      h('h3', {}, g.videos.length + ' vidéo(s)'),
      h('button', { class: 'primary', onclick: () => $('file-video').click() }, '+ Ajouter une vidéo')
    ),
    g.videos.length === 0
      ? h('div', { class: 'empty' }, 'Aucune vidéo.')
      : h(
          'div',
          { class: 'grid' },
          g.videos.map((v) =>
            thumb({
              url: v.poster ? assetUrl(v.poster) : '',
              caption: v.format === 'tall' ? 'Vertical' : 'Paysage / carré',
              play: true,
              onDelete: () => removeVideo(v.src)
            })
          )
        )
  ];
}

// --------------------------------------------------------------------- photos

let photoCat = null;
let photoFiles = []; // [{ file, url, caption }]

function pickPhotos(catId) {
  photoCat = catId;
  $('file-photos').value = '';
  $('file-photos').click();
}

$('file-photos').addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length && photoCat) openPhotoDialog(photoCat, files);
});

function openPhotoDialog(catId, files) {
  const dlg = $('dlg-photos');
  if (!dlg.open) {
    photoCat = catId;
    photoFiles = [];
  }
  for (const f of files) photoFiles.push({ file: f, url: URL.createObjectURL(f), caption: '' });
  const cat = state.gallery.categories.find((c) => c.id === photoCat);
  $('photos-cat').textContent = 'Catégorie : ' + (cat ? displayTitle(cat) : '');
  renderPhotoList();
  if (!dlg.open) dlg.showModal();
}

function renderPhotoList() {
  const list = $('photos-list');
  list.replaceChildren(
    ...photoFiles.map((p, i) =>
      h(
        'div',
        { class: 'photo-row' },
        h('img', { src: p.url, alt: '' }),
        (() => {
          const input = h('input', { type: 'text', placeholder: 'Légende (facultatif) — ' + p.file.name });
          input.value = p.caption;
          input.addEventListener('input', () => (p.caption = input.value));
          return input;
        })(),
        h(
          'button',
          {
            class: 'ghost rm',
            title: 'Retirer',
            onclick: () => {
              URL.revokeObjectURL(p.url);
              photoFiles.splice(i, 1);
              if (photoFiles.length === 0) closePhotoDialog();
              else renderPhotoList();
            }
          },
          '✕'
        )
      )
    )
  );
  $('photos-ok').textContent = photoFiles.length > 1 ? 'Publier ' + photoFiles.length + ' photos' : 'Publier';
}

function closePhotoDialog() {
  for (const p of photoFiles) URL.revokeObjectURL(p.url);
  photoFiles = [];
  $('dlg-photos').close();
}

$('photos-more').addEventListener('click', () => {
  $('file-photos').value = '';
  $('file-photos').click();
});
$('photos-cancel').addEventListener('click', closePhotoDialog);
$('dlg-photos').addEventListener('cancel', (e) => {
  e.preventDefault();
  closePhotoDialog();
});

$('photos-ok').addEventListener('click', async () => {
  const batch = photoFiles.slice();
  const catId = photoCat;
  $('dlg-photos').close();
  setBusy('Préparation des photos…');
  const items = [];
  try {
    for (let i = 0; i < batch.length; i++) {
      setBusy('Préparation de la photo ' + (i + 1) + '/' + batch.length + '…');
      items.push({ data: await prepareImage(batch[i].file), caption: batch[i].caption });
    }
  } catch (err) {
    setBusy(null);
    toast('Image illisible : ' + (err && err.message ? err.message : err), true);
    $('dlg-photos').showModal(); // on rouvre la boîte : les fichiers sont conservés
    return;
  }
  for (const p of batch) URL.revokeObjectURL(p.url);
  photoFiles = [];
  await call(
    () => window.api.addPhotos(catId, items),
    items.length > 1 ? items.length + ' photos ajoutées et publiées ✅' : 'Photo ajoutée et publiée ✅'
  );
});

/** Redimensionne (1600 px max), applique l'orientation EXIF et compresse en JPEG. */
async function prepareImage(file, maxSide = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hh = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hh;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, hh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, hh);
  bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('compression impossible');
  return new Uint8Array(await blob.arrayBuffer());
}

async function removePhoto(catId, src) {
  const ok = await confirmDialog('Supprimer cette photo ?', 'Elle disparaîtra de la galerie du site.', 'Supprimer');
  if (ok) await call(() => window.api.deletePhoto(catId, src), 'Photo supprimée de la galerie ✅');
}

// --------------------------------------------------------------------- vidéos

let pendingVideo = null; // { path, name, size, format, poster }

$('file-video').addEventListener('change', async (e) => {
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file) return;
  if (!/\.mp4$/i.test(file.name)) {
    toast('Format non pris en charge. Choisissez une vidéo MP4.', true);
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    toast('Vidéo trop lourde (plus de 100 Mo). Compressez-la avant l\'envoi.', true);
    return;
  }
  setBusy('Lecture de la vidéo…');
  const meta = await readVideo(file);
  setBusy(null);
  pendingVideo = {
    path: window.api.pathOf(file),
    name: file.name,
    size: file.size,
    format: meta.width > 0 && meta.height > 0 && meta.width / meta.height < 0.7 ? 'tall' : 'wide',
    poster: meta.poster
  };
  $('video-name').textContent = file.name;
  $('video-info').textContent =
    formatSize(file.size) +
    (meta.width ? ' · ' + meta.width + '×' + meta.height + (pendingVideo.format === 'tall' ? ' (vertical)' : '') : '') +
    (meta.poster ? '' : ' · miniature indisponible');
  $('dlg-video').showModal();
});

$('video-cancel').addEventListener('click', () => {
  pendingVideo = null;
  $('dlg-video').close();
});
$('dlg-video').addEventListener('cancel', () => {
  pendingVideo = null;
});
$('video-ok').addEventListener('click', async () => {
  const v = pendingVideo;
  pendingVideo = null;
  $('dlg-video').close();
  if (!v) return;
  setBusy('Envoi de la vidéo…');
  await call(() => window.api.addVideo(v.path, v.poster, v.format), 'Vidéo ajoutée et publiée ✅');
});

/** Dimensions + image d'aperçu (≈ 1 s) ; renvoie quand même un résultat si la vidéo n'est pas décodable. */
function readVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    let finished = false;
    const finish = (res) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      resolve(res);
    };
    const timer = setTimeout(() => finish({ width: v.videoWidth || 0, height: v.videoHeight || 0, poster: null }), 10000);
    v.onerror = () => finish({ width: 0, height: 0, poster: null });
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
    v.onseeked = async () => {
      try {
        const maxSide = 640;
        const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(v.videoWidth * s));
        c.height = Math.max(1, Math.round(v.videoHeight * s));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
        const poster = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
        finish({ width: v.videoWidth, height: v.videoHeight, poster });
      } catch (e) {
        finish({ width: v.videoWidth, height: v.videoHeight, poster: null });
      }
    };
    v.src = url;
  });
}

async function removeVideo(src) {
  const ok = await confirmDialog('Supprimer cette vidéo ?', 'Elle disparaîtra de la galerie du site.', 'Supprimer');
  if (ok) await call(() => window.api.deleteVideo(src), 'Vidéo supprimée de la galerie ✅');
}

// ------------------------------------------------------------------- démarrage

(async function start() {
  setBusy('Démarrage…');
  const r = await window.api.init();
  setBusy(null);
  if (r.ok && r.configured) {
    state.gallery = r.gallery || null;
    state.baseUrl = r.baseUrl || '';
    state.loadError = r.error || null;
    showApp();
    if (r.error) toast(r.error, true);
  } else {
    showSetup(r.site);
    if (!r.ok) toast(r.error, true);
  }
})();
