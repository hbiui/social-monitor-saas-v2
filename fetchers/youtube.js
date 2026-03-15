const Parser = require('rss-parser');
const axios  = require('axios');
const db     = require('../db');

/**
 * 获取代理配置 - 按优先级：
 * 1. 工具内设置的 proxy_url
 * 2. 环境变量 HTTPS_PROXY / HTTP_PROXY
 * 3. 无代理
 */
function getProxyUrl() {
  const fromDb = (db.getAllSettings().proxy_url || '').trim();
  if (fromDb) return fromDb;
  return (process.env.HTTPS_PROXY || process.env.https_proxy ||
          process.env.HTTP_PROXY  || process.env.http_proxy  || '').trim();
}

function makeAxiosOpts(extraTimeout = 0) {
  const proxyUrl = getProxyUrl();
  const base = {
    timeout: 20000 + extraTimeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
  if (!proxyUrl) return base;
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return { ...base, httpsAgent: new HttpsProxyAgent(proxyUrl), proxy: false };
  } catch (e) {
    console.error('[Proxy] agent error:', e.message);
    return base;
  }
}

/**
 * 解析代理 URL → axios native proxy 格式
 */
function parseProxyForAxios(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.hostname,
      port: parseInt(u.port),
      ...(u.username ? { auth: { username: u.username, password: u.password } } : {}),
    };
  } catch (e) { return null; }
}

/**
 * 健壮的 RSS 获取，尝试多种方式
 */
async function fetchRssFeed(rssUrl) {
  const proxyUrl = getProxyUrl();
  const parser = new Parser({ timeout: 15000 });

  // 构造所有尝试方式
  const attempts = [];

  if (proxyUrl) {
    // 方式1：HttpsProxyAgent
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      const agent = new HttpsProxyAgent(proxyUrl);
      attempts.push({
        label: `代理(Agent) ${proxyUrl}`,
        opts: {
          timeout: 20000, responseType: 'text', transformResponse: [d => d],
          httpsAgent: agent, proxy: false,
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        }
      });
    } catch(e) {}

    // 方式2：axios 原生 proxy 参数
    const nativeProxy = parseProxyForAxios(proxyUrl);
    if (nativeProxy) {
      attempts.push({
        label: `代理(Native) ${proxyUrl}`,
        opts: {
          timeout: 20000, responseType: 'text', transformResponse: [d => d],
          proxy: nativeProxy,
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        }
      });
    }
  }

  // 方式3：直连（无代理）
  attempts.push({
    label: '直连(无代理)',
    opts: {
      timeout: 15000, responseType: 'text', transformResponse: [d => d],
      proxy: false,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    }
  });

  for (const { label, opts } of attempts) {
    try {
      console.log(`[YouTube RSS] 尝试 ${label}: ${rssUrl}`);
      const res = await axios.get(rssUrl, opts);
      const xml = (res.data || '').trim();

      if (!xml) {
        console.warn(`[YouTube RSS] ${label}: 空响应`);
        continue;
      }
      if (!xml.startsWith('<')) {
        console.warn(`[YouTube RSS] ${label}: 非XML响应 (${res.status}), 前100字符: ${xml.slice(0, 100)}`);
        continue;
      }

      const feed = await parser.parseString(xml);
      if (feed && Array.isArray(feed.items)) {
        console.log(`[YouTube RSS] ✅ ${label} 成功，获取 ${feed.items.length} 条`);
        return { ok: true, feed, usedProxy: label };
      }
    } catch (e) {
      console.warn(`[YouTube RSS] ${label} 失败: ${e.code || ''} ${e.message}`);
    }
  }

  return { ok: false };
}

function parseYouTubeUrl(rawUrl) {
  const url = rawUrl.trim()
    .replace(/\/(videos|about|playlists|community|shorts|featured|streams)\/?(\?.*)?$/, '')
    .replace(/\?.*$/, '');
  const tests = [
    { re: /youtube\.com\/channel\/(UC[\w-]{22})/, type: 'channelId' },
    { re: /youtube\.com\/@([\w.-]+)/,              type: 'handle'    },
    { re: /youtube\.com\/c\/([\w.-]+)/,            type: 'customUrl' },
    { re: /youtube\.com\/user\/([\w.-]+)/,         type: 'username'  },
  ];
  for (const { re, type } of tests) {
    const m = url.match(re);
    if (m) return { type, value: m[1], cleanUrl: url };
  }
  return null;
}

function videoIdFromUrl(url) {
  const m = (url || '').match(/[?&]v=([\w-]{11})/);
  return m ? m[1] : '';
}

