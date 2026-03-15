/* ═══════════════════════════════════════════════════
   Dashboard — Metric Cards · Mini Charts · Activity
   ═══════════════════════════════════════════════════ */

const Dashboard = (() => {
  let trendChart, platformChart;

  async function load() {
    renderSkeletonMetrics();
    const [overview, trends, platforms, activity] = await Promise.all([
      App.api.GET('/analytics/overview'),
      App.api.GET('/analytics/trends?days=14'),
      App.api.GET('/analytics/platforms'),
      App.api.GET('/analytics/accounts-activity'),
    ]);

    renderMetrics(overview);
    renderTrendChart(trends);
    renderPlatformChart(platforms);
    renderActiveAccounts(activity);
    renderRecentFeed();

    // Update subtitle
    const lastCheck = overview?.last_check;
    document.getElementById('dash-subtitle').textContent = lastCheck
      ? `上次检查: ${relTime(lastCheck)}`
      : '暂无检查记录';
  }

  function renderSkeletonMetrics() {
    const grid = document.getElementById('metric-grid');
    grid.innerHTML = Array(4).fill(`
      <div class="metric-card">
        <div class="metric-header"><div class="skeleton" style="width:36px;height:36px;border-radius:9px"></div></div>
        <div class="skeleton" style="height:36px;width:60%;margin-bottom:8px"></div>
        <div class="skeleton" style="height:12px;width:40%"></div>
      </div>`).join('');
  }

  function renderMetrics(d) {
    if (!d) return;
    const cards = [
      {
        label: '监控账号',
        value: d.total_accounts || 0,
        sub: `${d.enabled_accounts || 0} 个启用中`,
        icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>`,
        colorClass: '',
        trend: null,
      },
      {
        label: '总动态数',
        value: d.total_posts || 0,
        sub: `今日 ${d.today_posts || 0} 条`,
        icon: `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
        colorClass: 'cyan',
        trend: d.today_posts > 0 ? 'up' : null,
        trendText: d.today_posts > 0 ? `+${d.today_posts} 今日` : null,
      },
      {
        label: '未读动态',
        value: d.new_posts || 0,
        sub: `本周 ${d.week_posts || 0} 条新增`,
        icon: `<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
        colorClass: d.new_posts > 0 ? 'warning' : 'success',
        trend: null,
      },
      {
        label: 'AI 分析',
        value: d.ai_analyses || 0,
        sub: `${d.youtube_accounts || 0} YT · ${d.linkedin_accounts || 0} LI 账号`,
        icon: `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        colorClass: '',
        trend: null,
      },
    ];

    document.getElementById('metric-grid').innerHTML = cards.map(c => `
      <div class="metric-card ${c.colorClass}">
        <div class="metric-header">
          <div class="metric-icon ${c.colorClass}">${c.icon}</div>
          ${c.trend ? `<span class="metric-trend ${c.trend}">${c.trendText}</span>` : ''}
        </div>
        <div class="metric-value" id="mv-${c.label}">${formatNum(c.value)}</div>
        <div class="metric-label">${c.label} · ${c.sub}</div>
      </div>`).join('');

    // Animate counters
    cards.forEach(c => animateCounter(`mv-${c.label}`, c.value));
  }

  function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el || target === 0) return;
    let current = 0;
    const step = Math.max(1, Math.floor(target / 30));
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = formatNum(current);
      if (current >= target) clearInterval(timer);
    }, 30);
  }

  // ── Brand logo images for Chart.js legends ────────────
  function _makePlatformImg(platform, size) {
    const s = size || 14;
    const YT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8z" fill="#FF0000"/><polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02" fill="#fff"/></svg>`;
    const LI = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}"><rect width="24" height="24" rx="4" fill="#0077B5"/><path d="M6.5 10h2v7.5h-2zM7.5 9a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 7.5 9zM10.5 10h1.9v1s.6-1 2.1-1c1.8 0 3 1.1 3 3.4v4.1h-2v-3.8c0-1-.4-1.7-1.3-1.7-.9 0-1.7.6-1.7 1.8v3.7h-2z" fill="#fff"/></svg>`;
    const img = new Image(s, s);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(platform === 'youtube' ? YT : LI);
    return img;
  }

  function renderTrendChart(trends) {
    const canvas = document.getElementById('chart-trend');
    if (!canvas || !trends?.length) return;

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const textColor = isDark ? '#8B8FA8' : '#6B7080';

    if (trendChart) trendChart.destroy();
    const ytImg = _makePlatformImg('youtube', 16);
    const liImg = _makePlatformImg('linkedin', 16);
    trendChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: trends.map(t => t.date.slice(5)),
        datasets: [
          {
            label: 'YouTube',
            data: trends.map(t => t.youtube),
            borderColor: '#FF4444',
            backgroundColor: 'rgba(255,68,68,0.08)',
            fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5,
            pointStyle: ytImg,
          },
          {
            label: 'LinkedIn',
            data: trends.map(t => t.linkedin),
            borderColor: '#0A66C2',
            backgroundColor: 'rgba(0,102,194,0.08)',
            fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5,
            pointStyle: liImg,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: textColor, font: { size: 11, family: 'Outfit' },
              usePointStyle: true, pointStyleWidth: 16,
              generateLabels: function(chart) {
                return chart.data.datasets.map((ds, i) => ({
                  text: ds.label,
                  fillStyle: ds.borderColor,
                  strokeStyle: ds.borderColor,
                  pointStyle: i === 0 ? ytImg : liImg,
                  datasetIndex: i,
                  hidden: !chart.isDatasetVisible(i),
                  fontColor: textColor,
                }));
              },
            },
          },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, stepSize: 1 }, beginAtZero: true },
        },
      },
    });
  }

  function renderPlatformChart(platforms) {
    const canvas = document.getElementById('chart-platform');
    if (!canvas || !platforms?.length) return;

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#8B8FA8' : '#6B7080';

    // Build ordered data ensuring youtube=red, linkedin=blue
    const platColors = platforms.map(p => p.platform === 'youtube'
      ? { bg: 'rgba(255,0,0,0.75)', border: '#FF0000' }
      : { bg: 'rgba(0,119,181,0.75)', border: '#0077B5' });

    if (platformChart) platformChart.destroy();
    platformChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: platforms.map(p => p.platform === 'youtube' ? 'YouTube' : 'LinkedIn'),
        datasets: [{
          data: platforms.map(p => p.count),
          backgroundColor: platColors.map(c => c.bg),
          borderColor: platColors.map(c => c.border),
          borderWidth: 2,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: textColor, font: { size: 11, family: 'Outfit' },
              boxWidth: 0,
              usePointStyle: true,
              pointStyleWidth: 14,
              generateLabels: function(chart) {
                return chart.data.labels.map((label, i) => {
                  const platform = platforms[i]?.platform || 'youtube';
                  return {
                    text: '  ' + label,
                    fillStyle: platColors[i]?.bg,
                    strokeStyle: platColors[i]?.border,
                    pointStyle: _makePlatformImg(platform, 14),
                    usePointStyle: true,
                    datasetIndex: 0,
                    index: i,
                    hidden: false,
                    fontColor: textColor,
                  };
                });
              },
            },
          },
        },
      },
    });
  }

  function renderActiveAccounts(activity) {
    const el = document.getElementById('active-accounts-list');
    if (!el) return;
    if (!activity?.length) { el.innerHTML = '<div class="empty-state" style="padding:30px"><p>暂无账号数据</p></div>'; return; }

    el.innerHTML = activity.slice(0, 5).map(a => `
      <div class="account-row">
        <div class="account-avatar" style="width:38px;height:38px;border-radius:10px;background:${a.platform==='youtube'?'rgba(255,0,0,0.06)':'rgba(0,119,181,0.08)'}">
          ${a.avatar
            ? `<img src="${esc(a.avatar)}" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`
            : platformIcon(a.platform, 22)}
        </div>
        <div class="account-info">
          <div class="account-name">${esc(a.name)}</div>
          <div class="account-meta">${platformBadge(a.platform)}</div>
        </div>
        <div style="text-align:right">
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--text-primary)">${a.recent_posts}</div>
          <div class="text-xs" style="color:var(--text-muted)">近30天</div>
        </div>
      </div>`).join('');
  }

  function renderRecentFeed() {
    const el = document.getElementById('recent-feed-dash');
    if (!el) return;
    const posts = AppData.getAllPosts().slice(0, 5);
    if (!posts.length) { el.innerHTML = '<div class="empty-state" style="padding:30px"><p>暂无动态</p></div>'; return; }

    el.innerHTML = posts.map(p => `
      <div class="account-row" style="cursor:pointer" onclick="window.open('${esc(p.url)}','_blank')">
        <div class="account-avatar" style="border-radius:8px;background:${p.platform==='youtube'?'rgba(255,0,0,0.06)':'rgba(0,119,181,0.08)'}">
          ${platformIcon(p.platform, 22)}
        </div>
        <div class="account-info">
          <div class="account-name" style="font-size:13px">${esc((p.title||'无标题').slice(0,50))}</div>
          <div class="account-meta">${esc(p.account_name||'')} · ${relTime(p.published_at)}</div>
        </div>
        ${p.is_new ? '<span class="badge badge-new" style="flex-shrink:0">新</span>' : ''}
      </div>`).join('');
  }

  return { load };
})();
