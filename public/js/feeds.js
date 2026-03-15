/* ═══════════════════════════════════════════════════
   Feeds — Social Feed Stream
   Scrollable draggable account tabs (like original v19)
   ═══════════════════════════════════════════════════ */

const Feeds = (() => {
  var _platformFilter = 'all';   // 'all' | 'youtube' | 'linkedin'
  var _accountFilter  = 'all';   // 'all' | account.id
  var _offset         = 0;
  var PAGE            = 20;
  var _tabSortable    = null;

  // ── Load ──────────────────────────────────────────────
  function load() {
    _offset = 0;
    var container = document.getElementById('feeds-list');
    renderSkeletons(container, 6, 'feed');
    rebuildAccountTabs(AppData.getAllAccounts(), AppData.getAllPosts());
    _renderPosts(true);
    _updateSubtitle();
  }

  // ── Account tab bar (scrollable + draggable) ──────────
  function rebuildAccountTabs(accounts, posts) {
    var bar = document.getElementById('account-tab-bar');
    if (!bar) return;

    if (_tabSortable) { try { _tabSortable.destroy(); } catch(e) {} _tabSortable = null; }

    var visible = _platformFilter === 'all'
      ? accounts
      : accounts.filter(function(a) { return a.platform === _platformFilter; });

    if (_accountFilter !== 'all' && !visible.find(function(a) { return String(a.id) === String(_accountFilter); })) {
      _accountFilter = 'all';
    }

    var html = '<button class="atab' + (_accountFilter === 'all' ? ' active' : '') +
      '" onclick="Feeds.setAccount(\'all\',this)" data-account-id="all"><span>全部</span></button>';

    visible.forEach(function(a) {
      var isYt     = a.platform === 'youtube';
      var cls      = isYt ? ' yt' : ' li';
      var isActive = String(_accountFilter) === String(a.id);
      var newCnt   = posts.filter(function(p) { return p.account_id === a.id && p.is_new; }).length;
      var newDot   = newCnt > 0 ? '<span class="atab-new"></span>' : '';
      var shortName = (a.name || '').replace(/\s*[|｜]\s*(LinkedIn|Twitter|Facebook|Instagram|YouTube)[^|]*$/i, '').trim().slice(0, 20);
      html += '<button class="atab' + cls + (isActive ? ' active' : '') +
        '" onclick="Feeds.setAccount(\'' + String(a.id) + '\',this)" data-account-id="' + String(a.id) + '">' +
        '<div class="atab-logo">' + platformIcon(a.platform, 16) + '</div>' +
        '<span>' + esc(shortName) + '</span>' + newDot +
        '</button>';
    });

    bar.innerHTML = html;
    _initDragScroll(bar);

    if (typeof Sortable !== 'undefined' && _platformFilter === 'all' && visible.length > 0) {
      _tabSortable = new Sortable(bar, {
        animation: 150,
        direction: 'horizontal',
        filter: '.atab[data-account-id="all"]',
        preventOnFilter: false,
        onEnd: function(evt) {
          var ids = Array.from(evt.to.children)
            .map(function(el) { return el.dataset.accountId; })
            .filter(function(id) { return id && id !== 'all'; });
          fetch('/api/accounts/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountIds: ids })
          }).then(function(r) { return r.json(); }).then(function(d) {
            toast(d.success ? '账号顺序已保存' : '保存顺序失败', d.success ? 'success' : 'error');
          }).catch(function() { toast('保存顺序失败', 'error'); });
        }
      });
    }
  }

  function _initDragScroll(el) {
    if (el._dragInit) return;
    el._dragInit = true;
    var isDown = false, startX, scrollLeft;
    el.addEventListener('mousedown', function(e) {
      isDown = true; el.classList.add('grabbing');
      startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft;
    });
    el.addEventListener('mouseleave', function() { isDown = false; el.classList.remove('grabbing'); });
    el.addEventListener('mouseup',    function() { isDown = false; el.classList.remove('grabbing'); });
    el.addEventListener('mousemove',  function(e) {
      if (!isDown) return; e.preventDefault();
      el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX) * 1.2;
    });
    el.addEventListener('touchstart', function(e) { startX = e.touches[0].pageX - el.offsetLeft; scrollLeft = el.scrollLeft; }, { passive: true });
    el.addEventListener('touchmove',  function(e) { el.scrollLeft = scrollLeft - (e.touches[0].pageX - el.offsetLeft - startX) * 1.2; }, { passive: true });
  }

  // ── Tab setters ───────────────────────────────────────
  function setAccount(accountId, btn) {
    _accountFilter = accountId;
    document.querySelectorAll('#account-tab-bar .atab').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    _offset = 0;
    _renderPosts(true);
    _updateSubtitle();
  }

  window.setFeedPlatform = function(platform, el) {
    _platformFilter = platform;
    _accountFilter  = 'all';
    _offset = 0;
    document.querySelectorAll('#feeds-platform-bar .filter-chip, .feeds-chips .filter-chip').forEach(function(c) { c.classList.remove('active'); });
    if (el) el.classList.add('active');
    rebuildAccountTabs(AppData.getAllAccounts(), AppData.getAllPosts());
    _renderPosts(true);
    _updateSubtitle();
  };

  window.renderFeeds = function() {
    _offset = 0;
    _renderPosts(true);
  };

  // ── Post rendering ─────────────────────────────────────
  // Fix 2 & 4: Always fetch a large batch and do all filtering+sorting client-side.
  // This ensures:
  //   - Platform filter + "全部账号" correctly shows posts (fix 2)
  //   - Time sort ignores platform/account filter context (fix 4)
  async function _renderPosts(reset) {
    if (reset) _offset = 0;

    var sort = (document.getElementById('feeds-sort') || {}).value || 'newest';
    var container = document.getElementById('feeds-list');

    // Fetch a large pool — always without server-side filters when sorting by time
    // so we can show the true newest/oldest regardless of platform
    var fetchParams = '?limit=500&offset=0';
    // Only add server-side account filter to narrow results when a specific account is selected
    // Never send platform filter for time sorts — client handles it
    if (_accountFilter !== 'all') {
      fetchParams += '&account_id=' + encodeURIComponent(_accountFilter);
    }

    var allPosts = await App.api.GET('/posts' + fetchParams) || [];

    // Client-side platform filter (fix 2 — ensures "全部" tab on youtube platform shows all youtube posts)
    var posts = allPosts;
    if (_platformFilter !== 'all') {
      posts = posts.filter(function(p) { return p.platform === _platformFilter; });
    }
    // Account filter (when specific account tab selected)
    if (_accountFilter !== 'all') {
      posts = posts.filter(function(p) { return String(p.account_id) === String(_accountFilter); });
    }

    // Sort (fix 4: purely by time when newest/oldest — not grouped by platform/account)
    if (sort === 'newest') {
      posts = posts.slice().sort(function(a, b) {
        return new Date(b.published_at || 0) - new Date(a.published_at || 0);
      });
    } else if (sort === 'oldest') {
      posts = posts.slice().sort(function(a, b) {
        return new Date(a.published_at || 0) - new Date(b.published_at || 0);
      });
    } else if (sort === 'platform') {
      posts = posts.slice().sort(function(a, b) { return a.platform.localeCompare(b.platform); });
    }

    if (reset) container.innerHTML = '';

    if (!posts.length && reset) {
      container.innerHTML =
        '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/>' +
        '<circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/></svg>' +
        '<h3>暂无动态</h3><p>添加竞品账号后，动态将显示在这里</p></div>';
      document.getElementById('feeds-load-more').classList.add('hidden');
      _updateSubtitle();
      return;
    }

    // Paginate from _offset
    var page = posts.slice(_offset, _offset + PAGE);
    var hasMore = posts.length > _offset + PAGE;

    page.forEach(function(p) { container.insertAdjacentHTML('beforeend', _card(p)); });

    var loadMoreEl = document.getElementById('feeds-load-more');
    if (hasMore) {
      loadMoreEl.classList.remove('hidden');
      _offset += PAGE;
      // Store full sorted array for load-more
      loadMoreEl._posts = posts;
      loadMoreEl._offset = _offset;
    } else {
      loadMoreEl.classList.add('hidden');
    }
    _updateSubtitle();
  }

  window.loadMoreFeeds = function() {
    var loadMoreEl = document.getElementById('feeds-load-more');
    if (loadMoreEl._posts) {
      var container = document.getElementById('feeds-list');
      var offset    = loadMoreEl._offset || _offset;
      var posts     = loadMoreEl._posts;
      var page      = posts.slice(offset, offset + PAGE);
      var hasMore   = posts.length > offset + PAGE;
      page.forEach(function(p) { container.insertAdjacentHTML('beforeend', _card(p)); });
      if (hasMore) {
        loadMoreEl._offset = offset + PAGE;
      } else {
        loadMoreEl.classList.add('hidden');
      }
      _updateSubtitle();
    } else {
      _renderPosts(false);
    }
  };

  // ── Feed card ─────────────────────────────────────────
  function _card(p) {
    var isNew = p.is_new;
    var kws   = _keywords(p.title + ' ' + (p.content || '')).slice(0, 3);

    var avatarInner;
    if (p.account_avatar) {
      avatarInner =
        '<img src="' + esc(p.account_avatar) + '" ' +
        'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-img\')" ' +
        'style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' +
        '<span style="display:none;width:100%;height:100%;align-items:center;justify-content:center" class="plat-svg-fb">' +
        platformIcon(p.platform, 22) + '</span>';
    } else {
      avatarInner = platformIcon(p.platform, 22);
    }

    var kgHtml = kws.map(function(k) { return '<span class="feed-tag">' + esc(k) + '</span>'; }).join('');
    var linkHtml = p.url
      ? '<a class="feed-link" href="' + esc(p.url) + '" target="_blank" onclick="event.stopPropagation()">' +
        '查看原文 <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
        '<polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>'
      : '';

    return '<div class="feed-card' + (isNew ? ' is-new' : '') + '" data-post-id="' + esc(p.id) + '" ' +
      'onclick="Feeds.openPost(\'' + esc(p.url || '') + '\',\'' + esc(p.id) + '\')">' +
      '<div class="feed-avatar' + (p.account_avatar ? ' has-img' : '') + '">' + avatarInner + '</div>' +
      '<div class="feed-body">' +
        '<div class="feed-header">' +
          platformBadge(p.platform) +
          '<span class="feed-author">' + esc(p.account_name || '未知账号') + '</span>' +
          (isNew ? '<span class="badge badge-new">NEW</span>' : '') +
          '<span class="feed-time">' + relTime(p.published_at) + '</span>' +
        '</div>' +
        '<div class="feed-title">' + esc(p.title || '（无标题）') + '</div>' +
        (p.content && p.content !== p.title
          ? '<div class="feed-content">' + esc(p.content.slice(0, 200)) + '</div>' : '') +
        '<div class="feed-footer">' + kgHtml + linkHtml + '</div>' +
      '</div>' +
      (p.thumbnail
        ? '<div class="feed-thumb"><img src="' + esc(p.thumbnail) + '" onerror="this.parentNode.style.display=\'none\'"></div>'
        : '') +
    '</div>';
  }

  function openPost(url, postId) {
    if (postId) {
      App.api.PUT('/posts/' + postId + '/read', {});
      var card = document.querySelector('[data-post-id="' + postId + '"]');
      if (card) card.classList.remove('is-new');
    }
    if (url && url !== 'undefined' && url !== '') window.open(url, '_blank');
  }

  // ── Keyword extractor ─────────────────────────────────
  function _keywords(text) {
    if (!text) return [];
    var stop = new Set(['the','a','an','and','or','in','on','at','to','of','is','are','was','were',
      'it','this','that','for','with','by','as','from','you','our','your','we','we\'re',
      '你','我','他','她','的','了','是','在','有','也','都','到','这','那']);
    return Array.from(new Set(
      text.split(/[\s,，。！？、：；""''【】《》().\-_|]+/)
        .map(function(w) { return w.toLowerCase().trim(); })
        .filter(function(w) { return w.length > 2 && !stop.has(w) && !/^\d+$/.test(w); })
    )).slice(0, 5);
  }

  function _updateSubtitle() {
    var el = document.getElementById('feeds-subtitle');
    if (!el) return;
    var pLabel = _platformFilter === 'all' ? '所有平台' : (_platformFilter === 'youtube' ? 'YouTube' : 'LinkedIn');
    var cards  = document.querySelectorAll('#feeds-list .feed-card').length;
    el.textContent = pLabel + (_accountFilter !== 'all' ? ' · 已筛选' : '') + ' · 显示 ' + cards + ' 条动态';
  }

  return { load, rebuildAccountTabs, setAccount, openPost };
})();
