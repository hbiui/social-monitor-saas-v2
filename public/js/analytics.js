/* ═══════════════════════════════════════════════════
   Analytics — Charts · Keywords · Trends
   ═══════════════════════════════════════════════════ */

const Analytics = (() => {
  let charts = {};

  const isDark    = () => document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor = () => isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const textColor = () => isDark() ? '#8B8FA8' : '#6B7080';

  /* ── SVG-logo Image helper for Chart.js pointStyle ── */
  function _platImg(platform, size) {
    const s = size || 16;
    const YT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8z" fill="#FF0000"/><polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02" fill="#fff"/></svg>`;
    const LI = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}"><rect width="24" height="24" rx="4" fill="#0077B5"/><path d="M6.5 10h2v7.5h-2zM7.5 9a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 7.5 9zM10.5 10h1.9v1s.6-1 2.1-1c1.8 0 3 1.1 3 3.4v4.1h-2v-3.8c0-1-.4-1.7-1.3-1.7-.9 0-1.7.6-1.7 1.8v3.7h-2z" fill="#fff"/></svg>`;
    const img = new Image(s, s);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(platform === 'youtube' ? YT : LI);
    return img;
  }

  const chartDefaults = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: textColor(), font: { size: 11, family: 'Outfit' }, boxWidth: 12 } },
    },
    scales: {
      x: { grid: { color: gridColor() }, ticks: { color: textColor(), font: { size: 10 } } },
      y: { grid: { color: gridColor() }, ticks: { color: textColor(), font: { size: 10 } }, beginAtZero: true },
    },
  });

  async function load() {
    await Promise.all([loadTrends(), loadPlatform(), loadFrequency(), loadKeywords()]);
  }

  /* ── 1. 发布趋势 (with SVG legend icons) ──── */
  window.loadTrends = async function() {
    const days = document.getElementById('trend-range')?.value || 30;
    const data = await App.api.GET(`/analytics/trends?days=${days}`) || [];

    if (charts.trendFull) charts.trendFull.destroy();
    const canvas = document.getElementById('chart-trend-full');
    if (!canvas) return;

    const ytImg = _platImg('youtube', 16);
    const liImg = _platImg('linkedin', 16);
    const tc    = textColor();

    charts.trendFull = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(d => d.date.slice(5)),
        datasets: [
          {
            label: 'YouTube',
            data: data.map(d => d.youtube),
            borderColor: '#FF0000',
            backgroundColor: 'rgba(255,0,0,0.06)',
            fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
            pointStyle: ytImg,
          },
          {
            label: 'LinkedIn',
            data: data.map(d => d.linkedin),
            borderColor: '#0077B5',
            backgroundColor: 'rgba(0,119,181,0.06)',
            fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
            pointStyle: liImg,
          },
          {
            label: '总计',
            data: data.map(d => d.total),
            borderColor: '#6366F1',
            backgroundColor: 'rgba(99,102,241,0.06)',
            fill: false, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
            borderDash: [5, 3],
          },
        ],
      },
      options: {
        ...chartDefaults(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: tc, font: { size: 11, family: 'Outfit' },
              usePointStyle: true, pointStyleWidth: 16,
              generateLabels(chart) {
                return chart.data.datasets.map((ds, i) => ({
                  text: ds.label,
                  fillStyle: ds.borderColor,
                  strokeStyle: ds.borderColor,
                  pointStyle: i === 0 ? ytImg : (i === 1 ? liImg : 'line'),
                  usePointStyle: true,
                  datasetIndex: i,
                  hidden: !chart.isDatasetVisible(i),
                  fontColor: tc,
                }));
              },
            },
          },
        },
      },
    });
  };

  /* ── 2. 平台对比环形图 (with SVG legend icons) ── */
  async function loadPlatform() {
    const data = await App.api.GET('/analytics/platforms') || [];
    if (charts.platformFull) charts.platformFull.destroy();
    const canvas = document.getElementById('chart-platform-full');
    if (!canvas || !data.length) return;

    const platColors = data.map(p => p.platform === 'youtube'
      ? { bg: 'rgba(255,0,0,0.80)', border: '#FF0000' }
      : { bg: 'rgba(0,119,181,0.80)', border: '#0077B5' });
    const tc = textColor();

    charts.platformFull = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: data.map(p => p.platform === 'youtube' ? 'YouTube' : 'LinkedIn'),
        datasets: [{
          data: data.map(p => p.count),
          backgroundColor: platColors.map(c => c.bg),
          borderColor: platColors.map(c => c.border),
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: tc, font: { size: 11, family: 'Outfit' },
              usePointStyle: true, pointStyleWidth: 14, padding: 14,
              generateLabels(chart) {
                return chart.data.labels.map((label, i) => ({
                  text: '  ' + label,
                  fillStyle: platColors[i]?.bg,
                  strokeStyle: platColors[i]?.border,
                  pointStyle: _platImg(data[i]?.platform || 'youtube', 14),
                  usePointStyle: true,
                  datasetIndex: 0,
                  index: i,
                  hidden: false,
                  fontColor: tc,
                }));
              },
            },
          },
        },
      },
    });
  }

  /* ── 3. 账号发布频率对比 (cross-platform, sorted by count desc) ── */
  async function loadFrequency() {
    const data = await App.api.GET('/analytics/frequency') || [];
    if (charts.freq) charts.freq.destroy();
    const canvas = document.getElementById('chart-frequency');
    if (!canvas || !data.length) return;

    // Already sorted by posts_last_30d desc on server — mixed platforms in natural order
    const topData = data.slice(0, 12);
    charts.freq = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: topData.map(d => {
          const name = (d.name || '').replace(/\s*[|｜]\s*(LinkedIn|Twitter|YouTube)[^|]*$/i, '').trim().slice(0, 16);
          const platTag = d.platform === 'youtube' ? ' [YT]' : ' [LI]';
          return name + platTag;
        }),
        datasets: [{
          label: '近30天动态数',
          data: topData.map(d => d.posts_last_30d),
          backgroundColor: topData.map(d => d.platform === 'youtube' ? 'rgba(255,0,0,0.65)' : 'rgba(0,119,181,0.65)'),
          borderColor:     topData.map(d => d.platform === 'youtube' ? '#FF0000' : '#0077B5'),
          borderWidth: 1,
          borderRadius: 6,
        }],
      },
      options: {
        ...chartDefaults(),
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.raw} 条 · 均 ${topData[ctx.dataIndex]?.avg_per_week}/周`,
              title: ctx => topData[ctx[0]?.dataIndex]?.name || '',
            },
          },
        },
      },
    });
  }

  /* ── 4. 热门关键词 + Top-10 频率 ── */
  async function loadKeywords() {
    const keywords = await App.api.GET('/analytics/keywords') || [];

    const cloudEl = document.getElementById('keyword-cloud');
    if (cloudEl && keywords.length) {
      const max = keywords[0]?.count || 1;
      cloudEl.innerHTML = keywords.slice(0, 30).map(k => {
        const size    = 11 + Math.round((k.count / max) * 9);
        const opacity = 0.45 + (k.count / max) * 0.55;
        return `<span class="keyword-chip" style="font-size:${size}px;opacity:${opacity}" title="${k.count} 次出现">${esc(k.word)}</span>`;
      }).join('');
    }

    if (charts.kw) charts.kw.destroy();
    const canvas = document.getElementById('chart-keywords');
    if (!canvas || !keywords.length) return;

    const top10 = keywords.slice(0, 10);
    charts.kw = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: top10.map(k => k.word),
        datasets: [{
          label: '出现次数',
          data:  top10.map(k => k.count),
          backgroundColor: 'rgba(99,102,241,0.6)',
          borderColor: '#6366F1',
          borderWidth: 1,
          borderRadius: 5,
        }],
      },
      options: {
        ...chartDefaults(),
        indexAxis: 'y',
        plugins: { legend: { display: false } },
      },
    });
  }

  return { load };
})();
