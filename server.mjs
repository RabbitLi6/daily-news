#!/usr/bin/env node
/**
 * 每日时事 · 本地服务（电脑上运行用）
 * 前端会优先走本地 /api/*；若部署在 GitHub Pages 等静态环境，前端自动切换为静态模式。
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  log, todayStr, refreshWindow, readArchive, listDates, iterAllItems, similarity,
} from './news-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const INDEX_FILE = path.join(__dirname, 'index.html');
const TUNNEL_DOMAIN_FILE = path.join(__dirname, 'tunnel-domain.txt');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const REFRESH_HOURS = 4;
const CHECK_MINUTES = 20;

const lanIP = () => {
  for (const name of Object.keys(os.networkInterfaces())) {
    if (name.startsWith('lo')) continue;
    for (const i of os.networkInterfaces()[name] || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
};
const publicUrl = () => {
  try { const d = fs.readFileSync(TUNNEL_DOMAIN_FILE, 'utf8').trim(); return d ? `https://${d}` : ''; } catch { return ''; }
};

const STATIC_FILES = {
  '/manifest.webmanifest': ['application/manifest+json; charset=utf-8', path.join(__dirname, 'manifest.webmanifest')],
  '/sw.js': ['text/javascript; charset=utf-8', path.join(__dirname, 'sw.js')],
  '/icons/apple-touch-icon.png': ['image/png', path.join(__dirname, 'icons', 'apple-touch-icon.png')],
  '/icons/icon-192.png': ['image/png', path.join(__dirname, 'icons', 'icon-192.png')],
  '/icons/icon-512.png': ['image/png', path.join(__dirname, 'icons', 'icon-512.png')],
};

let refreshPromise = null;
const ensureFresh = () => { if (!refreshPromise) refreshPromise = refreshWindow(DATA_DIR).finally(() => { refreshPromise = null; }); return refreshPromise; };

async function ensureData(force = false) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const today = readArchive(DATA_DIR, todayStr());
  if (today && !force) {
    const total = (today.tech || []).length + (today.world || []).length + (today.tw || []).length + (today.cn || []).length;
    const age = Date.now() - new Date(today.updatedAt).getTime();
    const stale = age > REFRESH_HOURS * 3600_000;
    const tooFew = total < 20 && age > 30 * 60_000;
    if (!stale && !tooFew) return today;
  }
  if (refreshPromise) return today || ensureFresh();
  try { return await ensureFresh(); }
  catch (e) { log('刷新失败，返回现有快照：', e.message); if (today) return today; throw e; }
}

const PUBLIC_URL_ENV = process.env.PUBLIC_URL || '';
const publicLine = PUBLIC_URL_ENV
  ? `<p>🌐 公网访问：<a href="${PUBLIC_URL_ENV}">${PUBLIC_URL_ENV}</a></p>`
  : (publicUrl() ? `<p>🌐 公网分享：<a href="${publicUrl()}">${publicUrl()}</a></p>` : '');
const INDEX_HTML = fs.readFileSync(INDEX_FILE, 'utf8')
  .replaceAll('__PORT__', String(PORT))
  .replaceAll('__LAN_URL__', lanIP() || '你的电脑IP')
  .replaceAll('__PUBLIC_URL_LINE__', publicLine);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const send = (code, data, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  };
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const host = req.headers.host || '';
      const isLocal = /^(127\.|localhost|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host.split(':')[0]);
      const urlLine = isLocal
        ? `<p>💻 电脑 <a href="http://127.0.0.1:${PORT}/">http://127.0.0.1:${PORT}</a>　📱 手机（同一 WiFi）<a href="http://${lanIP() || '你的电脑IP'}:${PORT}/">http://${lanIP() || '你的电脑IP'}:${PORT}</a></p>`
        : `<p>🌐 公网访问：<a href="https://${host}/">https://${host}</a></p>`;
      send(200, INDEX_HTML.replace('__URL_LINE__', urlLine), 'text/html; charset=utf-8');
      return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (STATIC_FILES[url.pathname]) {
      const [type, file] = STATIC_FILES[url.pathname];
      if (fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }); res.end(fs.readFileSync(file)); return; }
    }
    if (url.pathname === '/api/dates') {
      const dates = listDates(DATA_DIR);
      send(200, { dates, today: todayStr() });
      return;
    }
    if (url.pathname === '/api/news') {
      const date = url.searchParams.get('date') || todayStr();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(400, { error: '日期格式错误' });
      const archive = date === todayStr() ? await ensureData(false) : readArchive(DATA_DIR, date);
      if (!archive) return send(404, { error: '该日期暂无存档', date });
      send(200, archive);
      return;
    }
    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (!q) return send(200, { q, results: [] });
      const results = [];
      for (const it of iterAllItems(DATA_DIR)) {
        if (`${it.title} ${it.summary || ''} ${it.source || ''}`.toLowerCase().includes(q)) results.push(it);
      }
      results.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      send(200, { q, results: results.slice(0, 80) });
      return;
    }
    if (url.pathname === '/api/related') {
      const link = url.searchParams.get('link') || '';
      const title = (url.searchParams.get('title') || '').trim();
      if (!link || !title) return send(400, { error: '缺少参数' });
      const scored = [];
      for (const it of iterAllItems(DATA_DIR)) {
        if (it.link === link) continue;
        const s = similarity(title, it.title);
        if (s >= 0.12) scored.push({ ...it, score: s });
      }
      scored.sort((a, b) => b.score - a.score || (b.time || '').localeCompare(a.time || ''));
      send(200, { results: scored.slice(0, 5) });
      return;
    }
    if (url.pathname === '/api/refresh' && (req.method === 'GET' || req.method === 'POST')) {
      try { send(200, await ensureData(true)); }
      catch (e) { send(500, { error: `刷新失败：${e.message}` }); }
      return;
    }
    send(404, { error: 'Not Found' });
  } catch (e) {
    log('请求错误：', e);
    send(500, { error: e.message });
  }
});

fs.mkdirSync(DATA_DIR, { recursive: true });
server.listen(PORT, HOST, () => {
  log(`每日时事服务已启动  http://127.0.0.1:${PORT}  （局域网: http://${lanIP() || '?'}:${PORT}${publicUrl() ? `，公网: ${publicUrl()}` : ''}）`);
  ensureData(false)
    .then(a => log(`初始化完成：科技 ${a.tech.length} 条 / 国际 ${a.world.length} 条`))
    .catch(e => log('初始化失败：', e.message));
});
setInterval(() => { ensureData(false).catch(e => log('定时刷新失败：', e.message)); }, CHECK_MINUTES * 60 * 1000);
process.on('unhandledRejection', e => log('未处理的异常：', e));
