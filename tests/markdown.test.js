import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

test('escapa HTML do modelo e só aceita links http(s)', () => {
  const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [fonte](https://ge.globo.com/a)');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<a href="https://ge.globo.com/a" target="_blank" rel="noopener noreferrer">fonte</a>'));
});

test('títulos, negrito, tabela e listas', () => {
  const md = [
    '## Casa x Fora — Liga, 03/10 21:00',
    '',
    '**Veredito:** entrar no *under*.',
    '',
    '| Linha | Odd mínima |',
    '|---|---|',
    '| Menos de 2,5 | 1,76 |',
    '',
    '- item um',
    '  - subitem',
    '1. primeiro',
  ].join('\n');
  const html = renderMarkdown(md);
  assert.ok(html.includes('<h3>Casa x Fora — Liga, 03/10 21:00</h3>'));
  assert.ok(html.includes('<strong>Veredito:</strong> entrar no <em>under</em>.'));
  assert.ok(html.includes('<th>Linha</th>') && html.includes('<td>1,76</td>'));
  assert.ok(html.includes('<ul><li>item um</li><li class="sub">subitem</li></ul>'));
  assert.ok(html.includes('<ol><li>primeiro</li></ol>'));
});

test('texto parcial durante o streaming não quebra (tabela incompleta vira parágrafo)', () => {
  assert.doesNotThrow(() => renderMarkdown('| Linha | Odd'));
  assert.doesNotThrow(() => renderMarkdown('```\ncódigo sem fechar'));
});
