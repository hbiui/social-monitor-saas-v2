/* ═══════════════════════════════════════════════════
   Settings — All Configuration Panels
   ═══════════════════════════════════════════════════ */

const Settings = (() => {

  async function load() {
    const settings = await App.api.GET('/settings');
    if (!settings) return;

    // General
    setVal('s-check-interval', settings.check_interval);
    setVal('s-display-count',  settings.default_display_count);
    setVal('s-youtube-key',    settings.youtube_api_key || '');

    // Auto analyze
    setCheck('s-auto-analyze', settings.auto_analyze_enabled);
    setCheck('s-auto-ppt',     settings.auto_ppt_enabled);
    setVal('s-auto-mode',      settings.auto_analyze_mode || 'multi');
    _syncPPTState(settings.auto_analyze_enabled);

    // Notifications
    setVal('s-tg-token',      settings.telegram_bot_token    || '');
    setVal('s-tg-chat',       settings.telegram_chat_id      || '');
    setVal('s-discord-url',   settings.discord_webhook_url   || '');
    setVal('s-smtp-host',     settings.smtp_host             || '');
    setVal('s-smtp-port',     settings.smtp_port             || '');
    setVal('s-smtp-user',     settings.smtp_user             || '');
    setVal('s-notify-email',  settings.notify_email          || '');
    // DingTalk robot
    setVal('s-dd-webhook',    settings.dingtalk_webhook_url    || '');
    setVal('s-dd-secret',     settings.dingtalk_webhook_secret ? '••••••' : '');
    // DingTalk work
    setVal('s-dd-app-key',    settings.dingtalk_app_key      || '');
    setVal('s-dd-agent-id',   settings.dingtalk_agent_id     || '');
    setVal('s-dd-user-ids',   settings.dingtalk_user_ids     || '');
    // (secret kept blank for security)

    // AI
    setVal('s-ai-provider',   settings.ai_provider     || 'doubao');
    setVal('s-ai-prompt',     settings.ai_system_prompt || '');
    onAIProviderChange(settings);

    // Proxy
    setVal('s-proxy-url', settings.proxy_url || '');
  }

  function setVal(id, val)   { const el = document.getElementById(id); if (el) el.value = val || ''; }
  function setCheck(id, val) { const el = document.getElementById(id); if (el) el.checked = !!val;   }

  // ── PPT toggle depends on AI toggle ───────────────────
  function _syncPPTState(aiOn) {
    const pptChk   = document.getElementById('s-auto-ppt');
    const pptLabel = document.getElementById('ppt-toggle-label');
    const pptDesc  = document.getElementById('ppt-toggle-desc');
    if (!pptChk) return;
    if (aiOn) {
      pptChk.disabled = false;
      if (pptLabel) pptLabel.style.opacity = '1';
      if (pptDesc)  pptDesc.textContent = 'AI 分析完成后自动生成报告';
    } else {
      pptChk.disabled = true;
      pptChk.checked  = false;
      if (pptLabel) pptLabel.style.opacity = '0.4';
      if (pptDesc)  pptDesc.textContent = '需先启用自动 AI 分析';
    }
  }

  window.onAutoAnalyzeChange = function(on) {
    _syncPPTState(on);
  };

  // ── AI Provider fields ─────────────────────────────────
  window.onAIProviderChange = function(prefilled) {
    const provider  = document.getElementById('s-ai-provider')?.value;
    const container = document.getElementById('ai-provider-fields');
    if (!container) return;

    const configs = {
      doubao: [
        { id: 's-doubao-key',   label: '豆包 API Key',   type: 'password', placeholder: '火山方舟控制台获取',           key: 'doubao_api_key' },
        { id: 's-doubao-model', label: '模型',           type: 'text',     placeholder: 'doubao-seed-2-0-pro-260215', key: 'doubao_model' },
      ],
      zhipu: [
        { id: 's-zhipu-key',   label: '智谱 API Key',   type: 'password', placeholder: 'open.bigmodel.cn 获取', key: 'zhipu_api_key' },
        { id: 's-zhipu-model', label: '模型',           type: 'text',     placeholder: 'glm-4-plus',            key: 'zhipu_model' },
      ],
      gemini: [
        { id: 's-gemini-key',   label: 'Gemini API Key', type: 'password', placeholder: 'Google AI Studio 获取', key: 'gemini_api_key' },
        { id: 's-gemini-model', label: '模型',           type: 'text',     placeholder: 'gemini-2.0-flash',      key: 'gemini_model' },
      ],
      claude: [
        { id: 's-claude-key',   label: 'Claude API Key', type: 'password', placeholder: 'Anthropic Console 获取', key: 'claude_api_key' },
        { id: 's-claude-model', label: '模型',           type: 'text',     placeholder: 'claude-sonnet-4-6',      key: 'claude_model' },
      ],
      openai: [
        { id: 's-openai-key',   label: 'OpenAI API Key', type: 'password', placeholder: 'sk-...',                        key: 'openai_api_key'  },
        { id: 's-openai-model', label: '模型',           type: 'text',     placeholder: 'gpt-4o',                       key: 'openai_model'    },
        { id: 's-openai-base',  label: 'Base URL',       type: 'url',      placeholder: 'https://api.openai.com/v1',    key: 'openai_base_url' },
      ],
    };

    const fields = configs[provider] || [];
    container.innerHTML = fields.map(f => `
      <div class="form-group">
        <label class="form-label">${f.label}</label>
        <input id="${f.id}" class="form-input" type="${f.type}" placeholder="${f.placeholder}"
          value="${esc(prefilled?.[f.key] || '')}">
      </div>`).join('');

    if (prefilled && typeof prefilled === 'object') {
      fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (el && prefilled[f.key]) el.value = prefilled[f.key];
      });
    }
  };

  // ── Save functions ─────────────────────────────────────
  window.saveGeneralSettings = async function() {
    const data = {
      check_interval:       document.getElementById('s-check-interval')?.value,
      default_display_count:document.getElementById('s-display-count')?.value,
      youtube_api_key:      document.getElementById('s-youtube-key')?.value,
    };
    const res = await App.api.PUT('/settings', data);
    toast(res?.error ? res.error : '✅ 基本设置已保存', res?.error ? 'error' : 'success');
  };

  window.saveAutoSettings = async function() {
    const aiOn = document.getElementById('s-auto-analyze')?.checked;
    const data = {
      auto_analyze_enabled: aiOn ? 'true' : 'false',
      // PPT can only be enabled if AI is enabled
      auto_ppt_enabled: (aiOn && document.getElementById('s-auto-ppt')?.checked) ? 'true' : 'false',
      auto_analyze_mode: document.getElementById('s-auto-mode')?.value,
    };
    await App.api.PUT('/settings', data);
    toast('✅ 自动分析设置已保存', 'success');
    _syncPPTState(aiOn);
  };

  window.saveNotifySettings = async function(type) {
    const data = {};
    if (type === 'telegram') {
      data.telegram_bot_token = document.getElementById('s-tg-token')?.value;
      data.telegram_chat_id   = document.getElementById('s-tg-chat')?.value;
    } else if (type === 'discord') {
      data.discord_webhook_url = document.getElementById('s-discord-url')?.value;
    } else if (type === 'email') {
      data.smtp_host    = document.getElementById('s-smtp-host')?.value;
      data.smtp_port    = document.getElementById('s-smtp-port')?.value;
      data.smtp_user    = document.getElementById('s-smtp-user')?.value;
      data.smtp_pass    = document.getElementById('s-smtp-pass')?.value;
      data.notify_email = document.getElementById('s-notify-email')?.value;
    } else if (type === 'dingtalk-robot') {
      data.dingtalk_webhook_url    = document.getElementById('s-dd-webhook')?.value;
      const sec = document.getElementById('s-dd-secret')?.value;
      if (sec && !sec.startsWith('••')) data.dingtalk_webhook_secret = sec;
    } else if (type === 'dingtalk-work') {
      data.dingtalk_app_key    = document.getElementById('s-dd-app-key')?.value;
      data.dingtalk_app_secret = document.getElementById('s-dd-app-secret')?.value;
      data.dingtalk_agent_id   = document.getElementById('s-dd-agent-id')?.value;
      data.dingtalk_user_ids   = document.getElementById('s-dd-user-ids')?.value;
    }
    const res = await App.api.PUT('/settings', data);
    const labels = { telegram:'Telegram', discord:'Discord', email:'邮件', 'dingtalk-robot':'钉钉群机器人', 'dingtalk-work':'钉钉工作通知' };
    toast(res?.error ? '❌ ' + res.error : `✅ ${labels[type] || type} 设置已保存`, res?.error ? 'error' : 'success');
  };

  window.testNotify = async function(type) {
    const urlMap = {
      telegram:       '/test/telegram',
      discord:        '/test/discord',
      'dingtalk-robot': '/test/dingtalk-robot',
      'dingtalk-work':  '/test/dingtalk-work',
    };
    const url = urlMap[type];
    if (!url) return;
    const labels = { telegram:'Telegram', discord:'Discord', 'dingtalk-robot':'钉钉群机器人', 'dingtalk-work':'钉钉工作通知' };
    toast(`正在测试 ${labels[type] || type}…`, 'info');
    const res = await App.api.POST(url, {});
    toast(res?.success ? `✅ ${labels[type]} 测试成功！` : `❌ ${res?.error || '测试失败'}`, res?.success ? 'success' : 'error');
  };

  window.saveAISettings = async function() {
    const provider = document.getElementById('s-ai-provider')?.value;
    const data = {
      ai_provider:     provider,
      ai_system_prompt:document.getElementById('s-ai-prompt')?.value,
    };
    const fieldIds = {
      doubao: ['s-doubao-key:doubao_api_key','s-doubao-model:doubao_model'],
      zhipu:  ['s-zhipu-key:zhipu_api_key', 's-zhipu-model:zhipu_model'],
      gemini: ['s-gemini-key:gemini_api_key','s-gemini-model:gemini_model'],
      claude: ['s-claude-key:claude_api_key','s-claude-model:claude_model'],
      openai: ['s-openai-key:openai_api_key','s-openai-model:openai_model','s-openai-base:openai_base_url'],
    };
    (fieldIds[provider] || []).forEach(pair => {
      const [elId, key] = pair.split(':');
      const val = document.getElementById(elId)?.value;
      if (val) data[key] = val;
    });
    await App.api.PUT('/settings', data);
    toast('✅ AI 设置已保存', 'success');
  };

  window.testAI = async function() {
    const provider = document.getElementById('s-ai-provider')?.value;
    toast('正在测试 AI 连接…', 'info');
    const res = await App.api.POST('/ai/test', { provider });
    toast(res?.success ? `✅ ${provider} 连接成功！` : `❌ ${res?.error || '连接失败'}`, res?.success ? 'success' : 'error');
  };

  window.testYouTube = async function() {
    const key = document.getElementById('s-youtube-key')?.value;
    if (!key) { toast('请先填入 YouTube API Key', 'warning'); return; }
    const res = await App.api.POST('/test/youtube', { api_key: key });
    toast(res?.success ? '✅ YouTube API Key 有效' : `❌ ${res?.error}`, res?.success ? 'success' : 'error');
  };

  window.fillProxy = function(url) {
    const el = document.getElementById('s-proxy-url');
    if (el) {
      el.value = url;
      el.focus();
      // highlight the field briefly
      el.style.borderColor = 'var(--accent)';
      setTimeout(function() { el.style.borderColor = ''; }, 1200);
      toast('已填入代理地址，点击「保存代理」生效', 'info', 2000);
    }
  };

  window.saveProxySettings = async function() {
    const proxy_url = document.getElementById('s-proxy-url')?.value;
    await App.api.PUT('/settings', { proxy_url });
    toast('✅ 代理设置已保存', 'success');
  };

  window.testProxy = async function() {
    const proxy_url = document.getElementById('s-proxy-url')?.value;
    toast('正在测试代理…', 'info');
    const res = await App.api.POST('/test/proxy', { proxy_url });
    const resultEl = document.getElementById('proxy-test-result');
    if (resultEl) {
      resultEl.classList.remove('hidden');
      resultEl.style.color = res?.success ? 'var(--success)' : 'var(--danger)';
      resultEl.textContent = res?.success ? `✅ ${res.message}` : `❌ ${res?.error}`;
    }
    toast(res?.success ? '✅ 代理连接成功' : `❌ ${res?.error}`, res?.success ? 'success' : 'error');
  };

  return { load };
})();
