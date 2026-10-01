#!/usr/bin/env node
// Gera artifact/especialista.html (a página do especialista publicada no claude.ai) a partir do modelo,
// da metodologia do agente (prompts/especialista.md) e do renderizador de Markdown do app, para que a
// metodologia tenha uma fonte só. Uso: node scripts/build-especialista.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// No claude.ai o especialista não navega na web: troca a seção de busca por uma instrução sem busca.
const NO_WEB = `## Sem acesso à web

Você não tem busca na web nesta página. Quando \`desfalques\` vier vazio, diga que os desfalques não foram verificados e o que o Jeferson deve conferir antes de entrar (escalação provável, ausências importantes). Em dados de demonstração (liga "Liga Demo"), diga no topo que é um teste.

`;
const method = read('prompts/especialista.md').replace(/## Busca na web[\s\S]*?(?=\n## )/, NO_WEB);
if (!method.includes('Sem acesso à web')) throw new Error('seção "## Busca na web" não encontrada em prompts/especialista.md');

const markdown = read('src/markdown.js').replace(/^export /m, '');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const out = read('artifact/especialista.template.html')
  .replace('__METHOD__', () => safe(JSON.stringify(method)))
  .replace('__MARKDOWN__', () => safe(markdown));
fs.writeFileSync(path.join(ROOT, 'artifact/especialista.html'), out);
console.log(`artifact/especialista.html: ${(out.length / 1024).toFixed(1)} KB`);
