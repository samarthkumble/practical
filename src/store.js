// Local storage for participants and sessions (IndexedDB inside the app).
// Nothing here ever leaves the laptop unless someone presses Export.

const DB = 'practical';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('participants')) db.createObjectStore('participants', { keyPath: 'code' });
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('participant', 'participant');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp = null;
const db = () => (dbp ||= open());

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((r) => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  async participants() {
    return tx('participants', 'readonly', (s) => req2p(s.getAll()));
  },
  async participant(code) {
    return tx('participants', 'readonly', (s) => req2p(s.get(code)));
  },
  async saveParticipant(p) {
    return tx('participants', 'readwrite', (s) => req2p(s.put(p)));
  },
  async nextCode() {
    const ps = await this.participants();
    let n = 1;
    const used = new Set(ps.map((p) => p.code));
    while (used.has(`P${String(n).padStart(2, '0')}`)) n++;
    return `P${String(n).padStart(2, '0')}`;
  },
  async sessions(participant) {
    const all = await tx('sessions', 'readonly', (s) => req2p(s.getAll()));
    return (participant ? all.filter((x) => x.participant === participant) : all)
      .sort((a, b) => a.startedAt - b.startedAt);
  },
  async saveSession(session) {
    return tx('sessions', 'readwrite', (s) => req2p(s.put(session)));
  },
  // Withdrawal: delete every session and the consent record for this code.
  async deleteParticipant(code) {
    const ss = await this.sessions(code);
    await tx('sessions', 'readwrite', (s) => Promise.all(ss.map((x) => req2p(s.delete(x.id)))));
    await tx('participants', 'readwrite', (s) => req2p(s.delete(code)));
  },
  async getMeta(key, fallback = null) {
    const r = await tx('meta', 'readonly', (s) => req2p(s.get(key)));
    return r ? r.value : fallback;
  },
  async setMeta(key, value) {
    return tx('meta', 'readwrite', (s) => req2p(s.put({ key, value })));
  },
};
