require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { fetchYouTube } = require('./fetchers/youtube');
const { fetchLinkedIn } = require('./fetchers/linkedin');
const { initVapidKeys, getSettings, sendTelegramNotification, sendDiscordNotification, sendEmailNotification, sendPushNotification, sendDingtalkRobotNotification, sendDingtalkWorkNotification } = require('./notifications');
const { startScheduler, runAllChecks, checkAccount } = require('./scheduler');
const { analyzeWithAI, getAISettings } = require('./ai');

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── SSE clients registry ───────────────────────────────────────────────────
const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  }
}

app.get('/api/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  sseClients.add(res);
  res.write(`event: connected\ndata: {"ok":true}\n\n`);
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); }
  }, 25000);
  req.on('close', () => { sseClients.delete(res); clearInterval(heartbeat); });
});

// ─── Patch scheduler to broadcast SSE on new posts ─────────────────────────
const origCheckAccount = checkAccount;

// ═══════════════════════════════════════════════════════════════════════════
// ORIGINAL ENDPOINTS (unchanged from v19)
// ═══════════════════════════════════════════════════════════════════════════

// === Accounts ===
app.get('/api/accounts', (req, res) => res.json(db.getAccounts()));

app.post('/api/accounts', async (req, res) => {
  const { platform, url, display_count, rss_url } = req.body;
  if (!platform || !url) return res.status(400).json({ error: '平台和URL为必填项' });
  const count = parseInt(display_count) || 10;
  let name = '', avatar = '', description = '', accountId = '', warning = '', initialPosts = [];
  try {
    if (platform === 'youtube') {
      const result = await fetchYouTube(url, count);
      if (!result.success && !result.channelId) return res.status(400).json({ error: result.error || 'YouTube账号解析失败' });
      accountId = result.channelId || '';
      name = result.channelTitle || url.split('/').pop().replace('@','') || url;
      avatar = result.channelAvatar || '';
      initialPosts = result.items || [];
      warning = result.warning || (result.success ? '' : result.error) || '';
    } else if (platform === 'linkedin') {
      const result = await fetchLinkedIn(url, count, rss_url || '');
      if (!result.success && !result.partial) return res.status(400).json({ error: result.error || 'LinkedIn账号解析失败' });
      accountId = result.accountId || url.split('/').filter(Boolean).pop();
      name = result.name || accountId;
      name = name.replace(/\s*[|｜]\s*(LinkedIn|Twitter|Facebook|Instagram|YouTube)[^|]*$/i, '').trim();
      avatar = result.avatar || '';
      description = result.description || '';
      initialPosts = result.items || [];
      warning = result.warning || '';
    }
    if (db.getAccountByPlatformAndAccountId(platform, accountId)) return res.status(409).json({ error: '该账号已在监控列表中' });
    const id = uuidv4();
    db.insertAccount({ id, platform, name, account_id: accountId, url, rss_url: rss_url || '', avatar, description, display_count: count, enabled: true, last_checked: new Date().toISOString(), last_post_id: '' });
    for (const item of initialPosts) {
      const postId = `${platform}-${item.id || item.url}`;
      db.insertPost({ id: postId, account_id: id, platform, title: (item.title||'').slice(0,500), content: (item.content||'').slice(0,2000), url: item.url, thumbnail: item.thumbnail||'', published_at: item.published_at||new Date().toISOString(), is_new: false });
    }
    if (initialPosts.length > 0) db.updateAccount(id, { last_post_id: `${platform}-${initialPosts[0].id||initialPosts[0].url}` });
    broadcastSSE('account_added', { id, name, platform });
    res.json({ account: db.getAccount(id), posts: db.getPosts({ account_id: id, limit: count }), warning });
  } catch (e) {
    console.error('Add account error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/accounts/:id', (req, res) => {
  const updates = {};
  if (req.body.enabled !== undefined) updates.enabled = !!req.body.enabled;
  if (req.body.display_count) updates.display_count = parseInt(req.body.display_count);
  if (req.body.name) updates.name = req.body.name;
  if (req.body.rss_url !== undefined) updates.rss_url = req.body.rss_url;
  db.updateAccount(req.params.id, updates);
  res.json({ success: true });
});

app.delete('/api/accounts/:id', (req, res) => {
  db.deletePosts(req.params.id);
  db.deleteNotificationsByAccount(req.params.id);
  db.deleteAccount(req.params.id);
  broadcastSSE('account_removed', { id: req.params.id });
  res.json({ success: true });
});

app.post('/api/accounts/:id/check', async (req, res) => {
  const account = db.getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: '账号不存在' });
  await checkAccount(account);
  const posts = db.getPosts({ account_id: account.id, limit: account.display_count || 10 });
  broadcastSSE('posts_updated', { account_id: account.id, count: posts.length });
  res.json({ success: true, posts });
});

app.post('/api/accounts/reorder', (req, res) => {
  const { accountIds } = req.body;
  if (!Array.isArray(accountIds)) return res.status(400).json({ error: 'accountIds must be an array' });
  db.reorderAccounts(accountIds);
  res.json({ success: true });
});

// === Posts ===
app.get('/api/posts', (req, res) => {
  const { account_id, limit = 20, offset = 0, platform, search } = req.query;
  let posts = db.getPosts({ account_id, limit: (platform || search) ? 10000 : parseInt(limit), offset: (platform || search) ? 0 : parseInt(offset) });
  if (platform) posts = posts.filter(p => p.platform === platform);
  if (search) {
    const q = search.toLowerCase();
    posts = posts.filter(p => (p.title||'').toLowerCase().includes(q) || (p.content||'').toLowerCase().includes(q));
  }
  // Apply pagination after filters
  if (platform || search) posts = posts.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json(posts);
});
app.put('/api/posts/:id/read', (req, res) => {
  db.updatePost(req.params.id, { is_new: false });
  res.json({ success: true });
});

// === Notifications ===
app.get('/api/notifications', (req, res) => res.json(db.getNotifications()));
app.get('/api/notifications/unread-count', (req, res) => res.json({ count: db.getUnreadNotifCount() }));
app.put('/api/notifications/read-all', (req, res) => {
  db.markAllNotificationsRead();
  db.markAllPostsRead();
  res.json({ success: true });
});
app.put('/api/notifications/:id/read', (req, res) => {
  const { read } = req.body;
  db.markNotificationRead(req.params.id, read !== false);
  res.json({ success: true });
});
app.delete('/api/notifications/:id', (req, res) => {
  db.deleteNotification(req.params.id);
  res.json({ success: true });
});
app.delete('/api/notifications', (req, res) => {
  const { ids } = req.body;
  if (ids && ids.length) db.deleteNotificationsBulk(ids);
  res.json({ success: true });
});
app.put('/api/posts/mark-all-read', (req, res) => {
  db.markAllPostsRead();
  res.json({ success: true });
});

// === Push ===
app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: db.getSetting('vapid_public_key') }));
app.post('/api/push/subscribe', (req, res) => {
  db.insertPushSubscription({ id: uuidv4(), subscription: JSON.stringify(req.body.subscription) });
  res.json({ success: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  db.deletePushSubscriptionByEndpoint(req.body.endpoint);
  res.json({ success: true });
});

// === Settings ===
app.get('/api/settings', (req, res) => {
  const s = { ...db.getAllSettings() };
  if (s.smtp_pass) s.smtp_pass = '***';
  if (s.vapid_private_key) s.vapid_private_key = '***';
  if (s.dingtalk_webhook_secret) s.dingtalk_webhook_secret = '***';
  if (s.dingtalk_app_secret)     s.dingtalk_app_secret     = '***';
  s.auto_analyze_enabled = s.auto_analyze_enabled === 'true';
  s.auto_ppt_enabled     = s.auto_ppt_enabled     === 'true';
  res.json(s);
});
app.put('/api/settings', (req, res) => {
  const allowed = [
    'check_interval','default_display_count','youtube_api_key',
    'smtp_host','smtp_port','smtp_user','smtp_pass','notify_email',
    'telegram_bot_token','telegram_chat_id','discord_webhook_url','proxy_url',
    'dingtalk_webhook_url','dingtalk_webhook_secret',
    'dingtalk_app_key','dingtalk_app_secret','dingtalk_agent_id','dingtalk_user_ids',
    'ai_provider','ai_system_prompt','ai_auto_notify',
    'doubao_api_key','doubao_model','doubao_visual_model',
    'zhipu_api_key','zhipu_model',
    'gemini_api_key','gemini_model',
    'claude_api_key','claude_model',
    'openai_api_key','openai_model','openai_base_url',
    'auto_analyze_enabled','auto_ppt_enabled','auto_analyze_mode',
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) db.setSetting(key, String(req.body[key]));
  }
  if (req.body.check_interval) startScheduler();
  res.json({ success: true });
});

app.get('/api/ai/auto-jobs', (req, res) => {
  const { getRunningAutoJobs } = require('./scheduler');
  res.json(getRunningAutoJobs ? getRunningAutoJobs() : []);
});

// === AI Analysis ===
app.post('/api/ai/analyze', async (req, res) => {
  res.setTimeout(650000, () => {
    if (!res.headersSent) res.status(504).json({ success: false, error: 'AI分析超时，请减少动态数量后重试。' });
  });
  try {
    const { post_ids, account_id, mode, custom_prompt, provider } = req.body;
    let posts = [];
    if (post_ids && Array.isArray(post_ids) && post_ids.length > 0) {
      for (const pid of post_ids) {
        const p = db.getPost(pid);
        if (p) { const acc = db.getAccount(p.account_id); posts.push({ ...p, account_name: acc?.name || '' }); }
      }
    } else if (account_id) {
      const limit = req.body.limit || 5;
      posts = db.getPosts({ account_id, limit: parseInt(limit) });
    } else {
      return res.status(400).json({ success: false, error: '请提供 post_ids 或 account_id' });
    }
    if (!posts.length) return res.status(404).json({ success: false, error: '未找到指定的动态内容' });
    let analyzeMode = mode;
    if (!analyzeMode) {
      if (posts.length === 1) analyzeMode = 'single';
      else { const accountIds = [...new Set(posts.map(p => p.account_id))]; analyzeMode = accountIds.length > 1 ? 'cross' : 'multi'; }
    }
    const result = await analyzeWithAI(posts, analyzeMode, custom_prompt || '', provider || null);
    if (result.success) {
      const accNames = [...new Set(posts.map(p => p.account_name || '').filter(Boolean))];
      db.insertAIHistory({ id: uuidv4(), mode: analyzeMode, provider: result.provider || '', model: result.model || '', account_names: accNames, post_count: posts.length, result: result.result, custom_prompt: custom_prompt || '' });
      broadcastSSE('ai_analysis_done', { mode: analyzeMode, provider: result.provider });
    }
    res.json(result);
  } catch (e) {
    console.error('AI analyze error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/ai/settings', (req, res) => {
  const s = getAISettings();
  const masked = { ...s };
  ['doubao_api_key','zhipu_api_key','gemini_api_key','claude_api_key','openai_api_key'].forEach(k => {
    if (masked[k]) masked[k] = masked[k].slice(0, 6) + '****';
  });
  res.json(masked);
});

app.post('/api/ai/test', async (req, res) => {
  const { provider } = req.body;
  const testPosts = [{ platform: 'youtube', account_name: '测试账号', title: 'AI连通性测试', content: '这是一条用于测试AI连通性的内容，请回复「连接成功」四个字即可。', published_at: new Date().toISOString(), url: 'https://example.com' }];
  const result = await analyzeWithAI(testPosts, 'single', '请只回复「连接成功」四个字', provider, { timeout: 15000 });
  res.json(result);
});

// PPT routes (preserved)
const { spawn } = require('child_process');
const PPT_DIR    = path.join(__dirname, 'data', 'ppt');
const PPT_STATUS = path.join(__dirname, 'data', 'ppt', 'status');
if (!fs.existsSync(PPT_DIR))    fs.mkdirSync(PPT_DIR,    { recursive: true });
if (!fs.existsSync(PPT_STATUS)) fs.mkdirSync(PPT_STATUS, { recursive: true });
app.use('/ppt', express.static(PPT_DIR));

app.post('/api/ai/generate-ppt', (req, res) => {
  const { analysis_text, title, subtitle, date, enable_images, mode, account_names } = req.body;
  if (!analysis_text) return res.status(400).json({ success: false, error: '缺少分析内容' });
  const settings   = db.getAllSettings();
  const apiKey     = settings.doubao_api_key || '';
  const proxyUrl   = settings.proxy_url      || '';
  const textModel  = settings.doubao_model   || 'doubao-seed-2-0-pro-260215';
  const jobId      = `ppt-${Date.now()}`;
  const modeLabel = { single:'单条分析', multi:'多条分析', cross:'跨账号分析' };
  const accNames  = Array.isArray(account_names) ? account_names : [];
  const smartTitle = title || (accNames.length ? `${modeLabel[mode]||'综合分析'}·${accNames.join('、')}` : '社媒AI竞对分析报告');
  const filename   = `${jobId}.pptx`;
  const outPath    = path.join(PPT_DIR, filename);
  const statusPath = path.join(PPT_STATUS, `${jobId}.json`);
  const jobPath    = path.join(PPT_STATUS, `${jobId}-job.json`);
  fs.writeFileSync(statusPath, JSON.stringify({ status: 'running', step: 0, message: '⏳ 任务已提交...', progress: 2, url: null, error: null, updated: Date.now() / 1000 }));
  const job = { job_id: jobId, status_path: statusPath, output_path: outPath, api_key: apiKey, proxy_url: proxyUrl, text_model: textModel, visual_model: settings.doubao_visual_model || 'doubao-seedream-5-0-260128', analysis_text, title: smartTitle, subtitle: subtitle || '', date: date || new Date().toLocaleDateString('zh-CN'), enable_images: (enable_images !== false) && !!apiKey };
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf-8');
  const pptHistId = uuidv4();
  db.insertPPTHistory({ id: pptHistId, job_id: jobId, title: smartTitle, subtitle: subtitle || '', model: textModel, mode: mode || 'cross', account_names: accNames, status: 'running', filename, url: null, slide_count: 0, read: false });
  const candidates = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
  function tryPython(i) {
    const cmd = candidates[i];
    if (!cmd) { fs.writeFileSync(statusPath, JSON.stringify({ status: 'error', step: 0, message: '找不到 Python 解释器', progress: 0, error: '找不到Python', url: null, updated: Date.now()/1000 })); return; }
    const child = spawn(cmd, [path.join(__dirname, 'ppt_pipeline.py'), jobPath], { detached: false });
    child.stderr.on('data', d => process.stderr.write(`[PPT] ${d}`));
    child.stdout.on('data', d => process.stdout.write(`[PPT] ${d}`));
    child.on('error', err => { if (err.code === 'ENOENT') tryPython(i + 1); });
  }
  tryPython(0);
  res.json({ success: true, job_id: jobId, ppt_hist_id: pptHistId });
});

app.get('/api/ai/ppt-status/:jobId', (req, res) => {
  const statusPath = path.join(PPT_STATUS, `${req.params.jobId}.json`);
  if (!fs.existsSync(statusPath)) return res.status(404).json({ status: 'not_found', message: '任务不存在' });
  try {
    const data = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    if (data.status === 'done' || data.status === 'error') {
      const hist = db.getPPTHistory(500).find(h => h.job_id === req.params.jobId);
      if (hist && hist.status === 'running') {
        const slideMatch = (data.message || '').match(/(\d+)页/);
        db.updatePPTHistory(hist.id, { status: data.status, url: data.url || null, slide_count: slideMatch ? parseInt(slideMatch[1]) : 0, error: data.error || null, finished_at: new Date().toISOString() });
      }
    }
    res.json(data);
  } catch (e) { res.json({ status: 'running', message: '读取状态中...', progress: 5 }); }
});

app.get('/api/ai/ppt-history', (req, res) => res.json(db.getPPTHistory()));
app.post('/api/ai/ppt-history/mark-read', (req, res) => {
  const { ids } = req.body;
  const all = db.getPPTHistory(500);
  const toMark = ids ? all.filter(h => ids.includes(h.id)) : all;
  toMark.forEach(h => db.updatePPTHistory(h.id, { read: true }));
  res.json({ success: true });
});
app.delete('/api/ai/ppt-history/:id', (req, res) => {
  const hist = db.getPPTHistory(500).find(h => h.id === req.params.id);
  if (hist && hist.filename) { const fp = path.join(PPT_DIR, hist.filename); if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch(e) {} }
  db.deletePPTHistory(req.params.id);
  res.json({ success: true });
});
app.delete('/api/ai/ppt-history', (req, res) => {
  const { ids } = req.body;
  const records = ids ? db.getPPTHistory(500).filter(h => ids.includes(h.id)) : db.getPPTHistory(500);
  records.forEach(hist => { if (hist.filename) { const fp = path.join(PPT_DIR, hist.filename); if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch(e) {} } });
  if (ids && ids.length) db.deletePPTHistoryBulk(ids); else db.clearPPTHistory();
  res.json({ success: true });
});
app.get('/api/ai/history', (req, res) => res.json(db.getAIHistory()));
app.delete('/api/ai/history/:id', (req, res) => { db.deleteAIHistory(req.params.id); res.json({ success: true }); });
app.delete('/api/ai/history', (req, res) => {
  const { ids } = req.body;
  if (ids && ids.length) db.deleteAIHistoryBulk(ids); else db.clearAIHistory();
  res.json({ success: true });
});
app.post('/api/ai/notify', async (req, res) => {
  const { content, channels } = req.body;
  if (!content) return res.status(400).json({ success: false, error: '缺少通知内容' });
  const results = {};
  const enableChannels = channels || ['telegram', 'discord', 'email', 'push'];
  if (enableChannels.includes('telegram')) results.telegram = await sendTelegramNotification(`🤖 <b>AI内容分析报告</b>\n\n${content.slice(0,4000)}`);
  if (enableChannels.includes('discord')) results.discord = await sendDiscordNotification('', [{ title: '🤖 AI内容分析报告', description: content.slice(0,4000), color: 7664886 }]);
  if (enableChannels.includes('email')) results.email = await sendEmailNotification('[社媒监控] AI内容分析报告', `<pre style="white-space:pre-wrap">${content}</pre>`);
  if (enableChannels.includes('push')) { await sendPushNotification('🤖 AI分析完成', content.slice(0,100)+'...', '/'); results.push = { success: true }; }
  res.json({ success: true, results });
});

// === Test endpoints ===
app.post('/api/test/dingtalk-robot', async (req, res) => { try { res.json(await sendDingtalkRobotNotification('✅ 钉钉群机器人连接测试', '这是一条测试消息。如果您看到此消息，说明配置成功！')); } catch(e) { res.status(500).json({ success: false, error: e.message }); } });
app.post('/api/test/dingtalk-work', async (req, res) => { try { res.json(await sendDingtalkWorkNotification('✅ 钉钉工作通知测试', '这是一条测试消息。')); } catch(e) { res.status(500).json({ success: false, error: e.message }); } });
app.post('/api/test/rss', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ success: false, error: '未提供 RSS 链接' });
  try {
    const Parser = require('rss-parser');
    const { getRssRequestOptions } = require('./proxy');
    const parser = new Parser({ timeout: 12000, requestOptions: getRssRequestOptions() });
    const feed = await parser.parseURL(url);
    const count = (feed.items || []).length;
    const latest = feed.items?.[0]?.title || '(无标题)';
    res.json({ success: true, count, latest: latest.slice(0, 60), feedTitle: feed.title || '' });
  } catch(e) { res.json({ success: false, error: e.message }); }
});
app.post('/api/test/proxy', async (req, res) => {
  const { proxy_url } = req.body;
  const url = proxy_url || db.getSetting('proxy_url') || '';
  if (!url) return res.json({ success: false, error: '未填写代理地址' });
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const axios = require('axios');
    const r = await axios.get('https://www.google.com', { httpsAgent: new HttpsProxyAgent(url), proxy: false, timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }, validateStatus: () => true });
    res.json(r.status < 500 ? { success: true, message: `代理连接成功！（HTTP ${r.status}）` } : { success: false, error: `代理响应异常 ${r.status}` });
  } catch(e) { res.json({ success: false, error: '代理连接失败: ' + e.message }); }
});
app.post('/api/test/telegram', async (req, res) => { res.json(await sendTelegramNotification('✅ <b>社媒监控</b> - Telegram通知测试成功！')); });
app.post('/api/test/discord', async (req, res) => { res.json(await sendDiscordNotification('✅ 社媒监控 - Discord通知测试成功！', [{ title: '通知测试', description: '如果你看到此消息，Discord通知配置正确。', color: 7664886 }])); });

