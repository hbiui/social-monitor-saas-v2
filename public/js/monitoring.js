/* ═══════════════════════════════════════════════════
   Monitoring — Competitor Account Management
   ═══════════════════════════════════════════════════ */

const Monitoring = (() => {

  async function load() {
    const tbody = document.getElementById('monitoring-table-body');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted)">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 8px;display:block;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>加载中…</td></tr>`;

    const [accounts, activity] = await Promise.all([
      App.api.GET('/accounts'),
      App.api.GET('/analytics/accounts-activity'),
    ]);

    const actMap = {};
    (activity || []).forEach(a => { actMap[a.id] = a; });

    if (!accounts?.length) {
      tbody.innerHTML = `<tr><td colspan="6">
        <div class="empty-state" style="padding:48px">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          <h3>暂无监控账号</h3>
          <p>点击「添加账号」开始监控竞品</p>
        </div></td></tr>`;
      return;
    }

    tbody.innerHTML = accounts.map(a => {
      const act = actMap[a.id] || {};
      const lastCheck = a.last_checked ? relTime(a.last_checked) : '从未';
      const enabled = a.enabled !== false;
      return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="account-avatar" style="width:36px;height:36px;border-radius:9px;background:${a.platform==='youtube'?'rgba(255,0,0,0.06)':'rgba(0,119,181,0.08)'}">
              ${a.avatar ? `<img src="${esc(a.avatar)}" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover;border-radius:9px">` : platformIcon(a.platform, 22)}
            </div>
            <div>
              <div style="font-size:13.5px;font-weight:600;color:var(--text-primary)">${esc(a.name)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${esc(a.url?.slice(0,50)||'')}</div>
            </div>
          </div>
        </td>
        <td>${platformBadge(a.platform)}</td>
        <td>
          <span class="mono" style="font-size:15px;font-weight:700;color:var(--text-primary)">${act.total_posts||0}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:4px">/ 近30天 ${act.recent_posts||0}</span>
        </td>
        <td style="color:var(--text-muted);font-size:12.5px">${lastCheck}</td>
        <td>
          <label class="toggle">
            <input type="checkbox" ${enabled?'checked':''} onchange="toggleAccount('${a.id}', this.checked)">
            <div class="toggle-slider"></div>
          </label>
        </td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="checkSingle('${a.id}')" title="立即检查">
              <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.63"/></svg>
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteAccount('${a.id}', '${esc(a.name)}')" title="删除">
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  window.toggleAccount = async function(id, enabled) {
    await App.api.PUT(`/accounts/${id}`, { enabled });
    toast(enabled ? '已启用监控' : '已暂停监控', 'info');
  };

  window.checkSingle = async function(id) {
    toast('开始检查…', 'info');
    const btn = event?.currentTarget;
    if (btn) btn.disabled = true;
    await App.api.POST(`/accounts/${id}/check`, {});
    toast('检查完成', 'success');
    if (btn) btn.disabled = false;
    load();
  };

  window.deleteAccount = async function(id, name) {
    if (!confirm(`确定要删除「${name}」吗？相关动态和通知将一并删除。`)) return;
    await App.api.DEL(`/accounts/${id}`, {});
    toast(`已删除 ${name}`, 'warning');
    load();
  };

  return { load };
})();


/* ═══════════════════════════════════════════════════
   Alerts — Notification History
   ═══════════════════════════════════════════════════ */

const Alerts = (() => {

  async function load() {
    const el = document.getElementById('alerts-list');
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中…</div>`;

    const notifications = await App.api.GET('/notifications') || [];

    if (!notifications.length) {
      el.innerHTML = `<div class="empty-state" style="padding:48px">
        <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <h3>暂无通知</h3><p>当监控到新动态时，通知将出现在这里</p>
      </div>`;
      return;
    }

    el.innerHTML = notifications.map(n => {
      // Exact SVG paths as specified — no stroke, proper closing tags
      const ytSVG = `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8z" fill="#FF0000"></path><polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02" fill="#fff"></polygon></svg>`;
      const liSVG = `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#0077B5"></rect><path d="M6.5 10h2v7.5h-2zM7.5 9a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 7.5 9zM10.5 10h1.9v1s.6-1 2.1-1c1.8 0 3 1.1 3 3.4v4.1h-2v-3.8c0-1-.4-1.7-1.3-1.7-.9 0-1.7.6-1.7 1.8v3.7h-2z" fill="#fff"></path></svg>`;
      const icon = n.platform === 'youtube'
        ? `<div class="alert-icon-wrap" style="background:rgba(255,0,0,0.08);padding:8px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ytSVG}</div>`
        : `<div class="alert-icon-wrap" style="background:rgba(0,119,181,0.1);padding:8px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${liSVG}</div>`;

      return `
      <div class="alert-item${n.read ? '' : ' unread'}" data-id="${n.id}">
        ${icon}
        <div class="alert-info">
          <div class="alert-title">${esc(n.account_name||'未知账号')} ${n.read ? '' : '<span class="badge badge-new" style="font-size:9px;height:16px">NEW</span>'}
            ${n.title ? ' · ' + esc(n.title.slice(0,60)) : ''}
          </div>
          <div class="alert-meta">${relTime(n.created_at)} · ${n.platform === 'youtube' ? 'YouTube' : 'LinkedIn'}</div>
        </div>
        <div class="alert-actions">
          ${n.url ? `<button class="btn btn-ghost btn-sm" onclick="window.open('${esc(n.url)}','_blank')" title="查看原文">
            <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="deleteAlert('${n.id}')" title="删除">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

    // Mark unread as read
    await App.api.PUT('/notifications/read-all', {});
  }

  window.deleteAlert = async function(id) {
    await App.api.DEL(`/notifications/${id}`, {});
    document.querySelector(`.alert-item[data-id="${id}"]`)?.remove();
    toast('已删除', 'info');
  };

  window.markAllAlertsRead = async function() {
    await App.api.PUT('/notifications/read-all', {});
    document.querySelectorAll('.alert-item').forEach(el => el.classList.remove('unread'));
    document.querySelectorAll('.alert-item .badge-new').forEach(el => el.remove());
    toast('已全部标记为已读', 'success');
  };

  return { load };
})();
