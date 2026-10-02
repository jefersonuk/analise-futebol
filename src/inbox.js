// Caixa de entrada das apostas enviadas pela análise, também na nuvem: o arquivo inbox/apostas.json no
// repositório privado do cache (o mesmo da ☁️ nuvem do app de análise). Assim a aposta é registrada pelo
// app de apostas de QUALQUER aparelho sincronizado, não só pelo navegador de onde ela saiu (que pode
// estar sem sync). Usado pelos dois apps (o de apostas importa este arquivo pelo mesmo endereço).
// Quem registra é sempre o app de apostas; ele tira da nuvem o que já registrou.

const API = 'https://api.github.com';
const PATH = 'inbox/apostas.json';

export const cloudCfg = () => { try { return JSON.parse(localStorage.getItem('afGithub')) || null; } catch { return null; } };

const enc = s => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(x); };
const dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));

async function gh(cfg, path, init = {}) {
  return fetch(`${API}/repos/${cfg.repo}${path}`, { cache: 'no-store', ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
}

async function read(cfg) {
  const r = await gh(cfg, `/contents/${PATH}`);
  if (r.status === 404) return { items: [], sha: null };
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao ler a caixa de entrada`);
  const j = await r.json();
  return { items: JSON.parse(dec(j.content)).items || [], sha: j.sha };
}

async function write(cfg, items, sha, message) {
  const body = { message, content: enc(JSON.stringify({ items }, null, 1)), ...(sha ? { sha } : {}) };
  const r = await gh(cfg, `/contents/${PATH}`, { method: 'PUT', body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return false;   // outro aparelho escreveu antes: lê de novo
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao gravar a caixa de entrada`);
  return true;
}

// Junta itens à caixa da nuvem (sem duplicar pelo id). Devolve false quando a nuvem não está configurada.
export async function pushItems(items, cfg = cloudCfg()) {
  if (!cfg || !items.length) return false;
  for (let i = 0; i < 4; i++) {
    const { items: cur, sha } = await read(cfg);
    const have = new Set(cur.map(x => x.id)), add = items.filter(x => !have.has(x.id));
    if (!add.length) return true;
    if (await write(cfg, cur.concat(add), sha, `caixa: +${add.length} aposta(s)`)) return true;
  }
  throw new Error('a caixa de entrada mudou várias vezes seguidas; tente de novo');
}

// Itens na nuvem, ou null sem nuvem configurada.
export async function pullItems(cfg = cloudCfg()) {
  return cfg ? (await read(cfg)).items : null;
}

// Tira da nuvem os itens já registrados.
export async function dropItems(ids, cfg = cloudCfg()) {
  if (!cfg || !ids.length) return;
  const out = new Set(ids);
  for (let i = 0; i < 4; i++) {
    const { items: cur, sha } = await read(cfg);
    const keep = cur.filter(x => !out.has(x.id));
    if (keep.length === cur.length) return;
    if (await write(cfg, keep, sha, `caixa: -${cur.length - keep.length} registrada(s)`)) return;
  }
}