app.post('/api/test/youtube', async (req, res) => {
  const { api_key } = req.body;
  const key = api_key || db.getSetting('youtube_api_key') || '';
  if (!key) return res.json({ success: false, error: '未提供 API Key' });
  try {
    const axios = require('axios');
    const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'id,snippet', forHandle: 'YouTube', key },
      timeout: 8000
    });
    if (r.data.items) res.json({ success: true, message: 'API Key 有效！频道解析正常。' });
    else res.json({ success: false, error: 'API 返回数据异常' });
  } catch(e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.json({ success: false, error: 'API Key 无效或超配额: ' + msg });
  }
});

app.get('/api/stats', (req, res) => res.json(db.getStats()));
app.post('/api/check-all', (req, res) => {
  res.json({ success: true });
  runAllChecks().then(() => broadcastSSE('check_complete', { ts: Date.now() })).catch(console.error);
});

// ═══════════════════════════════════════════════════════════════════════════
// NEW ANALYTICS & SEARCH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── Global Search ────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ accounts: [], posts: [] });
  const query = q.toLowerCase().trim();
  const accounts = db.getAccounts().filter(a =>
    a.name.toLowerCase().includes(query) || a.platform.includes(query)
  ).slice(0, 5);
  const posts = db.getPosts({ limit: 200 }).filter(p =>
    (p.title||'').toLowerCase().includes(query) || (p.content||'').toLowerCase().includes(query)
  ).slice(0, 10);
  res.json({ accounts, posts });
});

