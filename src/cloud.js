// Cache compartilhado entre dispositivos num repositório PRIVADO do GitHub. Os jogos baixados de cada
// liga/time e os escanteios do 1º tempo viram um arquivo cada (cache/af_lg_71_2026.json…). Antes de
// usar a cópia local, o app confere (1 requisição por sessão, a árvore do repositório) se outro
// dispositivo mandou versão nova; se mandou, baixa e junta com a local. Depois de salvar, envia.
// Funciona no navegador e no Node (script do especialista). O token fica só no dispositivo.
//
// withCloud({ load, save }, { repo, token, branch }) -> { load, save, flush, pushAll, status }

const API = 'https://api.github.com';
const SYNCED = /^af:(lg|tm|h1):|^af:teamIndex$/;   // pesado e estável; o resto é barato de rebuscar
const TREE_TTL = 10 * 60e3;
const DEBOUNCE = 4000;

export const synced = key => SYNCED.test(key);
export const pathOf = key => `cache/${key.replace(/[^\w.-]/g, '_')}.json`;

// Junta duas cópias da mesma chave sem perder nada: jogos de um lado e do outro; estatística e
// escanteios do 1º tempo de quem tiver; a data de atualização da cópia mais recente.
export function merge(key, a, b) {
  if (!a) return b;
  if (!b) return a;
  if (/^af:(lg|tm):/.test(key)) {
    const m = { ...b.m };
    for (const [id, x] of Object.entries(a.m || {})) {
      const y = m[id];
      m[id] = !y ? x : y.s === undefined && x.s !== undefined ? x : y;
    }
    const newer = (a.t || 0) >= (b.t || 0) ? a : b;
    return { t: newer.t, next: newer.next ?? null, m };
  }
  if (/^af:h1:/.test(key)) {
    const m = { ...b.m };
    for (const [id, x] of Object.entries(a.m || {})) if (m[id] == null && (x != null || !(id in m))) m[id] = x;
    return { m };
  }
  if (key === 'af:teamIndex') return { ...b, ...a };
  return a;
}

function b64(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function withCloud(local, { repo, token, branch = 'main' }) {
  const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const gh = (p, init = {}) => fetch(`${API}/repos/${repo}${p}`, { cache: 'no-store', ...init, headers: { ...H, ...init.headers } });
  const st = { ok: null, error: null, files: 0, down: 0, up: 0, lastUp: null, privateRepo: null };
  const known = new Map();     // chave -> sha da versão da nuvem que já está juntada na cópia local
  let tree = null, treeAt = 0, treeP = null, checkP = null, empty = false;
  const timers = new Map(), inflight = new Set();

  // Repositório existe, o token alcança e é privado (dados da API não podem ficar públicos).
  function check() {
    return checkP ??= (async () => {
      const r = await gh('');
      if (!r.ok) throw new Error(r.status === 404 ? `repositório ${repo} não encontrado (ou o token não tem acesso)` : r.status === 401 ? 'token do GitHub inválido' : `GitHub respondeu ${r.status}`);
      const info = await r.json();
      st.privateRepo = info.private;
      if (!info.private) throw new Error(`o repositório ${repo} é público: o cache só pode ir para um repositório privado`);
      if (info.default_branch) branch = info.default_branch;
      st.ok = true;
    })().catch(e => { st.ok = false; st.error = e.message; throw e; });
  }

  async function getTree(force = false) {
    if (!force && tree && Date.now() - treeAt < TREE_TTL) return tree;
    return treeP ??= (async () => {
      await check();
      const r = await gh(`/git/trees/${branch}?recursive=1`);
      const next = new Map();
      if (r.ok) {
        for (const f of (await r.json()).tree || []) if (f.type === 'blob') next.set(f.path, f.sha);
      } else if (r.status === 404 || r.status === 409) empty = true;   // repositório ainda sem nenhum arquivo
      else throw new Error(`GitHub respondeu ${r.status} ao listar o cache`);
      tree = next; treeAt = Date.now(); st.files = [...next.keys()].filter(p => p.startsWith('cache/')).length;
      return tree;
    })().finally(() => { treeP = null; });
  }

  async function download(p) {
    const r = await gh(`/contents/${p}?ref=${branch}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!r.ok) return null;
    st.down++;
    return r.json();
  }

  async function upload(key) {
    const p = pathOf(key);
    for (let tries = 0; tries < 3; tries++) {
      const t = await getTree(tries > 0);
      let value = await local.load(key);
      if (!value) return;
      const remoteSha = t.get(p);
      if (remoteSha && remoteSha !== known.get(key)) {   // outro dispositivo mandou antes: junta primeiro
        value = merge(key, value, await download(p));
        await local.save(key, value);
        known.set(key, remoteSha);
      }
      const body = { message: `cache ${key}`, content: b64(JSON.stringify(value)), ...(empty ? {} : { branch }), ...(remoteSha ? { sha: remoteSha } : {}) };
      const r = await gh(`/contents/${p}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      if (r.ok) {
        const sha = (await r.json()).content.sha;
        t.set(p, sha); known.set(key, sha); empty = false;
        st.up++; st.lastUp = new Date().toISOString(); st.files = [...t.keys()].filter(x => x.startsWith('cache/')).length;
        return;
      }
      if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub respondeu ${r.status} ao enviar ${p}`);
    }
  }

  function schedule(key) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      const p = upload(key).catch(e => { st.error = e.message; }).finally(() => inflight.delete(p));
      inflight.add(p);
    }, DEBOUNCE));
  }

  return {
    status: () => ({ ...st, repo }),
    check: () => check().then(() => getTree(true)),

    async load(key) {
      const mine = await local.load(key);
      if (!synced(key)) return mine;
      try {
        const sha = (await getTree()).get(pathOf(key));
        if (!sha) { if (mine) schedule(key); return mine; }          // só aqui: sobe a cópia local
        if (sha === known.get(key)) return mine;
        const theirs = await download(pathOf(key));
        const merged = merge(key, mine, theirs);
        known.set(key, sha);
        if (JSON.stringify(merged) !== JSON.stringify(mine)) await local.save(key, merged);
        if (mine && JSON.stringify(merged) !== JSON.stringify(theirs)) schedule(key);   // a local tinha o que faltava lá
        return merged;
      } catch (e) { st.error = e.message; return mine; }              // sem nuvem: segue com o local
    },

    async save(key, value) {
      await local.save(key, value);
      if (synced(key)) schedule(key);
    },

    // Envia já o que está agendado (Node: antes de sair).
    async flush() {
      for (const [key, t] of timers) {
        clearTimeout(t); timers.delete(key);
        const p = upload(key).catch(e => { st.error = e.message; });
        inflight.add(p);
      }
      await Promise.all([...inflight]);
    },

    // Sobe todo o cache local deste dispositivo (primeira conexão).
    async pushAll(keys, onProgress) {
      const list = keys.filter(synced);
      let done = 0;
      for (const key of list) {
        try { await upload(key); } catch (e) { st.error = e.message; }
        onProgress?.(++done, list.length);
      }
      return list.length;
    },
  };
}
