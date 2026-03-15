const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const adapter = new FileSync(path.join(dataDir, 'monitor.json'));
const db = low(adapter);

db.defaults({
  accounts: [],
  posts: [],
  notifications: [],
  ai_history: [],
  ppt_history: [],
  push_subscriptions: [],
  settings: {
    check_interval: '30',
    default_display_count: '10',
    youtube_api_key: '',
    smtp_host: 'smtp.gmail.com',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    notify_email: '',
    vapid_public_key: '',
    vapid_private_key: '',
    vapid_email: 'mailto:admin@social-monitor.local',
    telegram_bot_token: '',
    telegram_chat_id: '',
    discord_webhook_url: '',
    proxy_url: '',
    // AI Analysis Settings
    ai_provider: 'openai',
    ai_system_prompt: '',
    ai_auto_notify: 'false',
    doubao_api_key: '',
    doubao_model: 'doubao-seed-2-0-pro-260215',
    zhipu_api_key: '',
    zhipu_model: 'glm-4-plus',
    gemini_api_key: '',
    gemini_model: 'gemini-2.0-flash',
    claude_api_key: '',
    claude_model: 'claude-sonnet-4-6',
    openai_api_key: '',
    openai_model: 'gpt-4o',
    openai_base_url: 'https://api.openai.com/v1',
  }
}).write();

// 确保新字段存在（升级兼容）
const settingsToAdd = {
  telegram_bot_token: '',
  telegram_chat_id: '',
  discord_webhook_url: '',
  proxy_url: '',
  ai_provider: 'openai',
  ai_system_prompt: '',
  ai_auto_notify: 'false',
  doubao_api_key: '', doubao_model: 'doubao-seed-2-0-pro-260215',
  zhipu_api_key: '', zhipu_model: 'glm-4-plus',
  gemini_api_key: '', gemini_model: 'gemini-2.0-flash',
  claude_api_key: '', claude_model: 'claude-sonnet-4-6',
  openai_api_key: '', openai_model: 'gpt-4o', openai_base_url: 'https://api.openai.com/v1',
};
for (const [k, v] of Object.entries(settingsToAdd)) {
  if (db.get('settings.' + k).value() === undefined) {
    db.set('settings.' + k, v).write();
  }
}

// 迁移：给旧账号补充 rss_url 和 sort_order 字段
db.get('accounts').forEach((acc, index) => {
  if (acc.rss_url === undefined) acc.rss_url = '';
  if (acc.sort_order === undefined) acc.sort_order = index; // 按现有顺序赋初始值
}).write();

// ========== 辅助函数 ==========
function getNextSortOrder() {
  const accounts = db.get('accounts').value();
  if (accounts.length === 0) return 0;
  const max = Math.max(...accounts.map(a => a.sort_order || 0));
  return max + 1;
}

function reorderAccounts(accountIds) {
  const accounts = db.get('accounts').value();
  const accountMap = new Map(accounts.map(a => [a.id, a]));

  // 过滤出有效的账号ID
  const validIds = accountIds.filter(id => accountMap.has(id));

  // 其他账号（不在传入列表中的）按原 sort_order 升序排列
  const otherAccounts = accounts.filter(a => !validIds.includes(a.id));
  otherAccounts.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // 重新组合：传入的ID按新顺序 + 其他账号保持原相对顺序
  const reordered = [
    ...validIds.map(id => accountMap.get(id)),
    ...otherAccounts
  ];

  // 重新赋值 sort_order
  reordered.forEach((acc, idx) => {
    acc.sort_order = idx;
  });

  db.write();
}