// ── Analytics: Overview ───────────────────────────────────────────────────────
app.get('/api/analytics/overview', (req, res) => {
  const accounts = db.getAccounts();
  const allPosts = db.getPosts({ limit: 10000 });
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(todayStart); monthStart.setDate(monthStart.getDate() - 30);

  const todayPosts = allPosts.filter(p => new Date(p.published_at || p.fetched_at) >= todayStart);
  const weekPosts = allPosts.filter(p => new Date(p.published_at || p.fetched_at) >= weekStart);
  const monthPosts = allPosts.filter(p => new Date(p.published_at || p.fetched_at) >= monthStart);

  const ytAccounts = accounts.filter(a => a.platform === 'youtube');
  const liAccounts = accounts.filter(a => a.platform === 'linkedin');
  const ytPosts = allPosts.filter(p => p.platform === 'youtube');
  const liPosts = allPosts.filter(p => p.platform === 'linkedin');

  res.json({
    total_accounts: accounts.length,
    enabled_accounts: accounts.filter(a => a.enabled).length,
    youtube_accounts: ytAccounts.length,
    linkedin_accounts: liAccounts.length,
    total_posts: allPosts.length,
    new_posts: allPosts.filter(p => p.is_new).length,
    today_posts: todayPosts.length,
    week_posts: weekPosts.length,
    month_posts: monthPosts.length,
    youtube_posts: ytPosts.length,
    linkedin_posts: liPosts.length,
    unread_notifications: db.getUnreadNotifCount(),
    ai_analyses: db.getAIHistory(1000).length,
    last_check: accounts.reduce((latest, a) => {
      if (!a.last_checked) return latest;
      return !latest || new Date(a.last_checked) > new Date(latest) ? a.last_checked : latest;
    }, null),
  });
});

