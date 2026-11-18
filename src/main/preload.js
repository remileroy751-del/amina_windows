'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  login: (token, site, remember) => ipcRenderer.invoke('login', token, site, remember),
  logout: () => ipcRenderer.invoke('logout'),
  refresh: () => ipcRenderer.invoke('refresh'),
  addPhotos: (categoryId, items) => ipcRenderer.invoke('addPhotos', categoryId, items),
  deletePhoto: (categoryId, src) => ipcRenderer.invoke('deletePhoto', categoryId, src),
  addVideo: (videoPath, poster, format) => ipcRenderer.invoke('addVideo', videoPath, poster, format),
  deleteVideo: (src) => ipcRenderer.invoke('deleteVideo', src),
  openSite: (url) => ipcRenderer.invoke('openSite', url),
  pathOf: (file) => webUtils.getPathForFile(file),
  onBusy: (cb) => ipcRenderer.on('busy', (_e, text) => cb(text))
});
