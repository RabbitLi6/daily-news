/**
 * 每日时事 · 新闻抓取核心模块（供本地服务与 GitHub 定时任务共用）
 * 全部新闻源均为官方新闻网站，无需 API Key。
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 15000;
const MAX_PER_SOURCE = 100;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export const log = (...a) => console.log(`[${new Date().toLocaleString('zh-CN', { hour12: false })}]`, ...a);

/* ------------------------------ 基础工具 ------------------------------ */
export const pad = n => String(n).padStart(2, '0');
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => localDate(new Date());
export const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return localDate(d); };

const decodeEntities = s => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

export const stripTags = s => {
  let t = String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t);
  t = t.replace(/<[^>]+>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
};

export const truncate = (s, n = 120) => (s.length > n ? s.slice(0, n) + '…' : s);

export function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume();
        fetchText(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} ${url}`)); return; }
      const chunks = [];
      let size = 0;
      res.on('data', c => { size += c.length; if (size < 4_000_000) chunks.push(c); });
      res.on('end', () => {
        try {
          let body = Buffer.concat(chunks);
          if (String(res.headers['content-encoding'] || '').includes('gzip')) body = zlib.gunzipSync(body);
          resolve(body.toString('utf8'));
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`timeout ${url}`)));
    req.on('error', reject);
  });
}
export const fetchJson = async url => JSON.parse(await fetchText(url));

/* ------------------------------ 地区标注与过滤 ------------------------------ */
export const REGIONS = [
  ['中东', /以色列|巴勒斯坦|加沙|哈马斯|伊朗|叙利亚|黎巴嫩|真主党|也门|胡塞|沙特|卡塔尔|阿联酋|伊拉克|中东|红海|内塔尼亚胡|德黑兰|利雅得|霍尔木兹|戈兰|大马士革/],
  ['俄乌', /俄罗斯|乌克兰|普京|泽连斯基|俄乌|基辅|顿涅茨克|卢甘斯克|克里米亚|莫斯科|扎波罗热|赫尔松|哈尔科夫/],
  ['台海', /台湾|台海|两岸|蔡英文|赖清德|台北|高雄|台军/],
  ['南海', /南海|仁爱礁|黄岩岛|菲律宾|马尼拉|西沙|南沙/],
  ['朝鲜半岛', /朝鲜|韩国|首尔|平壤|朝韩|朝核|韩美/],
  ['欧洲', /欧盟|欧洲|德国|法国|英国|意大利|西班牙|波兰|布鲁塞尔|北约|伦敦|巴黎|柏林/],
  ['美洲', /美国|特朗普|拜登|白宫|五角大楼|华盛顿|纽约|美联储|美元|关税|加拿大|墨西哥|硅谷/],
  ['亚太', /日本|东京|印度|新德里|东盟|东南亚|越南|泰国|澳大利亚|堪培拉|悉尼|印尼/],
  ['非洲', /非洲|埃及|南非|尼日利亚|苏丹|刚果|埃塞俄比亚|肯尼亚/],
  ['拉美', /巴西|阿根廷|委内瑞拉|古巴|智利|秘鲁|拉美|玻利维亚/],
];
export const matchRegions = text => REGIONS.filter(([, re]) => re.test(text)).map(([name]) => name);

export const DISASTER_HINT = /地震|震中|震级|余震|海啸|台风|飓风|风暴|气旋|火山|喷发|洪水|洪灾|山洪|泥石流|滑坡|塌方|干旱|森林大火|山火|林火|火灾|暴雪|雪灾|寒潮|热浪|极端天气|暴雨|冰雹|龙卷风|雷暴|自然灾害|灾害|遇难|失踪|疏散|受灾|警报|earthquake|tsunami|typhoon|hurricane|cyclone|volcano|flood|landslide|wildfire|drought|storm|eruption/;
export const HKMO_TW_HINT = /香港|澳门|台湾|台北|高雄|台中|新北|台南|基隆|桃园|新竹|嘉义|花莲|台东|澎湖|金门|马祖|两岸|海峡|一国两制|港澳|大湾区|粤港澳|港珠澳|维港|中环|旺角|尖沙咀|荃湾|沙田|元朗|屯门|大埔|西贡|氹仔|路环|横琴|赖清德|蔡英文|台胞|台商|港人|特区/;
const HKMO_TW_EN = /Taiwan|Hong Kong|Macau|Macao|Taipei|Kaohsiung|Taiwan Strait/;
export const DOMESTIC_HINT = /^(?!.*(美国|俄罗斯|乌克兰|日本|韩国|朝鲜|印度|欧盟|英国|法国|德国|联合国|北约|中东|伊朗|以色列)).*(中国|北京|上海|深圳|广州|天津|重庆|河北|河南|山东|山西|陕西|四川|云南|贵州|广西|广东|福建|浙江|江苏|安徽|江西|湖南|湖北|辽宁|吉林|黑龙江|内蒙古|新疆|西藏|甘肃|宁夏|青海|海南|全国|国内|国务院|发改委|央行|证监会|财政部|教育部|文旅|纪委|法院|卫健委|医保|社保|景区|铁路|民航|地铁|台风|天气|暴雨|地震|高考|中考|水利部|气象台|应急管理|防总)/;
export const INTERNATIONAL_HINT = /国际|外交|会谈|峰会|制裁|谈判|冲突|选举|总统|总理|首相|国会|议会|维和|大使|出访|军演|航母|导弹|战争|停火|难民|G7|G20|联合国|世界|全球|海外|境外|俄罗斯|乌克兰|美国|日本|韩国|朝鲜|印度|英国|法国|德国|伊朗|以色列|土耳其|波兰|加拿大|澳大利亚|巴西|菲律宾|越南|泰国|印尼|马来西亚|新加坡|埃及|南非|尼日利亚|中东|非洲|拉美|东盟|北约|欧盟|台海|台湾|南海|叙利亚|也门|加沙|黎巴嫩|沙特|阿联酋|墨西哥|阿根廷|智利|古巴|秘鲁|希腊|荷兰|比利时|瑞士|瑞典|挪威|丹麦|芬兰|缅甸|柬埔寨|老挝|尼泊尔|巴基斯坦|孟加拉|斯里兰卡|新西兰|利比亚|突尼斯|摩洛哥|埃塞俄比亚|肯尼亚|索马里/;
export const ENTERTAINMENT_HINT = /彩票|开奖|预测|股市|港股|美股|基金|债券|期货|黄金|外汇|楼市|房价|综艺|明星|娱乐圈|电影|电视剧|足球|篮球|比赛|赛事|夺冠|进球|联赛|欧冠|NBA|CBA|演唱会|票房|相亲|养生|星座/;

const CITY_NAMES = ['北京','上海','广州','深圳','成都','重庆','武汉','杭州','南京','西安','天津','苏州','长沙','郑州','青岛','厦门','合肥','昆明','贵阳','沈阳','大连','哈尔滨','长春','石家庄','太原','南昌','福州','南宁','海口','三亚','乌鲁木齐','拉萨','兰州','西宁','银川','呼和浩特','宁波','无锡','佛山','东莞','珠海','泉州','温州','徐州','常州','南通','洛阳','唐山','保定','烟台','潍坊','淄博','临沂','襄阳','宜昌','岳阳','株洲','惠州','中山','江门','湛江','汕头','桂林','柳州','遵义','丽江','大理','秦皇岛','威海','日照','德州','菏泽','济宁','泰安','枣庄','东营','滨州','聊城','开封','平顶山','新乡','焦作','濮阳','许昌','漯河','三门峡','商丘','周口','驻马店','信阳','南阳','黄石','十堰','荆州','孝感','黄冈','咸宁','随州','湘潭','邵阳','益阳','郴州','永州','怀化','娄底','韶关','河源','梅州','汕尾','阳江','茂名','肇庆','清远','潮州','揭阳','云浮','玉林','百色','河池','崇左','钦州','北海','防城港','贵港','来宾','贺州','六盘水','安顺','毕节','铜仁','曲靖','玉溪','保山','昭通','普洱','临沧','宝鸡','咸阳','渭南','延安','汉中','榆林','安康','商洛','嘉峪关','金昌','白银','天水','武威','张掖','平凉','酒泉','庆阳','定西','陇南','海东','石嘴山','吴忠','固原','中卫','克拉玛依','吐鲁番','哈密','昌吉','伊犁','喀什','和田','阿克苏','库尔勒','延边','西双版纳','河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','内蒙古','广西','西藏','宁夏','新疆'];
const CITY_HINT_ANY = new RegExp(CITY_NAMES.join('|'));
const cityOf = text => {
  const out = [];
  for (const name of CITY_NAMES) {
    if (!out.includes(name) && text.includes(name)) { out.push(name); if (out.length >= 2) break; }
  }
  return out;
};

/* ------------------------------ 新闻源 ------------------------------ */
const TECH_FEEDS = [
  { name: 'IT之家', url: 'https://www.ithome.com/rss/' },
  { name: '少数派', url: 'https://sspai.com/feed' },
  { name: '开源中国', url: 'https://www.oschina.net/news/rss' },
  { name: '极客公园', url: 'https://www.geekpark.net/rss' },
];
const WORLD_FEEDS = [
  { name: '中新网国际', url: 'https://www.chinanews.com.cn/rss/world.xml' },
  { name: '联合国新闻', url: 'https://news.un.org/feed/subscribe/zh/news/all/rss.xml' },
  { name: '卫星社中文', url: 'https://sputniknews.cn/export/rss2/archive/index.xml' },
  { name: 'CGTN国际', url: 'https://www.cgtn.com/subscribe/rss/section/world.xml' },
];

export function parseRss(xml) {
  const out = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const mm = block.match(r);
      return mm ? stripTags(mm[1]) : '';
    };
    const title = get('title');
    const link = get('link');
    if (!title || !link) continue;
    const t = new Date(get('pubDate') || get('dc:date') || get('date'));
    out.push({ title, link, time: Number.isNaN(t.getTime()) ? new Date() : t, summary: truncate(get('description')) });
  }
  return out;
}

export async function fetchFeeds(feedList) {
  const results = await Promise.allSettled(feedList.map(async f => {
    let items = parseRss(await fetchText(f.url));
    if (f.filter) items = items.filter(f.filter);
    items = items.slice(0, f.max || MAX_PER_SOURCE);
    return items.map(it => ({ title: it.title, link: it.link, source: f.name, time: it.time, summary: it.summary, regions: [] }));
  }));
  const all = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { all.push(...r.value); log(`✓ ${feedList[i].name}: ${r.value.length} 条`); }
    else log(`✗ ${feedList[i].name}: ${r.reason?.message || r.reason}`);
  });
  return all;
}

export async function fetchDomestic() {
  const out = { tw: [], cn: [], worldExtra: [] };
  const mk = (it, src) => ({ title: it.title, link: it.link, source: src, time: it.time, summary: it.summary, regions: [] });
  const tag = it => {
    const regions = matchRegions(it.title + ' ' + it.summary);
    const city = cityOf(it.title + ' ' + it.summary);
    if (city.length) regions.push(...city);
    return regions;
  };
  try {
    const items = parseRss(await fetchText('https://www.chinanews.com.cn/rss/china.xml')).slice(0, 60);
    let t = 0, c = 0;
    for (const it of items) {
      const text = it.title + ' ' + it.summary;
      const item = mk(it, '中新网中国'); item.regions = tag(it);
      if (HKMO_TW_HINT.test(text)) { out.tw.push(item); t++; } else { out.cn.push(item); c++; }
    }
    log(`✓ 中新网中国: ${items.length} 条（港澳台 ${t} / 国内 ${c}）`);
  } catch (e) { log(`✗ 中新网中国: ${e.message}`); }
  try {
    const items = parseRss(await fetchText('https://www.chinanews.com.cn/rss/society.xml')).slice(0, 60);
    let kept = 0;
    for (const it of items) {
      if (ENTERTAINMENT_HINT.test(it.title + ' ' + it.summary)) continue;
      const item = mk(it, '中新网社会'); item.regions = tag(it);
      out.cn.push(item); kept++;
    }
    log(`✓ 中新网社会: ${kept} 条`);
  } catch (e) { log(`✗ 中新网社会: ${e.message}`); }
  try {
    const items = parseRss(await fetchText('https://www.chinanews.com.cn/rss/scroll-news.xml')).slice(0, 120);
    let w = 0, t = 0, c = 0;
    for (const it of items) {
      const text = it.title + ' ' + it.summary;
      const regions = matchRegions(text);
      const disaster = DISASTER_HINT.test(text);
      const isIntl = (regions.length > 0 || INTERNATIONAL_HINT.test(text) || disaster)
        && !ENTERTAINMENT_HINT.test(text) && (disaster || !DOMESTIC_HINT.test(text));
      if (isIntl) { out.worldExtra.push(mk(it, '中新网滚动')); w++; continue; }
      if (ENTERTAINMENT_HINT.test(text)) continue;
      const item = mk(it, '中新网滚动'); item.regions = tag(it);
      if (HKMO_TW_HINT.test(text)) { out.tw.push(item); t++; continue; }
      if (CITY_HINT_ANY.test(text) || DOMESTIC_HINT.test(text)) { out.cn.push(item); c++; }
    }
    log(`✓ 中新网滚动: 国际 ${w} / 港澳台 ${t} / 国内 ${c} 条`);
  } catch (e) { log(`✗ 中新网滚动: ${e.message}`); }
  try {
    const items = parseRss(await fetchText('https://www.cgtn.com/subscribe/rss/section/china.xml')).slice(0, 50);
    let t = 0, c = 0;
    for (const it of items) {
      const text = it.title + ' ' + it.summary;
      const item = mk(it, 'CGTN中国'); item.regions = matchEnPlaces(text);
      if (HKMO_TW_EN.test(text) || HKMO_TW_HINT.test(text)) { out.tw.push(item); t++; } else { out.cn.push(item); c++; }
    }
    log(`✓ CGTN中国: ${items.length} 条（港澳台 ${t} / 国内 ${c}）`);
  } catch (e) { log(`✗ CGTN中国: ${e.message}`); }
  return out;
}

/* 英文地名 → 中文地区标签 */
const EN_PLACES = [
  ['Indonesia', '印尼', '亚太'], ['Japan', '日本', '亚太'], ['Philippines', '菲律宾', '南海'], ['Taiwan', '台湾', '台海'],
  ['Turkey', '土耳其', '中东'], ['Iran', '伊朗', '中东'], ['Afghanistan', '阿富汗', '中东'], ['Pakistan', '巴基斯坦', '亚太'],
  ['India', '印度', '亚太'], ['Nepal', '尼泊尔', '亚太'], ['Myanmar', '缅甸', '亚太'], ['Papua New Guinea', '巴布亚新几内亚', '亚太'],
  ['New Zealand', '新西兰', '亚太'], ['Australia', '澳大利亚', '亚太'], ['Thailand', '泰国', '亚太'], ['Vietnam', '越南', '亚太'],
  ['China', '中国', '亚太'], ['Russia', '俄罗斯', '俄乌'], ['Ukraine', '乌克兰', '俄乌'],
  ['United States', '美国', '美洲'], ['California', '美国加州', '美洲'], ['Alaska', '美国阿拉斯加', '美洲'], ['Hawaii', '美国夏威夷', '美洲'],
  ['Mexico', '墨西哥', '美洲'], ['Canada', '加拿大', '美洲'],
  ['Chile', '智利', '拉美'], ['Peru', '秘鲁', '拉美'], ['Argentina', '阿根廷', '拉美'], ['Colombia', '哥伦比亚', '拉美'],
  ['Ecuador', '厄瓜多尔', '拉美'], ['Bolivia', '玻利维亚', '拉美'], ['Guatemala', '危地马拉', '拉美'], ['Haiti', '海地', '拉美'], ['Cuba', '古巴', '拉美'],
  ['Greece', '希腊', '欧洲'], ['Italy', '意大利', '欧洲'], ['Iceland', '冰岛', '欧洲'], ['Spain', '西班牙', '欧洲'],
  ['Portugal', '葡萄牙', '欧洲'], ['France', '法国', '欧洲'], ['Germany', '德国', '欧洲'], ['United Kingdom', '英国', '欧洲'],
  ['Egypt', '埃及', '非洲'], ['Morocco', '摩洛哥', '非洲'], ['Ethiopia', '埃塞俄比亚', '非洲'], ['Kenya', '肯尼亚', '非洲'],
  ['South Africa', '南非', '非洲'], ['Nigeria', '尼日利亚', '非洲'], ['Congo', '刚果', '非洲'], ['Madagascar', '马达加斯加', '非洲'],
  ['Angola', '安哥拉', '非洲'], ['Namibia', '纳米比亚', '非洲'], ['Mozambique', '莫桑比克', '非洲'], ['Tanzania', '坦桑尼亚', '非洲'],
  ['Zambia', '赞比亚', '非洲'], ['Zimbabwe', '津巴布韦', '非洲'], ['Botswana', '博茨瓦纳', '非洲'], ['Sudan', '苏丹', '非洲'],
  ['Somalia', '索马里', '非洲'], ['Uganda', '乌干达', '非洲'], ['Ghana', '加纳', '非洲'], ['Cameroon', '喀麦隆', '非洲'], ['Senegal', '塞内加尔', '非洲'],
  ['Brazil', '巴西', '拉美'], ['Paraguay', '巴拉圭', '拉美'], ['Uruguay', '乌拉圭', '拉美'], ['Venezuela', '委内瑞拉', '拉美'],
  ['Costa Rica', '哥斯达黎加', '拉美'], ['Panama', '巴拿马', '拉美'], ['Nicaragua', '尼加拉瓜', '拉美'], ['Honduras', '洪都拉斯', '拉美'],
  ['El Salvador', '萨尔瓦多', '拉美'], ['Dominican Republic', '多米尼加', '拉美'], ['Jamaica', '牙买加', '拉美'], ['Puerto Rico', '波多黎各', '拉美'],
  ['Kazakhstan', '哈萨克斯坦', '欧洲'], ['Uzbekistan', '乌兹别克斯坦', '欧洲'], ['Tajikistan', '塔吉克斯坦', '欧洲'], ['Kyrgyzstan', '吉尔吉斯斯坦', '欧洲'],
  ['Mongolia', '蒙古', '亚太'], ['Bangladesh', '孟加拉', '亚太'], ['Sri Lanka', '斯里兰卡', '亚太'], ['Malaysia', '马来西亚', '亚太'],
  ['Cambodia', '柬埔寨', '亚太'], ['Laos', '老挝', '亚太'], ['Brunei', '文莱', '亚太'], ['Singapore', '新加坡', '亚太'],
  ['Georgia', '格鲁吉亚', '欧洲'], ['Armenia', '亚美尼亚', '欧洲'], ['Azerbaijan', '阿塞拜疆', '欧洲'], ['Belarus', '白俄罗斯', '俄乌'],
  ['Romania', '罗马尼亚', '欧洲'], ['Bulgaria', '保加利亚', '欧洲'], ['Serbia', '塞尔维亚', '欧洲'], ['Croatia', '克罗地亚', '欧洲'],
  ['Albania', '阿尔巴尼亚', '欧洲'], ['Bosnia', '波黑', '欧洲'], ['Kosovo', '科索沃', '欧洲'], ['Moldova', '摩尔多瓦', '欧洲'],
  ['Norway', '挪威', '欧洲'], ['Sweden', '瑞典', '欧洲'], ['Finland', '芬兰', '欧洲'], ['Denmark', '丹麦', '欧洲'],
  ['Netherlands', '荷兰', '欧洲'], ['Belgium', '比利时', '欧洲'], ['Switzerland', '瑞士', '欧洲'], ['Austria', '奥地利', '欧洲'],
  ['Czech', '捷克', '欧洲'], ['Slovakia', '斯洛伐克', '欧洲'], ['Hungary', '匈牙利', '欧洲'], ['Poland', '波兰', '欧洲'],
  ['Ireland', '爱尔兰', '欧洲'], ['Lithuania', '立陶宛', '欧洲'], ['Latvia', '拉脱维亚', '欧洲'], ['Estonia', '爱沙尼亚', '欧洲'],
  ['Oman', '阿曼', '中东'], ['Yemen', '也门', '中东'], ['Jordan', '约旦', '中东'], ['Kuwait', '科威特', '中东'], ['Qatar', '卡塔尔', '中东'],
  ['Saudi Arabia', '沙特', '中东'], ['United Arab Emirates', '阿联酋', '中东'], ['Iraq', '伊拉克', '中东'], ['Syria', '叙利亚', '中东'],
  ['Lebanon', '黎巴嫩', '中东'], ['Israel', '以色列', '中东'], ['Palestine', '巴勒斯坦', '中东'], ['Libya', '利比亚', '非洲'], ['Algeria', '阿尔及利亚', '非洲'], ['Tunisia', '突尼斯', '非洲'],
  ['Fiji', '斐济', '亚太'], ['Tonga', '汤加', '亚太'], ['Vanuatu', '瓦努阿图', '亚太'], ['Solomon Islands', '所罗门群岛', '亚太'],
  ['Hong Kong', '香港', '亚太'], ['Macau', '澳门', '亚太'], ['Macao', '澳门', '亚太'],
  ['Caribbean', '加勒比', '拉美'], ['North Atlantic', '北大西洋', '欧洲'], ['Pacific', '太平洋', '亚太'], ['Mediterranean', '地中海', '欧洲'],
];
const matchEnPlaces = text => {
  const out = new Set();
  for (const [en, cn, region] of EN_PLACES) {
    if (text.includes(en)) { out.add(cn); out.add(region); }
  }
  return [...out];
};

export async function fetchDisasterFeeds() {
  const out = [];
  try {
    const items = parseRss(await fetchText('https://www.gdacs.org/xml/rss.xml')).slice(0, 60);
    let kept = 0;
    for (const it of items) {
      if (/Green (forest fire|flood)/i.test(it.title)) continue;
      out.push({ title: `【灾害警报】${it.title}`, link: it.link, source: 'GDACS灾害监测', time: it.time, summary: it.summary, regions: matchEnPlaces(`${it.title} ${it.summary}`) });
      kept++;
    }
    log(`✓ GDACS灾害监测: ${kept} 条`);
  } catch (e) { log(`✗ GDACS灾害监测: ${e.message}`); }
  try {
    const data = await fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
    const feats = (data && data.features) || [];
    let n = 0;
    for (const f of feats.slice(0, 40)) {
      const p = f.properties || {};
      if (!p.title || !p.url || !p.time) continue;
      const place = p.place || '';
      const mag = typeof p.mag === 'number' ? p.mag.toFixed(1) : null;
      const depth = typeof p.depth === 'number' && p.depth >= 0 ? `${p.depth.toFixed(1)} km` : '未知';
      out.push({
        title: `【地震${mag ? ` M${mag}` : ''}】${place}`,
        link: p.url,
        source: 'USGS地震台网',
        time: new Date(p.time),
        summary: `美国地质调查局官方监测：${place}${mag ? `发生 ${mag} 级地震` : '发生地震'}，震源深度 ${depth}。`,
        regions: matchEnPlaces(place),
      });
      n++;
    }
    log(`✓ USGS地震台网: ${n} 条`);
  } catch (e) { log(`✗ USGS地震台网: ${e.message}`); }
  return out;
}

/* ------------------------------ 归档管理 ------------------------------ */
export const keyOf = it => (it.link || it.title || '').toLowerCase();
export const bucket = items => {
  const by = {};
  for (const it of items) {
    if (!it.time || Number.isNaN(it.time.getTime())) continue;
    const d = localDate(it.time);
    (by[d] = by[d] || []).push({ ...it, time: it.time.toISOString() });
  }
  return by;
};

export function mergeInto(arch, techItems, worldItems, twItems, cnItems) {
  arch.tech = arch.tech || [];
  arch.world = arch.world || [];
  arch.tw = arch.tw || [];
  arch.cn = arch.cn || [];
  const add = (list, items) => {
    const seen = new Set(list.map(keyOf));
    for (const it of items) if (!seen.has(keyOf(it))) { seen.add(keyOf(it)); list.push(it); }
    list.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    if (list.length > 400) list.length = 400;
  };
  add(arch.tech, techItems);
  add(arch.world, worldItems);
  add(arch.tw, twItems);
  add(arch.cn, cnItems);
  arch.updatedAt = new Date().toISOString();
  return arch;
}

export const readArchive = (dir, date) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${date}.json`), 'utf8')); } catch { return null; } };
export const writeArchive = (dir, arch) => {
  const file = path.join(dir, `${arch.date}.json`);
  fs.writeFileSync(file + '.tmp', JSON.stringify(arch, null, 1), 'utf8');
  fs.renameSync(file + '.tmp', file);
};
export const listDates = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.replace('.json', '')).sort().reverse()
  : [];