// ── Analytics: Trends (posts per day, last 30 days) ──────────────────────────
app.get('/api/analytics/trends', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const allPosts = db.getPosts({ limit: 10000 });
  const now = new Date();
  const result = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayPosts = allPosts.filter(p => {
      const pd = (p.published_at || p.fetched_at || '').slice(0, 10);
      return pd === dateStr;
    });
    result.push({
      date: dateStr,
      total: dayPosts.length,
      youtube: dayPosts.filter(p => p.platform === 'youtube').length,
      linkedin: dayPosts.filter(p => p.platform === 'linkedin').length,
    });
  }
  res.json(result);
});

// ── Analytics: Platform distribution ─────────────────────────────────────────
app.get('/api/analytics/platforms', (req, res) => {
  const allPosts = db.getPosts({ limit: 10000 });
  const platforms = {};
  allPosts.forEach(p => { platforms[p.platform] = (platforms[p.platform] || 0) + 1; });
  res.json(Object.entries(platforms).map(([platform, count]) => ({ platform, count })));
});

// ── Analytics: Account activity (posts per account) ───────────────────────────
app.get('/api/analytics/accounts-activity', (req, res) => {
  const accounts = db.getAccounts();
  const allPosts = db.getPosts({ limit: 10000 });
  const result = accounts.map(acc => {
    const accPosts = allPosts.filter(p => p.account_id === acc.id);
    const recentPosts = accPosts.filter(p => {
      const d = new Date(p.published_at || p.fetched_at);
      return (Date.now() - d.getTime()) < 30 * 24 * 60 * 60 * 1000;
    });
    return {
      id: acc.id,
      name: acc.name,
      platform: acc.platform,
      avatar: acc.avatar,
      total_posts: accPosts.length,
      recent_posts: recentPosts.length,
      last_checked: acc.last_checked,
      enabled: acc.enabled,
    };
  }).sort((a, b) => b.recent_posts - a.recent_posts);
  res.json(result);
});