function mapFeedItems(items, count) {
  return (items || []).slice(0, count).map(item => {
    const vid = videoIdFromUrl(item.link || '');
    return {
      id:           item.id || item.link || String(Date.now() + Math.random()),
      title:        item.title || '',
      content:      item.contentSnippet || item.content || '',
      url:          item.link || '',
      thumbnail:    vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : '',
      published_at: item.pubDate || item.isoDate || new Date().toISOString(),
    };
  });
}

async function handleToChannelId(handle, apiKey) {
  const h = handle.replace(/^@/, '');
  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'id,snippet', forHandle: h, key: apiKey },
      ...makeAxiosOpts()
    });
    const item = res.data?.items?.[0];
    if (item) return {
      channelId: item.id,
      title: item.snippet?.title || '',
      avatar: item.snippet?.thumbnails?.default?.url || '',
    };
  } catch (e) { console.error('[YouTube API]', e.message); }
  return null;
}

async function scrapeChannelId(pageUrl) {
  try {
    const res = await axios.get(pageUrl, { ...makeAxiosOpts(), responseType: 'text', transformResponse: [d => d] });
    const html = res.data;
    const patterns = [
      /"channelId":"(UC[\w-]{22})"/,
      /"externalChannelId":"(UC[\w-]{22})"/,
      /"browseId":"(UC[\w-]{22})"/,
      /\/channel\/(UC[\w-]{22})"/,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return m[1];
    }
  } catch (e) { console.error('[YouTube scrape]', e.message); }
  return null;
}

async function fetchYouTube(rawUrl, count = 10) {
  const parsed = parseYouTubeUrl(rawUrl);
  if (!parsed) return { success: false, error: '无法识别 YouTube URL 格式，请粘贴频道主页完整链接', items: [] };

  const settings = db.getAllSettings();
  const apiKey   = (settings.youtube_api_key || '').trim();
  const proxyUrl = getProxyUrl();

  let channelId = null, channelTitle = '', channelAvatar = '';

  if (parsed.type === 'channelId') {
    channelId = parsed.value;
  }

  if (!channelId && parsed.type === 'handle') {
    if (apiKey) {
      const info = await handleToChannelId(parsed.value, apiKey);
      if (info) { channelId = info.channelId; channelTitle = info.title; channelAvatar = info.avatar; }
    }
    if (!channelId) {
      channelId = await scrapeChannelId(parsed.cleanUrl);
      channelTitle = channelTitle || parsed.value.replace(/^@/, '');
    }
  }

  if (!channelId && (parsed.type === 'customUrl' || parsed.type === 'username')) {
    if (apiKey) {
      const info = await handleToChannelId(parsed.value, apiKey);
      if (info) { channelId = info.channelId; channelTitle = info.title; channelAvatar = info.avatar; }
    }
    if (!channelId) {
      channelId = await scrapeChannelId(parsed.cleanUrl);
      channelTitle = channelTitle || parsed.value;
    }
  }

  if (!channelId) {
    const hint = proxyUrl ? `代理(${proxyUrl})已配置但频道页面无法访问。` : `YouTube 在国内需要代理，请在「设置 → 网络代理」填入 Clash 地址（默认 http://127.0.0.1:7890）。`;
    return { success: false, error: `无法解析该频道 ID。${hint}`, items: [] };
  }

  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const r = await fetchRssFeed(rssUrl);

  if (r.ok) {
    const items = mapFeedItems(r.feed.items, count);
    return {
      success: true, channelId,
      channelTitle: channelTitle || r.feed.title || parsed.value,
      channelAvatar, items,
    };
  }

  // API 兜底
  if (apiKey) {
    try {
      const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: { part: 'snippet', channelId, maxResults: count, order: 'date', type: 'video', key: apiKey },
        ...makeAxiosOpts()
      });
      const items = (res.data.items || []).map(item => ({
        id: item.id.videoId, title: item.snippet.title, content: item.snippet.description,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        thumbnail: item.snippet.thumbnails?.medium?.url || '',
        published_at: item.snippet.publishedAt,
      }));
      return { success: true, channelId, channelTitle, channelAvatar, items };
    } catch (e) { console.error('[YouTube API search]', e.message); }
  }

  // 全部失败 → 账号仍然添加，提示配置代理
  const proxyHint = proxyUrl
    ? `当前代理(${proxyUrl})无法访问 YouTube RSS，请检查代理是否支持 YouTube，或在设置中更换代理地址。`
    : `Node.js 不会自动使用 Clash 系统代理，需要在「设置 → 网络代理」手动填入代理地址（Clash 默认：http://127.0.0.1:7890）。`;

  return {
    success: true,
    channelId,
    channelTitle: channelTitle || parsed.value.replace(/^@/, '') || channelId,
    channelAvatar,
    items: [],
    warning: `账号已添加，但内容获取失败。⚠️ ${proxyHint}`,
  };
}

module.exports = { fetchYouTube, parseYouTubeUrl, getProxyUrl };