/* 中文二元组 + 英文单词相似度（相关新闻推荐） */
export const terms = s => {
  const t = String(s).toLowerCase();
  const words = new Set();
  for (const w of t.matchAll(/[a-z0-9]{2,}/g)) words.add(w[0]);
  const zh = t.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < zh.length - 1; i++) words.add(zh.slice(i, i + 2));
  return words;
};
export const similarity = (a, b) => {
  const A = terms(a), B = terms(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.sqrt(A.size * B.size);
};

export function* iterAllItems(dir) {
  for (const d of listDates(dir)) {
    const arch = readArchive(dir, d);
    if (!arch) continue;
    for (const it of arch.tech || []) yield { ...it, date: d, cat: 'tech' };
    for (const it of arch.world || []) yield { ...it, date: d, cat: 'world' };
    for (const it of arch.tw || []) yield { ...it, date: d, cat: 'tw' };
    for (const it of arch.cn || []) yield { ...it, date: d, cat: 'cn' };
  }
}

/** 抓取一次并把内容合并进每日存档（返回今日存档） */
export async function refreshWindow(dir, { force = false } = {}) {
  const todayFile = readArchive(dir, todayStr());
  const now = Date.now();
  if (todayFile && !force) {
    const total = (todayFile.tech || []).length + (todayFile.world || []).length + (todayFile.tw || []).length + (todayFile.cn || []).length;
    const age = now - new Date(todayFile.updatedAt).getTime();
    if (total >= 20 && age <= 4 * 3600_000) { log(`快照仍新鲜（${total} 条），跳过抓取`); return todayFile; }
  }
  log('开始抓取新闻快照…');
  const started = now;
  const feedJobs = [
    fetchFeeds(TECH_FEEDS),
    fetchFeeds(WORLD_FEEDS),
    fetchDomestic(),
    fetchDisasterFeeds(),
  ].map(p => p.catch(e => { log('源抓取失败：', e.message); return { tw: [], cn: [], worldExtra: [] }; }));
  const [tech, worldRaw, dom, disasters] = await Promise.all(feedJobs);
  const worldItems = [
    ...worldRaw.map(it => {
      const regions = matchRegions(it.title + ' ' + it.summary);
      if (!regions.length && DISASTER_HINT.test(it.title + ' ' + it.summary) && DOMESTIC_HINT.test(it.title)) regions.push('中国');
      return { ...it, regions };
    }),
    ...dom.worldExtra,
    ...disasters.map(it => ({ ...it, regions: it.regions.length ? it.regions : ['国际'] })),
  ];
  const twItems = dom.tw;
  const cnItems = dom.cn;
  log(`抓取完成（${((Date.now() - started) / 1000).toFixed(1)}s）：科技 ${tech.length} / 国际 ${worldItems.length} / 港澳台 ${twItems.length} / 国内 ${cnItems.length}`);
  const techBy = bucket(tech), worldBy = bucket(worldItems), twBy = bucket(twItems), cnBy = bucket(cnItems);
  let todayArchive = null;
  for (const d of [todayStr(), daysAgo(1), daysAgo(2)]) {
    const hasItems = (techBy[d] || []).length + (worldBy[d] || []).length + (twBy[d] || []).length + (cnBy[d] || []).length > 0;
    if (d === todayStr() || hasItems) {
      let arch = readArchive(dir, d) || { date: d, tech: [], world: [], tw: [], cn: [] };
      arch = mergeInto(arch, techBy[d] || [], worldBy[d] || [], twBy[d] || [], cnBy[d] || []);
      const total = arch.tech.length + arch.world.length + arch.tw.length + arch.cn.length;
      if (total > 0) writeArchive(dir, arch);
      if (d === todayStr()) todayArchive = arch;
    }
  }
  return todayArchive || readArchive(dir, todayStr()) || { date: todayStr(), tech: [], world: [], tw: [], cn: [] };
}
