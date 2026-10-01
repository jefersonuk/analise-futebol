// Markdown -> HTML para a resposta do especialista. Tudo é escapado antes de formatar,
// e só links http(s) viram <a>: o texto do modelo nunca injeta HTML na página.

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inline(raw) {
  const code = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
}

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const isSep = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function renderMarkdown(md) {
  const lines = md.replace(/\r/g, '').split('\n'), out = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };

  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      i++;
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      out.push(`<div class="scroll"><table><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr>${
        rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }
    if ((m = line.match(/^(\s*)([-*]|\d+\.)\s+/))) {
      flush();
      const ordered = /\d/.test(m[2]), items = [];
      for (; i < lines.length; i++) {
        const lm = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (lm && lm[1].length < 2 && /\d/.test(lm[2]) !== ordered) break;   // troca de lista com marcador para numerada
        if (lm) items.push({ depth: lm[1].length >= 2 ? 1 : 0, text: lm[3] });
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1].text += ` ${lines[i].trim()}`;
        else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(it => `<li${it.depth ? ' class="sub"' : ''}>${inline(it.text)}</li>`).join('')}</${tag}>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}
