'use strict';

const { app, BrowserWindow, ipcMain, shell, safeStorage, Menu } = require('electron');
const path = require('path');
const { GalleryService } = require('./service');
const { Store } = require('./store');
const { normalizeSite } = require('./netlify');

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

const service = new GalleryService({
  onBusy: (text) => {
    if (win && !win.isDestroyed()) win.webContents.send('busy', text);
  }
});

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    title: 'AMINA-FDS · Galerie',
    backgroundColor: '#F4EAD9',
    icon: path.join(__dirname, '..', 'renderer', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Aucune navigation hors de l'application ; les liens https s'ouvrent dans le navigateur.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    win = null;
  });
}

/** Enveloppe un traitement : renvoie { ok:true, ...données } ou { ok:false, error }. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

app.whenReady().then(() => {
  const store = new Store(app.getPath('userData'), safeStorage);

  handle('init', async () => {
    const site = store.site;
    const token = await store.getToken();
    if (site && token) {
      const r = await service.restore(token, site);
      return { configured: true, site, ...r };
    }
    return { configured: false, site };
  });

  handle('login', async (token, siteRef, remember) => {
    const site = normalizeSite(siteRef);
    const r = await service.login(token, site);
    const saved = await store.save(site, String(token).trim(), !!remember);
    return { ...r, tokenSaved: saved, wantedSave: !!remember };
  });

  handle('logout', async () => {
    service.logout();
    store.forgetToken();
    return { site: store.site };
  });

  handle('refresh', () => service.refresh());
  handle('addPhotos', (categoryId, items) => service.addPhotos(categoryId, items));
  handle('deletePhoto', (categoryId, src) => service.deletePhoto(categoryId, src));
  handle('addVideo', (videoPath, poster, format) => service.addVideo(videoPath, poster, format));
  handle('deleteVideo', (src) => service.deleteVideo(src));
  handle('openSite', async (url) => {
    if (/^https:\/\//i.test(url)) await shell.openExternal(url);
    return {};
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
