/* ═══════════════════════════════════════════════════
   App Core — Router · API · Theme · SSE · Utils
   ═══════════════════════════════════════════════════ */

const App = (() => {
  let currentView = 'dashboard';
  let allPosts = [];
  let allAccounts = [];

  // ── API wrapper ──────────────────────────────────────
  async function api(method, path, body) {
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch('/api' + path, opts);
      return await res.json();
    } catch (e) {
      console.error('[API]', path, e);
      return { error: e.message };
    }
  }
  const GET  = (p)    => api('GET', p);
  const POST = (p, b) => api('POST', p, b);
  const PUT  = (p, b) => api('PUT', p, b);
  const DEL  = (p, b) => api('DELETE', p, b);

  // ═══ PLATFORM LOGOS (official SVG per user spec) ══════
  const YT_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8z" fill="#FF0000"/><polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02" fill="#fff"/></svg>`;
  const LI_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#0077B5"/><path d="M6.5 10h2v7.5h-2zM7.5 9a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 7.5 9zM10.5 10h1.9v1s.6-1 2.1-1c1.8 0 3 1.1 3 3.4v4.1h-2v-3.8c0-1-.4-1.7-1.3-1.7-.9 0-1.7.6-1.7 1.8v3.7h-2z" fill="#fff"/></svg>`;

  window.platformIcon = function(platform, size) {
    const s = size || 18;
    return (platform === 'youtube' ? YT_SVG : LI_SVG).replace('<svg ', '<svg width="' + s + '" height="' + s + '" ');
  };
  window.platformBadge = function(p) {
    if (p === 'youtube')  return '<span class="badge badge-youtube">'  + platformIcon('youtube',  12) + ' YouTube</span>';
    if (p === 'linkedin') return '<span class="badge badge-linkedin">' + platformIcon('linkedin', 12) + ' LinkedIn</span>';
    return '<span class="badge">' + esc(p) + '</span>';
  };

  // ── Toast ─────────────────────────────────────────────
  function toast(msg, type, duration) {
    type     = type     || 'info';
    duration = duration || 3500;
    const icons = {
      success: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
      error:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      warning: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = '<div class="toast-icon">' + (icons[type]||icons.info) + '</div><div class="toast-msg">' + msg + '</div>';
    document.getElementById('toast-container').appendChild(el);
    setTimeout(function() { el.classList.add('out'); setTimeout(function() { el.remove(); }, 250); }, duration);
  }
  window.toast = toast;

  // ── Theme ──────────────────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem('orbital-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
  }
  window.toggleTheme = function() {
    const cur  = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('orbital-theme', next);
    updateThemeIcon(next);
  };
  function updateThemeIcon(theme) {
    const d = document.getElementById('theme-icon-dark');
    const l = document.getElementById('theme-icon-light');
    if (d) d.style.display = theme === 'dark'  ? 'block' : 'none';
    if (l) l.style.display = theme === 'light' ? 'block' : 'none';
  }

  // ── Navigation ─────────────────────────────────────────
  window.navigate = function(view) {
    document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var viewEl = document.getElementById('view-' + view);
    if (viewEl) viewEl.classList.add('active');
    var navEl = document.querySelector('.nav-item[data-view="' + view + '"]');
    if (navEl) navEl.classList.add('active');
    currentView = view;
    window.location.hash = view;
    switch (view) {
      case 'dashboard':  Dashboard.load();   break;
      case 'feeds':      Feeds.load();       break;
      case 'monitoring': Monitoring.load();  break;
      case 'analytics':  Analytics.load();   break;
      case 'alerts':     Alerts.load();      break;
      case 'settings':   Settings.load();    break;
    }
  };
  window.toggleNav = function() {
    document.getElementById('app-layout').classList.toggle('nav-collapsed');
  };

  // ── Modal ──────────────────────────────────────────────
  window.openModal = function(id) {
    document.getElementById(id).classList.add('open');
    if (id === 'modal-ai') _loadAIModal();
  };
  window.closeModal = function(id) {
    document.getElementById(id).classList.remove('open');
  };
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
  });

  // ── Add Account ────────────────────────────────────────
  window.onPlatformChange = function() {
    var p    = document.getElementById('add-platform').value;
    var liG  = document.getElementById('linkedin-rss-group');
    var hint = document.getElementById('url-hint');
    var urlEl = document.getElementById('add-url');
    if (p === 'linkedin') {
      liG.classList.remove('hidden');
      hint.textContent = '粘贴 LinkedIn 个人或公司主页 URL';
      urlEl.placeholder = 'https://www.linkedin.com/in/username';
    } else {
      liG.classList.add('hidden');
      hint.textContent = '粘贴 YouTube 频道主页 URL';
      urlEl.placeholder = 'https://www.youtube.com/@channelname';
    }
  };

  window.submitAddAccount = async function() {
    var platform      = document.getElementById('add-platform').value;
    var url           = document.getElementById('add-url').value.trim();
    var rss_url       = document.getElementById('add-rss-url').value.trim();
    var display_count = document.getElementById('add-display-count').value;
    var msgEl         = document.getElementById('add-account-msg');
    var btn           = document.getElementById('btn-add-account-submit');
    if (!url) { toast('请输入账号 URL', 'warning'); return; }
    btn.disabled = true;
    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 解析中…';
    msgEl.className = 'text-sm hidden';
    var data = await POST('/accounts', { platform, url, rss_url, display_count });
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 添加账号';
    if (data.error) {
      msgEl.className = 'text-sm';
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = '❌ ' + data.error;
      toast(data.error, 'error');
    } else {
      closeModal('modal-add-account');
      toast('✅ 已添加 ' + (data.account && data.account.name ? data.account.name : '账号'), 'success');
      document.getElementById('add-url').value = '';
      document.getElementById('add-rss-url').value = '';
      msgEl.className = 'text-sm hidden';
      await refreshData();
      navigate('monitoring');
    }
  };

  // ── Check All ──────────────────────────────────────────
  window.triggerCheckAll = async function() {
    var btn = document.getElementById('btn-check-all');
    btn.classList.add('loading');
    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>检查中…</span>';
    toast('开始检查所有账号…', 'info');
    await POST('/check-all', {});
    setTimeout(async function() {
      btn.classList.remove('loading');
      btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.63"/></svg><span>立即检查</span>';
      await refreshData();
      if (currentView === 'feeds')      Feeds.load();
      if (currentView === 'monitoring') Monitoring.load();
      if (currentView === 'dashboard')  Dashboard.load();
    }, 3000);
  };

  // ── Mark all read ──────────────────────────────────────
  window.markAllRead = async function() {
    await PUT('/posts/mark-all-read', {});
    await PUT('/notifications/read-all', {});
    toast('已标记全部已读', 'success');
    await refreshData();
    Feeds.load();
    updateBadges();
  };

  // ── Global Search ──────────────────────────────────────
  var _searchTimer;
  window.onSearchInput = function(e) {
    clearTimeout(_searchTimer);
    var q = e.target.value.trim();
    if (!q) { document.getElementById('search-results').classList.remove('open'); return; }
    _searchTimer = setTimeout(function() { _doSearch(q); }, 250);
  };
  window.onSearchFocus = function() {
    var q = document.getElementById('global-search').value.trim();
    if (q) document.getElementById('search-results').classList.add('open');
  };
  window.onSearchBlur = function() {
    setTimeout(function() { document.getElementById('search-results').classList.remove('open'); }, 200);
  };

  async function _doSearch(q) {
    var data = await GET('/search?q=' + encodeURIComponent(q));
    var el   = document.getElementById('search-results');
    if (!data || (!data.accounts || !data.accounts.length) && (!data.posts || !data.posts.length)) {
      el.innerHTML = '<div class="search-empty">未找到相关结果</div>';
      el.classList.add('open');
      return;
    }
    var html = '';
    if (data.accounts && data.accounts.length) {
      html += '<div class="search-section"><div class="search-section-label">账号</div>';
      data.accounts.forEach(function(a) {
        html += '<div class="search-result-item" onclick="navigate(\'monitoring\')">' +
          '<div class="search-result-icon">' + platformIcon(a.platform, 22) + '</div>' +
          '<div class="search-result-info"><div class="search-result-name">' + esc(a.name) + '</div>' +
          '<div class="search-result-meta">' + (a.platform === 'youtube' ? 'YouTube' : 'LinkedIn') + '</div>' +
          '</div></div>';
      });
      html += '</div>';
    }
    if (data.posts && data.posts.length) {
      html += '<div class="search-section"><div class="search-section-label">动态</div>';
      data.posts.forEach(function(p) {
        html += '<div class="search-result-item" onclick="window.open(\'' + esc(p.url) + '\',\'_blank\')">' +
          '<div class="search-result-icon">' + platformIcon(p.platform, 22) + '</div>' +
          '<div class="search-result-info"><div class="search-result-name">' + esc((p.title||'').slice(0,60)) + '</div>' +
          '<div class="search-result-meta">' + esc(p.account_name||'') + ' · ' + relTime(p.published_at) + '</div>' +
          '</div></div>';
      });
      html += '</div>';
    }
    el.innerHTML = html;
    el.classList.add('open');
  }

  // ── SSE ────────────────────────────────────────────────
  function initSSE() {
    var es = new EventSource('/api/sse');
    es.addEventListener('connected', function() {
      var dot  = document.getElementById('status-dot');
      var txt  = document.getElementById('status-text');
      var live = document.getElementById('live-indicator');
      if (dot)  dot.classList.remove('inactive');
      if (txt)  txt.textContent = '实时连接已建立';
      if (live) live.classList.remove('hidden');
    });
    es.addEventListener('posts_updated', function() {
      toast('📡 检测到新动态', 'info');
      refreshData().then(function() {
        if (currentView === 'feeds')     Feeds.load();
        if (currentView === 'dashboard') Dashboard.load();
      });
    });
    es.addEventListener('check_complete', function() {
      refreshData().then(function() {
        toast('✅ 检查完成', 'success');
        if (currentView === 'feeds')     Feeds.load();
        if (currentView === 'dashboard') Dashboard.load();
      });
    });
    es.addEventListener('account_added', function(e) {
      var d = JSON.parse(e.data);
      toast('已添加 ' + d.name, 'success');
    });
    es.addEventListener('ai_analysis_done', function() { toast('🤖 AI 分析完成', 'success'); });
    es.onerror = function() {
      var dot  = document.getElementById('status-dot');
      var txt  = document.getElementById('status-text');
      var live = document.getElementById('live-indicator');
      if (dot)  dot.classList.add('inactive');
      if (txt)  txt.textContent = '连接断开，自动重试…';
      if (live) live.classList.add('hidden');
    };
  }

  // ── Refresh data ───────────────────────────────────────
  async function refreshData() {
    var results = await Promise.all([GET('/accounts'), GET('/posts?limit=300')]);
    allAccounts = results[0] || [];
    allPosts    = results[1] || [];
    updateBadges();
    if (window.Feeds && Feeds.rebuildAccountTabs) Feeds.rebuildAccountTabs(allAccounts, allPosts);
    var sel = document.getElementById('ai-account');
    if (sel) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">所有账号（跨账号分析）</option>' +
        allAccounts.map(function(a) { return '<option value="' + a.id + '"' + (a.id===cur?' selected':'') + '>' + esc(a.name) + '</option>'; }).join('');
    }
    return { accounts: allAccounts, posts: allPosts };
  }

  function updateBadges() {
    var newCount = allPosts.filter(function(p) { return p.is_new; }).length;
    var badge = document.getElementById('nav-new-badge');
    if (badge) { badge.textContent = newCount; badge.style.display = newCount > 0 ? 'flex' : 'none'; }
    GET('/notifications/unread-count').then(function(d) {
      var cnt = (d && d.count) ? d.count : 0;
      var ab  = document.getElementById('nav-alert-badge');
      var dot = document.getElementById('topbar-notif-dot');
      if (ab)  { ab.textContent = cnt; ab.style.display = cnt > 0 ? 'flex' : 'none'; }
      if (dot) dot.classList.toggle('hidden', cnt === 0);
    });
  }

  // ── AI Modal ───────────────────────────────────────────
  function _loadAIModal() {
    var sel = document.getElementById('ai-account');
    if (sel) {
      sel.innerHTML = '<option value="">所有账号（跨账号分析）</option>' +
        allAccounts.map(function(a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('');
    }
    document.getElementById('ai-result-area').classList.add('hidden');
    document.getElementById('ai-result-content').textContent = '';
    var btn = document.getElementById('btn-ai-submit');
    if (btn) { btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 开始分析'; btn.disabled = false; }
  }

  window.submitAIAnalysis = async function() {
    var mode          = document.getElementById('ai-mode').value;
    var account_id    = document.getElementById('ai-account').value;
    var count         = parseInt(document.getElementById('ai-count').value);
    var custom_prompt = document.getElementById('ai-prompt').value;
    var btn           = document.getElementById('btn-ai-submit');
    btn.disabled = true;
    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> AI 分析中…';
    var body = account_id ? { account_id, mode, limit: count, custom_prompt } : { mode: 'cross', custom_prompt };
    var result = await POST('/ai/analyze', body);
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 重新分析';
    if (result.success) {
      document.getElementById('ai-result-area').classList.remove('hidden');
      document.getElementById('ai-result-content').textContent = result.result;
      toast('AI 分析完成', 'success');
    } else {
      toast(result.error || 'AI 分析失败', 'error');
    }
  };

  // ── Tabs ───────────────────────────────────────────────
  window.switchTab = function(tabId, el) {
    document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    var tab = document.getElementById(tabId);
    if (tab) tab.classList.add('active');
    el.classList.add('active');
  };

  // ── Skeleton ────────────────────────────────────────────
  window.renderSkeletons = function(container, count, type) {
    count = count || 5; type = type || 'feed';
    container.innerHTML = Array.from({ length: count }, function() {
      if (type === 'feed') return '<div class="feed-card" style="pointer-events:none"><div class="skeleton" style="width:40px;height:40px;border-radius:10px;flex-shrink:0"></div><div style="flex:1"><div class="skeleton" style="height:14px;width:60%;margin-bottom:8px;border-radius:4px"></div><div class="skeleton" style="height:12px;width:90%;margin-bottom:6px;border-radius:4px"></div><div class="skeleton" style="height:12px;width:75%;border-radius:4px"></div></div></div>';
      return '<div class="skeleton" style="height:48px;border-radius:8px;margin-bottom:8px"></div>';
    }).join('');
  };

  // ── Utilities ──────────────────────────────────────────
  window.esc = function(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };
  window.relTime = function(dateStr) {
    if (!dateStr) return '未知时间';
    var diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff/60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff/3600) + ' 小时前';
    if (diff < 2592000) return Math.floor(diff/86400) + ' 天前';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };
  window.formatNum = function(n) {
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return String(n);
  };

  window.AppData = {
    getAllPosts:    function() { return allPosts;    },
    getAllAccounts: function() { return allAccounts; },
  };

  async function init() {
    initTheme();
    await refreshData();
    initSSE();
    var hash = window.location.hash.replace('#','') || 'dashboard';
    navigate(hash);
    setInterval(function() { refreshData(); }, 120000);
  }

  return { init, api: { GET, POST, PUT, DEL }, refreshData };
})();
