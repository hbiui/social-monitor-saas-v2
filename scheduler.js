const cron    = require('node-cron');
const db      = require('./db');
const path    = require('path');
const fs      = require('fs');
const { fetchYouTube }          = require('./fetchers/youtube');
const { checkLinkedInUpdates }  = require('./fetchers/linkedin');
const { notifyNewPost, getSettings, sendNotification } = require('./notifications');
const { v4: uuidv4 } = require('uuid');

let cronJob = null;

// ── Auto-job tracking (in-memory list of running ppt jobs started by scheduler) ──
const _autoJobs = new Map();  // jobId → { label, type:'analyze'|'ppt', status, created_at }
function registerAutoJob(jobId, label, type) {
  _autoJobs.set(jobId, { job_id: jobId, label, type, status:'running', created_at: Date.now() });
}
function finishAutoJob(jobId) {
  _autoJobs.delete(jobId);
}
function getRunningAutoJobs() {
  return [..._autoJobs.values()].filter(j => Date.now() - j.created_at < 30*60*1000);
}

// ── Auto AI analysis for a set of posts belonging to one account ──────────────
async function runAutoAnalyze(account, newPosts, settings) {
  const { analyzeWithAI } = require('./ai');
  const apiProvider = settings.ai_provider || 'doubao';
  const postIds     = newPosts.map(p => p.id).slice(0, 10);
  const mode        = settings.auto_analyze_mode || 'multi';

  console.log(`🤖 自动AI分析: ${account.name} (${postIds.length}条)`);

  const allPosts = db.getPostsByIds(postIds);
  if (!allPosts.length) return null;

  let result;
  try {
    const finalMode = allPosts.length === 1 ? 'single' : mode;
    const analysisResult = await analyzeWithAI(allPosts, finalMode, '', apiProvider);
    if (!analysisResult.success) throw new Error(analysisResult.error || '分析失败');
    result = analysisResult;
  } catch(e) {
    console.error(`❌ 自动AI分析失败: ${e.message}`);
    return null;
  }

  // Save to AI history
  const histId = uuidv4();
  const accountNames = [...new Set(allPosts.map(p => {
    const acc = db.getAccount ? db.getAccount(p.account_id) : null;
    return acc ? acc.name : '';
  }).filter(Boolean))];

  db.insertAIHistory({
    id: histId,
    post_ids: postIds,
    mode: result.mode || mode,
    provider: result.provider || apiProvider,
    model: result.model || '',
    result: result.result,
    account_names: accountNames,
    auto_generated: true,
    created_at: new Date().toISOString(),
  });

  // Notify via all configured channels
  const notifContent = `🤖 自动AI分析完成：${account.name}\n\n${result.result.slice(0, 800)}${result.result.length > 800 ? '...' : ''}`;
  try {
    await sendNotification(notifContent, settings);
    console.log(`✅ AI分析通知已发送: ${account.name}`);
  } catch(e) {
    console.error(`⚠️ 发送AI分析通知失败: ${e.message}`);
  }

  return { result, histId, accountNames, mode: result.mode || mode };
}

// ── Auto PPT generation after analysis ────────────────────────────────────────
async function runAutoPPT(analyzeResult, account, settings) {
  const { spawn } = require('child_process');
  const { v4: uv4 } = require('uuid');

  const apiKey    = settings.doubao_api_key || '';
  if (!apiKey) { console.log('⏭️ 自动PPT: 未配置豆包API Key，跳过'); return; }

  const textModel = settings.doubao_model || 'doubao-seed-2-0-pro-260215';
  const jobId     = `ppt-${Date.now()}`;
  const filename  = `${jobId}.pptx`;

  // Determine output paths
  const PPT_DIR    = path.join(__dirname, 'public', 'ppt');
  const PPT_STATUS = path.join(__dirname, 'data', 'ppt_status');
  fs.mkdirSync(PPT_DIR,    { recursive: true });
  fs.mkdirSync(PPT_STATUS, { recursive: true });

  const outPath    = path.join(PPT_DIR, filename);
  const statusPath = path.join(PPT_STATUS, `${jobId}.json`);
  const jobPath    = path.join(PPT_STATUS, `${jobId}-job.json`);

  const modeLabel = { single:'单条分析', multi:'多条分析', cross:'跨账号分析' };
  const accNames  = analyzeResult.accountNames || [account.name];
  const title     = `${modeLabel[analyzeResult.mode]||'综合分析'}·${accNames.join('、')}`;

  const job = {
    job_id: jobId, status_path: statusPath, output_path: outPath,
    api_key: apiKey, proxy_url: settings.proxy_url || '',
    text_model: textModel, analysis_text: analyzeResult.result.result,
    title, subtitle: '', date: new Date().toLocaleDateString('zh-CN'),
    enable_images: true, mode: analyzeResult.mode, account_names: accNames,
  };
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));

  // Pre-insert PPT history
  const pptHistId = uv4();
  db.insertPPTHistory({
    id: pptHistId, job_id: jobId, title, subtitle: '', model: textModel,
    mode: analyzeResult.mode, account_names: accNames,
    status: 'running', filename, url: null, slide_count: 0, read: false,
    auto_generated: true,
  });

  console.log(`📊 自动PPT启动: ${title}`);
  registerAutoJob(jobId, `PPT: ${title.slice(0,30)}`, 'ppt');

  // Spawn Python pipeline
  const candidates = process.platform === 'win32' ? ['python','python3','py'] : ['python3','python'];
  const pythonScript = path.join(__dirname, 'ppt_pipeline.py');

  function tryPython(i) {
    if (i >= candidates.length) {
      console.error('❌ 自动PPT: 找不到Python命令');
      finishAutoJob(jobId);
      return;
    }
    const py = require('child_process').spawn(candidates[i], [pythonScript, jobPath], {
      detached: true, stdio: ['ignore','pipe','pipe'],
    });
    py.on('error', () => tryPython(i+1));
    py.stdout.on('data', d => {
      const line = d.toString().trim();
      if (line.startsWith('OK:')) {
        finishAutoJob(jobId);
        // Update history and send notification
        setTimeout(async () => {
          try {
            const statusData = JSON.parse(fs.readFileSync(statusPath,'utf-8'));
            db.updatePPTHistory(pptHistId, {
              status: 'done', url: statusData.url,
              slide_count: statusData.slide_count || 0,
              finished_at: new Date().toISOString(),
            });
            const dlUrl = `${settings.base_url || ''}${statusData.url || ''}`;
            await sendNotification(
              `📊 自动PPT生成完成：${title}\n🗂 ${statusData.slide_count||0}页\n⬇️ 下载链接：${dlUrl}`,
              settings
            );
            console.log(`✅ 自动PPT通知已发送: ${title}`);
          } catch(e) { console.error(`⚠️ 自动PPT通知失败: ${e.message}`); }
        }, 1000);
      }
    });
    py.stderr.on('data', d => process.stderr.write(d));
    py.unref();
  }
  tryPython(0);
}

