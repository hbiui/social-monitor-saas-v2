// 代理配置模块
const db = require('./db');

function getProxyUrl() {
  return (db.getAllSettings().proxy_url || '').trim();
}

// 给 axios 用：统一走 HttpsProxyAgent，兼容 Clash HTTP 代理 CONNECT 模式
function getAxiosProxy() {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return {};
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const agent = new HttpsProxyAgent(proxyUrl);
    // proxy:false 禁用 axios 内置代理，改由 agent 接管（避免冲突）
    return { httpsAgent: agent, proxy: false };
  } catch (e) {
    console.error('[Proxy] HttpsProxyAgent error:', e.message);
    return {};
  }
}

// 给 rss-parser 用
function getRssRequestOptions() {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return {};
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return { agent: new HttpsProxyAgent(proxyUrl) };
  } catch (e) {
    return {};
  }
}

module.exports = { getProxyUrl, getAxiosProxy, getRssRequestOptions };
