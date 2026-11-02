import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Os lançamentos ficam num arquivo JSON dentro do próprio projeto, no seu PC.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
// ORLA_DADOS troca a pasta (útil para testar sem mexer nos dados de verdade).
const DIR = process.env.ORLA_DADOS ? path.resolve(process.env.ORLA_DADOS) : path.join(ROOT, 'dados');
const FILE = path.join(DIR, 'orla-financas.json');
const BACKUPS = path.join(DIR, 'backups');
const KEEP_DAYS = 30;

function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Antes da primeira gravação do dia, guarda uma cópia do arquivo anterior em dados/backups.
function dailyBackup() {
  if (!fs.existsSync(FILE)) return;
  fs.mkdirSync(BACKUPS, { recursive: true });
  const target = path.join(BACKUPS, `${localDay()}.json`);
  if (!fs.existsSync(target)) fs.copyFileSync(FILE, target);
  const old = fs.readdirSync(BACKUPS).filter((f) => f.endsWith('.json')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_DAYS))) fs.rmSync(path.join(BACKUPS, f));
}

const api: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith('/api/dados')) return next();
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : 'null');
    return;
  }

  if (req.method === 'PUT') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        if (!json || !Array.isArray(json.lancamentos)) throw new Error('formato inválido');
        fs.mkdirSync(DIR, { recursive: true });
        dailyBackup();
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
        fs.renameSync(tmp, FILE);
        res.end('ok');
      } catch (e) {
        res.statusCode = 400;
        res.end(String(e));
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end();
};

function localStore(): Plugin {
  return {
    name: 'arquivo-local',
    configureServer: (s) => void s.middlewares.use(api),
    configurePreviewServer: (s) => void s.middlewares.use(api),
  };
}

// Porta fixa: o navegador guarda a cópia de segurança e as preferências por endereço.
const PORT = Number(process.env.ORLA_PORTA) || 5181;

export default defineConfig(({ mode }) => ({
  // A demonstração (--mode demo) não tem servidor e pode morar em qualquer pasta (ex.: GitHub Pages).
  base: mode === 'demo' ? './' : '/',
  plugins: mode === 'demo' ? [react()] : [react(), localStore()],
  server: {
    port: PORT,
    strictPort: true,
    open: process.env.ABRIR_NAVEGADOR === '1',
    watch: { ignored: ['**/dados/**'] },
  },
  preview: { port: PORT, strictPort: true },
}));
