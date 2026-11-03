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

// ---------------------------------------------------------------------------
// Cotações da bolsa (a única parte do painel que usa a internet).
// O navegador não pode chamar o Yahoo Finanças direto, então o servidor local busca por ele.

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SYMBOL_RE = /^[\^A-Za-z0-9.=-]{1,20}$/;
const SEARCH_TYPES = new Set(['EQUITY', 'ETF', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'MUTUALFUND']);
const QUOTE_TTL = 30_000;
const quoteCache = new Map<string, { at: number; data: unknown }>();

/** A internet (ou o Yahoo) não respondeu. */
class Offline extends Error {}

async function yahoo(url: string): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Offline();
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function quoteOf(symbol: string) {
  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.at < QUOTE_TTL) return hit.data;
  const json = await yahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`);
  const result = json?.chart?.result?.[0];
  const m = result?.meta;
  if (!m || typeof m.regularMarketPrice !== 'number') throw new Error('sem cotação');
  const times: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const regular = m.currentTradingPeriod?.regular;
  const data = {
    simbolo: m.symbol ?? symbol,
    nome: m.longName || m.shortName || symbol,
    bolsa: m.fullExchangeName || m.exchangeName || '',
    tipo: m.instrumentType || '',
    moeda: m.currency || '',
    preco: m.regularMarketPrice,
    anterior: m.chartPreviousClose ?? m.previousClose ?? null,
    hora: m.regularMarketTime ?? null,
    abre: regular?.start ?? null,
    fecha: regular?.end ?? null,
    fuso: m.exchangeTimezoneName || 'UTC',
    pontos: times.flatMap((t, i) => (typeof closes[i] === 'number' ? [[t, closes[i]]] : [])),
  };
  quoteCache.set(symbol, { at: Date.now(), data });
  return data;
}

const quotesApi: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith('/api/cotacoes')) return next();
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  const fail = (e: unknown) => send(e instanceof Offline ? 503 : 502, { erro: e instanceof Offline ? 'sem-internet' : 'fonte' });

  if (url.pathname === '/api/cotacoes/busca') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
    if (!q) return send(200, []);
    yahoo(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`)
      .then((json) =>
        send(
          200,
          (json?.quotes ?? []).filter((x: any) => typeof x.symbol === 'string' && SYMBOL_RE.test(x.symbol) && SEARCH_TYPES.has(x.quoteType)).map((x: any) => ({
            simbolo: x.symbol,
            nome: x.longname || x.shortname || x.symbol,
            bolsa: x.exchDisp || x.exchange || '',
            tipo: x.quoteType,
          })),
        ),
      )
      .catch(fail);
    return;
  }

  const symbols = [...new Set((url.searchParams.get('simbolos') || '').split(',').map((s) => s.trim()))].filter((s) => SYMBOL_RE.test(s)).slice(0, 40);
  Promise.allSettled(symbols.map(quoteOf)).then((results) => {
    if (symbols.length && results.every((r) => r.status === 'rejected' && r.reason instanceof Offline)) return fail(new Offline());
    send(200, results.map((r, i) => (r.status === 'fulfilled' ? r.value : { simbolo: symbols[i], erro: true })));
  });
};

function quotes(): Plugin {
  return {
    name: 'cotacoes',
    configureServer: (s) => void s.middlewares.use(quotesApi),
    configurePreviewServer: (s) => void s.middlewares.use(quotesApi),
  };
}

// Porta fixa: o navegador guarda a cópia de segurança e as preferências por endereço.
const PORT = Number(process.env.ORLA_PORTA) || 5181;

export default defineConfig(({ mode }) => ({
  // A demonstração (--mode demo) não grava arquivo e pode morar em qualquer pasta (ex.: GitHub Pages).
  base: mode === 'demo' ? './' : '/',
  plugins: mode === 'demo' ? [react(), quotes()] : [react(), localStore(), quotes()],
  server: {
    port: PORT,
    strictPort: true,
    open: process.env.ABRIR_NAVEGADOR === '1',
    watch: { ignored: ['**/dados/**'] },
  },
  preview: { port: PORT, strictPort: true },
}));
