const Parser = require('rss-parser');
const axios  = require('axios');
const crypto = require('crypto');
const { getAxiosProxy } = require('../proxy');

// 统一用 axios 下载 RSS XML，再 parseString（规避代理兼容性）
async function fetchRssByAxios(rssUrl, count = 10) {
  try {
    const res = await axios.get(rssUrl, {
      timeout: 18000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      ...getAxiosProxy(),
    });
    const xml = typeof res.data === 'string' ? res.data : String(res.data);
    if (!xml || !xml.includes('<')) return { success: false, error: '响应内容不是有效 XML', items: [] };

    const parser = new Parser({ headers: { 'User-Agent': 'Mozilla/5.0' } });
    const feed = await parser.parseString(xml);

    const items = (feed.items || []).slice(0, count).map(item => ({
      id:           item.guid || item.link || item.id || String(Date.now() + Math.random()),
      title:        item.title || '',
      content:      item.contentSnippet || item.content || item.summary || '',
      url:          item.link || rssUrl,
      thumbnail:    item.enclosure?.url || extractImageFromContent(item['content:encoded'] || item.content || '') || '',
      published_at: item.pubDate || item.isoDate || new Date().toISOString(),
    }));

    // 清理 rss.app 等服务在标题里追加的平台后缀
    const rawTitle = feed.title || '';
    const cleanTitle = rawTitle.replace(/\s*[\|｜]\s*(LinkedIn|Twitter|Facebook|Instagram|YouTube).*$/i, '').trim();

    return {
      success: true, items,
      name: cleanTitle,
      avatar: feed.image?.url || '',
      description: feed.description || '',
    };
  } catch (e) {
    return { success: false, error: `RSS 获取失败：${e.message}`, items: [] };
  }
}

function extractImageFromContent(html) {
  if (!html) return '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function extractLinkedInId(url) {
  const company = url.match(/linkedin\.com\/company\/([\w-]+)/);
  const person  = url.match(/linkedin\.com\/in\/([\w-]+)/);
  if (company) return { type: 'company', id: company[1] };
  if (person)  return { type: 'person',  id: person[1]  };
  return null;
}

function isRssUrl(url) {
  if (!url) return false;
  return url.includes('rss.app') || url.includes('feedburner') ||
    url.match(/\.(xml|rss|atom)(\?.*)?$/) ||
    url.includes('/feed') || url.includes('/rss');
}

// 添加账号时调用
async function fetchLinkedIn(linkedinUrl, count = 10, rssUrl = '') {
  const extracted = extractLinkedInId(linkedinUrl);
  const accountId = extracted?.id || linkedinUrl.split('/').filter(Boolean).pop();

  if (rssUrl && isRssUrl(rssUrl)) {
    const result = await fetchRssByAxios(rssUrl, count);
    return { ...result, accountId, accountType: extracted?.type || 'company', rssUrl };
  }

  // 无 RSS URL：占位模式
  return {
    success: true, partial: true, warning: '',
    name: accountId, avatar: '', description: '', items: [],
    accountId, accountType: extracted?.type || 'company',
  };
}

// 定时检查时调用
async function checkLinkedInUpdates(account) {
  if (account.rss_url && isRssUrl(account.rss_url)) {
    return fetchRssByAxios(account.rss_url, account.display_count || 10);
  }
  // 无 RSS：页面 hash 变化检测（降级）
  try {
    const res = await axios.get(account.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000, ...getAxiosProxy(),
    });
    const hash = crypto.createHash('md5').update(res.data).digest('hex');
    return { success: true, hash, items: [] };
  } catch (e) {
    return { success: false, error: e.message, items: [] };
  }
}

module.exports = { fetchLinkedIn, fetchRssByAxios, checkLinkedInUpdates, extractLinkedInId, isRssUrl };
