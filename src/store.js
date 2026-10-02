// Armazenamento local do navegador em IndexedDB (centenas de MB, contra ~5 MB do localStorage, que
// estourava em silêncio e fazia o app buscar tudo de novo). Na primeira abertura, migra o cache antigo
// do localStorage. A chave da API continua no localStorage.

const DB = 'analise-futebol', OS = 'cache';
let dbp = null;

function open() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OS);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).then(async db => { await migrate(db); return db; });
  return dbp;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(OS, mode), r = fn(t.objectStore(OS));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

async function migrate(db) {
  const old = Object.keys(localStorage).filter(k => k.startsWith('af:') && k !== 'af:key');
  if (!old.length) return;
  await tx(db, 'readwrite', os => {
    for (const k of old) { try { os.put(JSON.parse(localStorage.getItem(k)), k); } catch { /* entrada corrompida */ } }
  });
  for (const k of old) localStorage.removeItem(k);
}

const mem = new Map();   // cópia em memória: leituras repetidas na mesma sessão não tocam o disco

export async function load(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const db = await open();
    const v = (await tx(db, 'readonly', os => os.get(key))) ?? null;
    mem.set(key, v);
    return v;
  } catch { return null; }
}

export async function save(key, value) {
  mem.set(key, value);
  try { const db = await open(); await tx(db, 'readwrite', os => os.put(value, key)); } catch { /* segue só em memória */ }
}

export async function del(key) {
  mem.delete(key);
  try { const db = await open(); await tx(db, 'readwrite', os => os.delete(key)); } catch { /* já não existe */ }
}

export async function keys() {
  try { const db = await open(); return (await tx(db, 'readonly', os => os.getAllKeys())) || []; } catch { return [...mem.keys()]; }
}

// Uso do armazenamento do site (inclui o IndexedDB), quando o navegador informa.
export async function usage() {
  try { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage, quota: e.quota } : null; } catch { return null; }
}