// ========== 数据库操作 ==========
const dbHelper = {
  getSetting(key) { return db.get('settings.' + key).value(); },
  setSetting(key, value) { db.set('settings.' + key, value).write(); },
  getAllSettings() { return db.get('settings').value() || {}; },

  getAccounts(enabledOnly = false) {
    let q = db.get('accounts');
    if (enabledOnly) q = q.filter({ enabled: true });
    return q.orderBy(['sort_order', 'created_at'], ['asc', 'desc']).value();
  },
  getAccount(id) { return db.get('accounts').find({ id }).value(); },
  getAccountByPlatformAndAccountId(platform, account_id) {
    return db.get('accounts').find({ platform, account_id }).value();
  },
  insertAccount(data) {
    const sort_order = getNextSortOrder();
    db.get('accounts').push({ ...data, sort_order, created_at: new Date().toISOString() }).write();
  },
  updateAccount(id, updates) {
    db.get('accounts').find({ id }).assign(updates).write();
  },
  deleteAccount(id) { db.get('accounts').remove({ id }).write(); },

  // 批量更新账号顺序
  reorderAccounts,

  getPosts({ account_id, limit = 20, offset = 0 } = {}) {
    let q = db.get('posts');
    if (account_id) q = q.filter({ account_id });
    const all = q.orderBy('published_at', 'desc').value();
    const accMap = {};
    db.get('accounts').value().forEach(a => accMap[a.id] = a);
    return all.slice(offset, offset + limit).map(p => ({
      ...p,
      account_name: accMap[p.account_id]?.name || '',
      account_avatar: accMap[p.account_id]?.avatar || '',
    }));
  },
  getPost(id) { return db.get('posts').find({ id }).value(); },
  getPostsByIds(ids) { return db.get('posts').filter(p => ids.includes(p.id)).value(); },
  insertPost(data) {
    if (this.getPost(data.id)) return;
    db.get('posts').push({ ...data, fetched_at: new Date().toISOString() }).write();
  },
  updatePost(id, updates) { db.get('posts').find({ id }).assign(updates).write(); },
  deletePosts(account_id) { db.get('posts').remove({ account_id }).write(); },

  getNotifications(limit = 200) {
    const accMap = {};
    db.get('accounts').value().forEach(a => accMap[a.id] = a);
    const postMap = {};
    db.get('posts').value().forEach(p => postMap[p.id] = p);
    return db.get('notifications').orderBy('created_at', 'desc').take(limit).value()
      .map(n => {
        const acc = accMap[n.account_id] || {};
        const post = n.post_id ? (postMap[n.post_id] || {}) : {};
        // url: stored url first, then fall back to post lookup
        // url priority: stored url → post.url → account.url (fallback for old notifications)
        const url = (n.url && n.url.startsWith('http')) ? n.url
                  : (post.url && post.url.startsWith('http')) ? post.url
                  : (acc.url && acc.url.startsWith('http')) ? acc.url
                  : '';
        return {
          ...n,
          url,
          account_name: n.account_name || acc.name || '',
          platform: n.platform || acc.platform || post.platform || '',
        };
      });
  },
  insertNotification(data) {
    if (db.get('notifications').find({ id: data.id }).value()) return;
    db.get('notifications').push({ ...data, created_at: new Date().toISOString() }).write();
  },
  deleteNotificationsByAccount(account_id) { db.get('notifications').remove({ account_id }).write(); },
  markAllNotificationsRead() { db.get('notifications').each(n => { n.read = true; }).write(); },
  markNotificationRead(id, read) { db.get('notifications').find({ id }).assign({ read: !!read }).write(); },
  getUnreadNotifications(limit = 50) {
    return db.get('notifications').filter({ read: false }).orderBy('created_at','desc').take(limit).value();
  },
  markNotificationsRead(ids) {
    if (!ids || !ids.length) return;
    ids.forEach(id => db.get('notifications').find({ id }).assign({ read: true }).write());
  },
  deleteNotification(id) { db.get('notifications').remove({ id }).write(); },
  deleteNotificationsBulk(ids) { db.get('notifications').remove(n => ids.includes(n.id)).write(); },
  getUnreadNotifCount() { return db.get('notifications').filter({ read: false }).size().value(); },
  markAllPostsRead() { db.get('posts').each(p => { p.is_new = false; }).write(); },
  // AI History
  getAIHistory(limit = 100) {
    return db.get('ai_history').orderBy('created_at', 'desc').take(limit).value();
  },
  insertAIHistory(data) {
    db.get('ai_history').push({ ...data, created_at: new Date().toISOString() }).write();
  },
  deleteAIHistory(id) { db.get('ai_history').remove({ id }).write(); },
  deleteAIHistoryBulk(ids) { db.get('ai_history').remove(r => ids.includes(r.id)).write(); },
  clearAIHistory() { db.set('ai_history', []).write(); },

  // PPT History
  getPPTHistory(limit = 200) {
    return db.get('ppt_history').orderBy('created_at', 'desc').take(limit).value();
  },
  insertPPTHistory(data) {
    db.get('ppt_history').push({ ...data, created_at: new Date().toISOString() }).write();
  },
  updatePPTHistory(id, patch) {
    db.get('ppt_history').find({ id }).assign(patch).write();
  },
  deletePPTHistory(id) { db.get('ppt_history').remove({ id }).write(); },
  deletePPTHistoryBulk(ids) { db.get('ppt_history').remove(r => ids.includes(r.id)).write(); },
  clearPPTHistory() { db.set('ppt_history', []).write(); },

  getPushSubscriptions() { return db.get('push_subscriptions').value(); },
  insertPushSubscription(data) { db.get('push_subscriptions').push(data).write(); },
  deletePushSubscription(id) { db.get('push_subscriptions').remove({ id }).write(); },
  deletePushSubscriptionByEndpoint(endpoint) {
    db.get('push_subscriptions').remove(sub => {
      try { return JSON.parse(sub.subscription).endpoint === endpoint; } catch { return false; }
    }).write();
  },

  getStats() {
    return {
      totalAccounts: db.get('accounts').filter({ enabled: true }).size().value(),
      totalPosts: db.get('posts').size().value(),
      newPosts: db.get('posts').filter({ is_new: true }).size().value(),
      unreadNotifs: db.get('notifications').filter({ read: false }).size().value(),
    };
  }
};

module.exports = dbHelper;