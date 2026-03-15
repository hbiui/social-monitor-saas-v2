const webpush = require('web-push');
const nodemailer = require('nodemailer');
const axios = require('axios');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

function getSettings() { return db.getAllSettings(); }

// Discord 和 Telegram 在中国大陆被封锁，必须走代理
function getProxyAxios() {
  const proxyUrl = (db.getAllSettings().proxy_url || '').trim();
  if (!proxyUrl) return {};
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return { httpsAgent: new HttpsProxyAgent(proxyUrl), proxy: false };
  } catch (e) { return {}; }
}

function initVapidKeys() {
  const settings = getSettings();
  if (!settings.vapid_public_key || !settings.vapid_private_key) {
    const keys = webpush.generateVAPIDKeys();
    db.setSetting('vapid_public_key', keys.publicKey);
    db.setSetting('vapid_private_key', keys.privateKey);
    console.log('✅ VAPID密钥已生成');
    return keys;
  }
  return { publicKey: settings.vapid_public_key, privateKey: settings.vapid_private_key };
}

function setupWebPush() {
  const settings = getSettings();
  if (settings.vapid_public_key && settings.vapid_private_key) {
    try {
      webpush.setVapidDetails(
        settings.vapid_email || 'mailto:admin@social-monitor.local',
        settings.vapid_public_key, settings.vapid_private_key
      );
    } catch (e) { console.error('WebPush setup error:', e.message); }
  }
}

async function sendPushNotification(title, body, url) {
  setupWebPush();
  const subscriptions = db.getPushSubscriptions();
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify({ title, body, url, icon: '/icon.png' }));
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) db.deletePushSubscription(sub.id);
    }
  }
}