// ── Analytics: Keywords extraction ───────────────────────────────────────────
app.get('/api/analytics/keywords', (req, res) => {
  const allPosts = db.getPosts({ limit: 500 });
  const stopWords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','up','about',
    'into','through','during','before','after','above','below','between','out','off','over','under',
    'again','further','then','once','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','shall','should','may','might','must','can','could',
    'i','me','my','myself','we','our','you','your','he','him','his','she','her','they','them','their',
    'this','that','these','those','what','which','who','whom','how','when','where','why',
    'not','no','nor','so','yet','both','either','neither','whether','it','its','itself',
    'also','just','more','new','first','last','one','two','three','than','such','all','been',
    '的','了','在','是','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要',
    '去','你','会','着','没有','看','好','自己','这','那','它','他','她','们','与','以','及','或','而',
    '了解','关于','通过','提供','实现','使用','包括','已经','可以','进行','我们','更多','相关','product','products',
    // URL/link junk
    'https','http','lnkd','www','com','bit','ref','source','click','link','share','follow',
    // Brand/company names to exclude from keyword stats
    'sunell','milesight','longse','uniview','dahua','tvt','hikvision','hanwha','axis',
    'bosch','genetec','milestone','avigilon','pelco','flir','mobotix','vivotek',
    // Common noise words
    'time','video','image','data','day','week','month','year','today',
    'use','used','using','user','users','based','make','made','take','know','said',
    'need','want','help','good','great','high','low','large','small','long','full',
    'amp','href','src','alt','class','div','span',
  ]);

  // Security/surveillance industry domain phrases (bi/tri-grams)
  const industryPhrases = [
    'access control','video surveillance','smart security','intrusion detection',
    'facial recognition','license plate recognition','deep learning','edge computing',
    'iot security','cloud security','zero trust','threat detection','incident response',
    'perimeter security','cctv camera','ip camera','thermal camera','ptz camera',
    'smart city','public safety','command center','situation awareness','safe city',
    'cybersecurity','data protection','privacy compliance','gdpr compliance',
    'biometric authentication','multi-factor authentication','endpoint security',
    'network security','zero-day vulnerability','ransomware protection','malware detection',
    'security operations','soc platform','siem solution','xdr platform','edr solution',
    'artificial intelligence','machine learning','computer vision','neural network',
    'cloud platform','saas solution','digital transformation','smart building',
    'security camera','surveillance system','alarm system','video analytics',
    'object detection','behavior analysis','crowd detection','heat mapping',
    '人工智能','机器学习','深度学习','计算机视觉','边缘计算','物联网安全',
    '视频监控','智能安防','人脸识别','车牌识别','行为分析','视频分析',
    '智慧城市','平安城市','综治平台','指挥中心','态势感知','应急指挥',
    '门禁系统','报警系统','入侵检测','安全运营','安全响应','联动报警',
    '云安全','数据安全','隐私保护','合规管理','零信任','终端安全',
    '智能楼宇','楼宇自动化','消防安全','周界防护','安检系统','门禁管理',
    '高清摄像机','热成像','星光摄像','全景摄像','球形摄像机','网络摄像机',
    '数字化转型','智慧园区','智慧交通','工业安全','网络安全','信息安全',
  ];

  const freq = {};
  allPosts.forEach(p => {
    const rawText = `${p.title||''} ${p.content||''}`;
    const textLower = rawText.toLowerCase();

    // Match industry phrases first
    industryPhrases.forEach(phrase => {
      if (textLower.includes(phrase.toLowerCase())) {
        const key = phrase.toLowerCase();
        freq[key] = (freq[key] || 0) + 1;
      }
    });

    // Individual words
    const words = rawText.split(/[\s\-_,，。！？、：；""''【】《》()\[\]<>|/\\@#$%^&*+=~`]+/)
      .map(w => w.toLowerCase().trim())
      .filter(w => w.length >= 3 && w.length <= 25 && !stopWords.has(w) && !/^\d+$/.test(w)
        && !/^https?/.test(w) && !/lnkd/.test(w) && !/^www\./.test(w) && !w.includes('.in')
        && !w.includes('://') && !/^[a-z0-9]{1,3}$/.test(w));
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

    // English bigrams
    const enWords = words.filter(w => /^[a-z]/.test(w) && w.length >= 4 && !stopWords.has(w));
    for (let i = 0; i < enWords.length - 1; i++) {
      if (!stopWords.has(enWords[i]) && !stopWords.has(enWords[i+1])) {
        const bigram = enWords[i] + ' ' + enWords[i+1];
        freq[bigram] = (freq[bigram] || 0) + 1;
      }
    }
  });

  const sorted = Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word, count]) => ({ word, count }));

  res.json(sorted);
});

