'use strict';
// Mémorisation locale : le jeton est chiffré avec l'API Windows (DPAPI) via Electron safeStorage,
// il n'est lisible que par cet utilisateur Windows sur cet ordinateur.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'amina-config.json');
    this.safe = safeStorage;
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      return {};
    }
  }

  _write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(data), 'utf8');
  }

  get site() {
    return this._read().site || '';
  }

  async getToken() {
    const enc = this._read().token;
    if (!enc) return '';
    try {
      if (!(await this.safe.isAsyncEncryptionAvailable())) return '';
      const r = await this.safe.decryptStringAsync(Buffer.from(enc, 'base64'));
      return r.result;
    } catch (e) {
      return '';
    }
  }

  /** @returns {boolean} true si le jeton a bien été mémorisé */
  async save(site, token, remember) {
    const data = { site };
    let saved = false;
    try {
      if (remember && (await this.safe.isAsyncEncryptionAvailable())) {
        data.token = (await this.safe.encryptStringAsync(token)).toString('base64');
        saved = true;
      }
    } catch (e) {
      saved = false;
    }
    this._write(data);
    return saved;
  }

  /** Oublie le jeton, garde l'adresse du site pour préremplir le formulaire. */
  forgetToken() {
    const data = this._read();
    delete data.token;
    this._write(data);
  }
}

module.exports = { Store };
