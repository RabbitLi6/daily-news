#!/usr/bin/env node
/**
 * 静态站点生成器：GitHub Actions 定时运行
 * 1. 抓取官方新闻源并合并进 data/YYYY-MM-DD.json（保留最近 14 天）
 * 2. 生成 data/dates.json 与 data/search-index.json 供前端使用
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, todayStr, refreshWindow, listDates, readArchive, iterAllItems, keyOf } from './news-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const KEEP_DAYS = 14;

const main = async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const today = await refreshWindow(DATA_DIR, { force: false });

  // 清理超过 14 天的旧存档
  for (const d of listDates(DATA_DIR)) {
    if (new Date(d).getTime() < Date.now() - KEEP_DAYS * 24 * 3600_000) {
      fs.rmSync(path.join(DATA_DIR, `${d}.json`), { force: true });
      log(`清理过期存档 ${d}`);
    }
  }

  // dates.json：日期列表 + 最近更新时间
  const dates = listDates(DATA_DIR);
  let updatedAt = today.updatedAt || '';
  for (const d of dates) {
    const a = readArchive(DATA_DIR, d);
    if (a?.updatedAt > updatedAt) updatedAt = a.updatedAt;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'dates.json'), JSON.stringify({ dates, today: todayStr(), updatedAt }), 'utf8');

  // search-index.json：全库轻量索引（标题/摘要/来源），供前端跨日期搜索与相关推荐
  const index = [];
  const seen = new Set();
  for (const it of iterAllItems(DATA_DIR)) {
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k);
    index.push({
      t: it.title,
      l: it.link,
      s: it.source || '',
      d: it.date,
      c: it.cat,
      r: it.regions || [],
      m: it.time,
      u: (it.summary || '').slice(0, 60),
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'search-index.json'), JSON.stringify(index), 'utf8');

  const total = index.length;
  log(`✅ 静态站点已更新：${dates.length} 天存档，共 ${total} 条新闻索引`);
  log(`今日：科技 ${today.tech.length} / 国际 ${today.world.length} / 港澳台 ${today.tw.length} / 国内 ${today.cn.length}`);
};

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