// ── Main account checker ───────────────────────────────────────────────────────
async function checkAccount(account) {
  console.log(`🔍 检查账号: ${account.name} (${account.platform})`);
  const count = account.display_count || 10;

  try {
    let newPosts = [];

    if (account.platform === 'linkedin') {
      const result = await checkLinkedInUpdates(account);

      if (result.success && result.items && result.items.length > 0) {
        for (const item of result.items) {
          const postId = `linkedin-${item.id || item.url}`;
          if (!db.getPost(postId)) {
            db.insertPost({
              id: postId, account_id: account.id, platform: 'linkedin',
              title:   (item.title   || '').slice(0, 500),
              content: (item.content || '').slice(0, 2000),
              url: item.url, thumbnail: item.thumbnail || '',
              published_at: item.published_at || new Date().toISOString(),
              is_new: true,
            });
            newPosts.push({ ...item, id: postId });
          }
        }
        const latestId = `linkedin-${result.items[0].id || result.items[0].url}`;
        db.updateAccount(account.id, { last_checked: new Date().toISOString(), last_post_id: latestId });

        if (newPosts.length > 0 && account.last_post_id) {
          for (const post of newPosts.slice(0, 3)) {
            await notifyNewPost(account, post);
            await new Promise(r => setTimeout(r, 500));
          }
          console.log(`✅ ${account.name} 有 ${newPosts.length} 条新 LinkedIn 内容`);
        }
        // Auto-analyze trigger below
      } else if (result.success && result.hash) {
        const prevHash = account.last_post_id;
        db.updateAccount(account.id, { last_checked: new Date().toISOString(), last_post_id: result.hash });
        if (prevHash && prevHash !== result.hash) {
          const fakePost = {
            id: `linkedin-change-${Date.now()}`,
            title: `${account.name} LinkedIn页面有更新`,
            content: '检测到LinkedIn账号页面内容发生变化，请前往查看最新动态。',
            url: account.url,
            published_at: new Date().toISOString(),
          };
          await notifyNewPost(account, fakePost);
          db.insertPost({ id: fakePost.id, account_id: account.id, platform: 'linkedin',
            title: fakePost.title, content: fakePost.content, url: fakePost.url,
            published_at: fakePost.published_at, is_new: true });
        }
        return;
      } else {
        return;
      }

    } else if (account.platform === 'youtube') {
      const result = await fetchYouTube(account.url, count);
      if (!result || !result.success) { console.warn(`⚠️ ${account.name} 获取失败`); return; }

      for (const item of result.items) {
        const postId = `youtube-${item.id || item.url}`;
        if (!db.getPost(postId)) {
          db.insertPost({
            id: postId, account_id: account.id, platform: 'youtube',
            title: (item.title || '').slice(0, 500),
            content: (item.content || '').slice(0, 2000),
            url: item.url, thumbnail: item.thumbnail || '',
            published_at: item.published_at || new Date().toISOString(),
            is_new: true,
          });
          newPosts.push({ ...item, id: postId });
        }
      }

      const latestId = result.items[0] ? `youtube-${result.items[0].id || result.items[0].url}` : account.last_post_id;
      db.updateAccount(account.id, { last_checked: new Date().toISOString(), last_post_id: latestId });

      if (newPosts.length > 0 && account.last_post_id) {
        for (const post of newPosts.slice(0, 3)) {
          await notifyNewPost(account, post);
          await new Promise(r => setTimeout(r, 500));
        }
        console.log(`✅ ${account.name} 有 ${newPosts.length} 条新内容`);
      }
    }

    // ── Auto-analyze & auto-PPT ────────────────────────────────────────────────
    if (newPosts.length > 0 && account.last_post_id) {
      const settings = db.getAllSettings();
      if (settings.auto_analyze_enabled === 'true') {
        const mode = settings.auto_analyze_mode || 'multi';
        if (mode === 'unread_notifs') {
          // unread_notifs mode runs once globally, not per-account
          // It's triggered separately by runUnreadNotifsAnalysis
        } else {
          await new Promise(r => setTimeout(r, 2000));
          const analyzeResult = await runAutoAnalyze(account, newPosts, settings);
          if (analyzeResult && settings.auto_ppt_enabled === 'true') {
            await new Promise(r => setTimeout(r, 1000));
            await runAutoPPT(analyzeResult, account, settings);
          }
        }
      }
    }

  } catch (e) {
    console.error(`❌ 检查 ${account.name} 出错:`, e.message);
  }
}