// ── Analytics: Publishing frequency per account ───────────────────────────────
app.get('/api/analytics/frequency', (req, res) => {
  const accounts = db.getAccounts();
  const allPosts = db.getPosts({ limit: 10000 });
  const days = 30;
  const now = Date.now();

  const result = accounts.map(acc => {
    const accPosts = allPosts.filter(p => {
      if (p.account_id !== acc.id) return false;
      const d = new Date(p.published_at || p.fetched_at);
      return (now - d.getTime()) < days * 24 * 60 * 60 * 1000;
    });
    return {
      name: acc.name,
      platform: acc.platform,
      posts_last_30d: accPosts.length,
      avg_per_week: parseFloat((accPosts.length / (days / 7)).toFixed(1)),
    };
  }).filter(a => a.posts_last_30d > 0).sort((a, b) => b.posts_last_30d - a.posts_last_30d);

  res.json(result);
});

// ── Alerts management ─────────────────────────────────────────────────────────
const alertsFile = path.join(__dirname, 'data', 'alerts.json');
function loadAlerts() { try { return JSON.parse(fs.readFileSync(alertsFile, 'utf-8')); } catch { return []; } }
function saveAlerts(alerts) { fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2)); }

app.get('/api/alerts/rules', (req, res) => res.json(loadAlerts()));
app.post('/api/alerts/rules', (req, res) => {
  const alerts = loadAlerts();
  const rule = { id: uuidv4(), name: req.body.name || '未命名规则', type: req.body.type || 'new_post', account_id: req.body.account_id || null, platform: req.body.platform || null, enabled: true, created_at: new Date().toISOString() };
  alerts.push(rule);
  saveAlerts(alerts);
  res.json(rule);
});
app.put('/api/alerts/rules/:id', (req, res) => {
  const alerts = loadAlerts();
  const idx = alerts.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '规则不存在' });
  alerts[idx] = { ...alerts[idx], ...req.body, id: req.params.id };
  saveAlerts(alerts);
  res.json(alerts[idx]);
});
app.delete('/api/alerts/rules/:id', (req, res) => {
  const alerts = loadAlerts().filter(a => a.id !== req.params.id);
  saveAlerts(alerts);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('\n🚀 社媒监控平台已启动');
  console.log(`📡 访问地址: ${url}\n`);
  initVapidKeys();
  startScheduler();
  setTimeout(() => {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}" 2>/dev/null || true`;
    exec(cmd, err => { if (err) console.log(`(自动打开失败，请手动访问 ${url})`); });
  }, 800);
});