async function sendEmailNotification(subject, html) {
  const settings = getSettings();
  if (!settings.smtp_user || !settings.notify_email) return { success: false, error: '邮件未配置' };
  try {
    const transporter = nodemailer.createTransporter({
      host: settings.smtp_host || 'smtp.gmail.com',
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });
    await transporter.sendMail({ from: `"社媒监控" <${settings.smtp_user}>`, to: settings.notify_email, subject, html });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

async function sendTelegramNotification(text) {
  const settings = getSettings();
  const token = settings.telegram_bot_token;
  const chatId = settings.telegram_chat_id;
  if (!token || !chatId) return { success: false, error: 'Telegram未配置' };
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false,
    }, { timeout: 20000, ...getProxyAxios() });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

async function sendDiscordNotification(content, embeds) {
  const settings = getSettings();
  const webhookUrl = settings.discord_webhook_url;
  if (!webhookUrl) return { success: false, error: 'Discord未配置' };
  try {
    await axios.post(webhookUrl, { content, embeds }, { timeout: 20000, ...getProxyAxios() });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

async function notifyNewPost(account, post) {
  const notifId = uuidv4();
  const message = `${account.name} 发布了新内容：${post.title || (post.content || '').slice(0, 50) || '查看详情'}`;
  db.insertNotification({ id: notifId, account_id: account.id, post_id: post.id, platform: account.platform || '', url: post.url || '', message, read: false });

  const platformIcon = account.platform === 'youtube' ? '🎬' : '💼';
  const platformName = account.platform === 'youtube' ? 'YouTube' : 'LinkedIn';

  sendPushNotification(`${platformIcon} ${account.name} 有新动态`, post.title || (post.content||'').slice(0,100) || '点击查看', post.url).catch(() => {});

  const emailHtml = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
    <h2 style="color:#1a1a2e;">${platformIcon} 竞争对手动态提醒</h2>
    <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
      <p><strong>账号：</strong>${account.name} (${platformName})</p>
      <p><strong>标题：</strong>${post.title || '无标题'}</p>
      <p><strong>摘要：</strong>${(post.content||'').slice(0,200)}</p>
    </div>
    <a href="${post.url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">查看详情</a>
  </div>`;
  sendEmailNotification(`[社媒监控] ${account.name} 有新动态`, emailHtml).catch(() => {});

  const tgText = `${platformIcon} <b>${account.name}</b> 有新动态\n\n📌 <b>${post.title || '无标题'}</b>\n${(post.content||'').slice(0,200)}\n\n<a href="${post.url}">👉 查看详情</a>`;
  sendTelegramNotification(tgText).catch(() => {});

  const discordEmbed = [{
    title: post.title || '新内容动态',
    description: (post.content || '').slice(0, 300),
    url: post.url,
    color: account.platform === 'youtube' ? 16711680 : 30908,
    author: { name: `${platformIcon} ${account.name}` },
    thumbnail: post.thumbnail ? { url: post.thumbnail } : undefined,
    timestamp: post.published_at || new Date().toISOString(),
    footer: { text: `社媒竞对监控 · ${platformName}` },
  }];
  sendDiscordNotification(`${platformIcon} **${account.name}** 有新动态`, discordEmbed).catch(() => {});

  return notifId;
}

// ── Generic multi-channel notification (for auto-analyze / auto-PPT) ───────────
async function sendNotification(text, settingsOverride = null) {
  const pushTitle  = text.split('\n')[0].slice(0,80);
  const pushBody   = text.split('\n').slice(1).join(' ').slice(0,200);
  sendPushNotification(pushTitle, pushBody, '').catch(() => {});
  sendTelegramNotification(text).catch(() => {});
  sendDiscordNotification(text.slice(0,2000), []).catch(() => {});
  sendEmailNotification('[社媒监控] AI分析报告', `<pre style="font-family:monospace">${text.replace(/</g,'&lt;')}</pre>`).catch(() => {});
}

module.exports = { initVapidKeys, sendPushNotification, sendEmailNotification, sendTelegramNotification, sendDiscordNotification, notifyNewPost, getSettings, setupWebPush, sendNotification };


// ════════════════════════════════════════════════════════════════════════════════
// 钉钉通知模块
// 支持两种方式：
//   A) 群机器人 Webhook — 最简单，消息发到钉钉群，所有群成员可见
//      配置项：dingtalk_webhook_url（必填），dingtalk_webhook_secret（选填，加签安全校验）
//   B) 应用工作通知 — 消息发到个人"工作通知"，私密，需创建应用
//      配置项：dingtalk_app_key, dingtalk_app_secret, dingtalk_agent_id, dingtalk_user_ids
// ════════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

// ── A. 群机器人：生成 HMAC-SHA256 签名 ───────────────────────────────────────
// 签名规则（官方文档）：
//   1. timestamp + "\n" + secret 作为签名字符串
//   2. HMAC-SHA256 计算后 Base64 编码
//   3. URL encode 后附加到 Webhook URL 的 timestamp 和 sign 参数
function dingtalkRobotSign(secret) {
  const timestamp = Date.now().toString();
  const strToSign = `${timestamp}\n${secret}`;
  const sign = crypto
    .createHmac('sha256', secret)
    .update(strToSign)
    .digest('base64');
  const signEncoded = encodeURIComponent(sign);
  return { timestamp, signEncoded };
}

// ── A. 群机器人发送消息 ─────────────────────────────────────────────────────
// 官方 API: POST https://oapi.dingtalk.com/robot/send?access_token=TOKEN
// 支持消息类型: text / markdown（本工具使用 markdown）
// 频率限制: 每个机器人每分钟最多20条消息
async function sendDingtalkRobotNotification(title, content) {
  const settings = getSettings();
  const webhookUrl = settings.dingtalk_webhook_url;
  const secret     = settings.dingtalk_webhook_secret; // 可选：开启"加签"后的密钥（SEC...开头）

  if (!webhookUrl) return { success: false, error: '钉钉群机器人未配置 Webhook 地址' };

  // 构建完整的 Webhook 请求 URL（可能带签名参数）
  let finalUrl = webhookUrl;
  // 只要 secret 不为空就启用加签（官方密钥通常以 SEC 开头，但不强制校验前缀）
  if (secret && secret.trim()) {
    const { timestamp, signEncoded } = dingtalkRobotSign(secret.trim());
    // 若 webhookUrl 已含 ?access_token=... 则用 & 追加
    const sep = webhookUrl.includes('?') ? '&' : '?';
    finalUrl = `${webhookUrl}${sep}timestamp=${timestamp}&sign=${signEncoded}`;
  }

  // 将 AI 分析 Markdown 转为钉钉支持的 Markdown 格式
  // 钉钉 Markdown 支持：## 标题 / **粗体** / - 列表 / > 引用
  const text = formatDingtalkMarkdown(title, content);

  const payload = {
    msgtype: 'markdown',
    markdown: {
      title: title || '📊 社媒AI分析报告',  // 会话列表预览文字
      text,
    },
  };

  try {
    const resp = await axios.post(finalUrl, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
    const data = resp.data;
    if (data.errcode === 0) {
      return { success: true };
    } else {
      return { success: false, error: `钉钉错误 ${data.errcode}: ${data.errmsg}` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── B. 工作通知：获取企业应用 access_token ─────────────────────────────────
// 官方 API（旧版，兼容性最好）:
//   GET https://oapi.dingtalk.com/gettoken?appkey=KEY&appsecret=SECRET
// 返回: { errcode:0, access_token:"xxx", expires_in:7200 }
// Token 有效期 2 小时，做简单内存缓存避免频繁请求
const _dingtalkTokenCache = { token: null, expiresAt: 0 };

async function getDingtalkWorkToken(appKey, appSecret) {
  const now = Date.now();
  // 若缓存的 token 还有超过5分钟有效期，直接复用
  if (_dingtalkTokenCache.token && now < _dingtalkTokenCache.expiresAt - 300000) {
    return _dingtalkTokenCache.token;
  }
  const url = `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(appKey)}&appsecret=${encodeURIComponent(appSecret)}`;
  const resp = await axios.get(url, { timeout: 10000 });
  if (resp.data.errcode !== 0) {
    throw new Error(`获取钉钉 access_token 失败: ${resp.data.errmsg}`);
  }
  _dingtalkTokenCache.token     = resp.data.access_token;
  _dingtalkTokenCache.expiresAt = now + (resp.data.expires_in || 7200) * 1000;
  return _dingtalkTokenCache.token;
}

// ── B. 应用工作通知发送消息 ────────────────────────────────────────────────
// 官方 API:
//   POST https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=TOKEN
// 参数:
//   agent_id    - 应用 AgentId（在开发者后台查看）
//   userid_list - 接收人的钉钉 userId，逗号分隔（最多100人）
//   msg         - 消息体（text / markdown / link 等类型）
// 消息在钉钉"工作通知"会话中接收，私密，不进群
async function sendDingtalkWorkNotification(title, content) {
  const settings  = getSettings();
  const appKey    = settings.dingtalk_app_key;
  const appSecret = settings.dingtalk_app_secret;
  const agentId   = settings.dingtalk_agent_id;
  const userIds   = settings.dingtalk_user_ids; // 逗号分隔的 userId，如 "abc123,def456"

  if (!appKey || !appSecret || !agentId || !userIds) {
    return { success: false, error: '钉钉工作通知未完整配置（需要 AppKey / AppSecret / AgentId / 接收人 userId）' };
  }

  let token;
  try {
    token = await getDingtalkWorkToken(appKey, appSecret);
  } catch (e) {
    return { success: false, error: `获取 Token 失败: ${e.message}` };
  }

  const text = formatDingtalkMarkdown(title, content);

  const payload = {
    agent_id:    agentId,
    userid_list: userIds.trim(),
    to_all_user: false,
    msg: {
      msgtype: 'markdown',
      markdown: {
        title: title || '📊 社媒AI分析报告',
        text,
      },
    },
  };

  try {
    const resp = await axios.post(
      `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`,
      payload,
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );
    const data = resp.data;
    if (data.errcode === 0) {
      return { success: true, taskId: data.task_id };
    } else {
      return { success: false, error: `钉钉工作通知错误 ${data.errcode}: ${data.errmsg}` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── 将 AI Markdown 内容格式化为钉钉 Markdown ──────────────────────────────
// 钉钉 Markdown 支持有限，做简单清理和适配
function formatDingtalkMarkdown(title, content) {
  // 钉钉 Markdown 限制约4000字符
  const MAX_LEN = 3800;
  let text = content || '';
  // 去除代码块（钉钉不支持 ```code```）
  text = text.replace(/```[\s\S]*?```/g, '');
  // blockquote 转换
  text = text.replace(/^> /gm, '> ');
  // 确保 ## 标题前有换行
  text = text.replace(/([^\n])\n(#{1,3} )/g, '$1\n\n$2');
  // 截断
  if (text.length > MAX_LEN) {
    text = text.slice(0, MAX_LEN) + '\n\n...(内容过长，已截断)';
  }
  return `## ${title || '📊 社媒AI分析报告'}\n\n${text}\n\n---\n由社媒竞对监控工具自动生成`;
}

module.exports.sendDingtalkRobotNotification = sendDingtalkRobotNotification;
module.exports.sendDingtalkWorkNotification  = sendDingtalkWorkNotification;