// ── Unread notifications cross-account analysis ───────────────────────────────
async function runUnreadNotifsAnalysis(settings) {
  try {
    const notifs = db.getUnreadNotifications ? db.getUnreadNotifications() : [];
    if (!notifs || notifs.length === 0) {
      console.log('📭 无未读动态通知，跳过自动分析');
      return;
    }
    console.log(`🤖 未读通知分析: ${notifs.length} 条跨账号动态`);

    // Gather post IDs from notifications
    const postIds = [...new Set(notifs.map(n => n.post_id).filter(Boolean))].slice(0, 15);
    const allPosts = db.getPostsByIds(postIds);
    if (!allPosts.length) return;

    const { analyzeWithAI } = require('./ai');
    const provider = settings.ai_provider || 'doubao';
    const mode = allPosts.length === 1 ? 'single' : 'cross';
    const analysisResult = await analyzeWithAI(allPosts, mode, '', provider);
    if (!analysisResult.success) {
      console.error('❌ 未读通知AI分析失败:', analysisResult.error);
      return;
    }

    const { v4: uuidv4 } = require('uuid');
    const histId = uuidv4();
    const accountNames = [...new Set(allPosts.map(p => {
      const acc = db.getAccount ? db.getAccount(p.account_id) : null;
      return acc ? acc.name : '';
    }).filter(Boolean))];

    db.insertAIHistory({
      id: histId, post_ids: postIds, mode,
      provider: analysisResult.provider || provider,
      model: analysisResult.model || '',
      result: analysisResult.result, account_names: accountNames,
      auto_generated: true,
      created_at: new Date().toISOString(),
    });

    const { sendNotification } = require('./notifications');
    const notifContent = `🤖 未读动态综合分析完成（${accountNames.join('、')}）\n\n${analysisResult.result.slice(0,800)}${analysisResult.result.length>800?'...':''}`;
    await sendNotification(notifContent, settings).catch(e => console.error('⚠️', e.message));

    // Mark all analyzed notifications as read
    if (db.markNotificationsRead) db.markNotificationsRead(notifs.map(n => n.id));

    const r = { result: analysisResult, histId, accountNames, mode };

    if (settings.auto_ppt_enabled === 'true') {
      const fakeAccount = { name: accountNames.join('、'), id: 'cross' };
      await runAutoPPT(r, fakeAccount, settings).catch(e => console.error('⚠️ autoPPT:', e.message));
    }
  } catch(e) {
    console.error('❌ 未读通知分析失败:', e.message);
  }
}

async function runAllChecks() {
  const accounts = db.getAccounts(true);
  console.log(`\n🔄 开始检查 ${accounts.length} 个账号...`);
  for (const account of accounts) {
    await checkAccount(account);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Unread notifications cross-account analysis (runs after all accounts checked)
  const settings = db.getAllSettings();
  if (settings.auto_analyze_enabled === 'true' && settings.auto_analyze_mode === 'unread_notifs') {
    await runUnreadNotifsAnalysis(settings);
  }

  console.log('✅ 本轮检查完成\n');
}

function startScheduler() {
  const settings = getSettings();
  const interval = Math.max(5, parseInt(settings.check_interval) || 30);
  if (cronJob) { cronJob.stop(); cronJob = null; }
  const cronExpr = `*/${interval} * * * *`;
  console.log(`⏰ 监控定时器启动，每 ${interval} 分钟检查一次`);
  cronJob = cron.schedule(cronExpr, () => runAllChecks().catch(console.error));
  return cronJob;
}

function stopScheduler() {
  if (cronJob) { cronJob.stop(); cronJob = null; }
}

module.exports = { startScheduler, stopScheduler, runAllChecks, checkAccount, getRunningAutoJobs };
