/**
 * AI分析模块 - 支持多种AI大模型
 * 支持：豆包(Doubao/Ark)、智谱清言(GLM)、Google Gemini、Claude(Anthropic)、OpenAI兼容接口
 * 
 * 重要：豆包(volces.com)和智谱(bigmodel.cn)是中国境内服务，
 *       不应走代理；OpenAI/Claude/Gemini 是境外服务，需要走代理。
 */
const axios = require('axios');
const db = require('./db');

// 中国境内 API 域名（不走代理）
const DOMESTIC_DOMAINS = [
  'volces.com',       // 豆包 / 火山方舟
  'bigmodel.cn',      // 智谱清言
  'aliyuncs.com',     // 阿里云
  'baidu.com',        // 百度
];

function isDomesticUrl(url) {
  return DOMESTIC_DOMAINS.some(d => url.includes(d));
}

function getAISettings() {
  return {
    ai_provider:     db.getSetting('ai_provider') || 'doubao',
    doubao_api_key:  db.getSetting('doubao_api_key') || '',
    doubao_model:    db.getSetting('doubao_model') || 'doubao-seed-2-0-pro-260215',
    doubao_visual_model: db.getSetting('doubao_visual_model') || 'doubao-seedream-5-0-260128',
    zhipu_api_key:   db.getSetting('zhipu_api_key') || '',
    zhipu_model:     db.getSetting('zhipu_model') || 'glm-4-flash',
    gemini_api_key:  db.getSetting('gemini_api_key') || '',
    gemini_model:    db.getSetting('gemini_model') || 'gemini-2.0-flash',
    claude_api_key:  db.getSetting('claude_api_key') || '',
    claude_model:    db.getSetting('claude_model') || 'claude-sonnet-4-6',
    openai_api_key:  db.getSetting('openai_api_key') || '',
    openai_model:    db.getSetting('openai_model') || 'gpt-4o-mini',
    openai_base_url: db.getSetting('openai_base_url') || 'https://api.openai.com/v1',
    ai_system_prompt: db.getSetting('ai_system_prompt') || '',
    ai_auto_notify:   db.getSetting('ai_auto_notify') || 'false',
  };
}

/**
 * 根据目标 URL 决定是否使用代理
 * 境内服务不走代理（避免 TLS 错误）
 * 境外服务走代理（需要翻墙）
 */
function getProxyConfig(targetUrl) {
  // 境内服务：不用代理
  if (isDomesticUrl(targetUrl)) return {};

  // 境外服务：读取代理配置
  const proxyUrl = (
    db.getSetting('proxy_url') ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY  ||
    process.env.http_proxy  || ''
  ).trim();

  if (!proxyUrl) return {};
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return { httpsAgent: new HttpsProxyAgent(proxyUrl), proxy: false };
  } catch (e) {
    return {};
  }
}

function buildPrompt(posts, mode, customPrompt = '') {
  const settings = getAISettings();
  const systemBase = settings.ai_system_prompt ||
    `你是一位顶级的社交媒体战略分析师，擅长对多平台内容进行深度竞对分析。请用中文回复。

【输出格式规范】必须严格遵守以下排版规范，使输出内容层次分明、易于阅读：

1. 一级标题：## 标题文字（如：## 市场定位分析）
2. 二级标题：### 标题（如：### 内容特征分析）
3. 三级标题：#### 子标题（无需 emoji）
4. 关键结论：用 **粗体** 标注核心观点（如：**品牌定位清晰，聚焦高端B端市场**）
5. 重要数据/指标：用 \`代码格式\` 标注（如：\`发布频率：每周3条\`、\`互动率：4.8%\`）
6. 无序列表要点：- 开头（如：- 内容本地化程度高，覆盖6种语言）
7. 数据对比表格：使用 Markdown 表格（| 列名 | 列名 |）
8. 分隔线：重要章节间用 --- 单独一行
9. 核心洞察引用：> 引用格式（如：> **核心洞察**：该品牌正从产品营销转向价值观营销）

【严格禁止事项】
- 禁止将 emoji 嵌入句子中间（不允许"品牌🔹在市场⚡中..."这种写法）
- emoji 只能出现在标题开头前缀（最多1个）或列表项行首（最多1个），禁止出现在句子内部
- 禁止用 emoji 替代文字内容（不允许"核心竞争力：🚀"这种无文字的写法）
- 禁止在任何正文句子内插入 emoji 作为修饰或强调
- 列表每条内容必须是完整句子，不少于15字，禁止仅输出词组或短词

语言专业精炼，适合商务汇报场景，结论有据可查。`;

  let userPrompt = '';

  if (mode === 'single') {
    const post = posts[0];
    const platform = post.platform === 'youtube' ? 'YouTube' : 'LinkedIn';
    userPrompt = `请对以下社交媒体动态进行深度专业分析：

【平台】${platform}
【账号】${post.account_name || '未知'}
【标题】${post.title || '(无标题)'}
【内容】${post.content || post.title || '(无内容)'}
【发布时间】${post.published_at || '未知'}
【链接】${post.url || ''}

请严格按照系统规范的格式输出，从以下维度进行深度分析：

## 一、核心内容摘要
用100-150字精炼总结该动态的核心信息。

---

## 二、市场定位与人群画像
- 该内容针对的目标受众是谁？年龄、职业、兴趣特征？
- 体现了账号/品牌怎样的市场定位？

---

## 三、内容核心特征
- 内容形式、传播逻辑、叙事结构有何特点？
- 情感调性、核心价值主张是什么？

---

## 四、重要信号
- 有哪些值得警觉的竞争信号或市场变化？
- 对行业/品牌有何启示？

---

## 五、可行建议
给出2-3条基于本条动态的具体策略建议，每条建议不少于30字，结论有据可查。
${customPrompt ? `\n## 额外要求\n${customPrompt}` : ''}`;

  } else if (mode === 'multi') {
    const accountName = posts[0]?.account_name || '该账号';
    const platform = posts[0]?.platform === 'youtube' ? 'YouTube' : 'LinkedIn';
    // 完整输出所有动态，不做任何截断
    const postsText = posts.map((p, i) =>
      `[第${i+1}条]\n发布时间：${p.published_at?.slice(0,10)||'未知'}\n标题：${p.title||'(无标题)'}\n内容：${p.content||p.title||'(无内容)'}\n链接：${p.url||''}`
    ).join('\n\n━━━━━━━━━━━━━━━━━━\n\n');

    userPrompt = `请对以下来自同一账号的${posts.length}条社交媒体动态进行综合深度分析：

【平台】${platform}
【账号】${accountName}
【分析动态数量】${posts.length}条

━━━ 动态内容全文 ━━━

${postsText}

━━━━━━━━━━━━━━━━━━

请严格按照系统规范的格式输出，从以下六大核心维度进行专业综合分析：

## 一、市场定位与人群画像
- 该账号/品牌聚焦的目标人群画像（年龄、职业、兴趣、消费能力）
- 品牌在市场中的定位策略与竞争卡位

---

## 二、内容核心特征
- 内容主题聚焦方向、风格调性、叙事手法
- 高频词汇与情感倾向分析
- 内容创作规律与发布节奏

---

## 三、传播逻辑分析
- 该账号内容的传播逻辑与爆款规律
- 引发互动的核心驱动力
- 钩子设计与用户留存策略

---

## 四、共同热点话题
- 近期持续发力的热点话题或议题
- 与行业趋势的契合度

---

## 五、行业洞察
- 该账号内容折射的行业趋势与市场机会
- 用户需求与痛点变化

---

## 六、重要信号与策略建议
值得关注的竞争信号（3-5条）：

可参考借鉴的策略建议（3-5条，每条建议不少于30字）：
${customPrompt ? `\n## 额外要求\n${customPrompt}` : ''}`;

  } else if (mode === 'cross') {
    // 跨账号分析 - 不做任何截断，完整传入所有内容
    const accountGroups = {};
    const accountOrder = [];
    posts.forEach(p => {
      const key = p.account_id || p.account_name;
      if (!accountGroups[key]) {
        accountGroups[key] = { name: p.account_name, platform: p.platform, posts: [] };
        accountOrder.push(key);
      }
      accountGroups[key].posts.push(p);
    });

    const groupsText = accountOrder.map(key => {
      const g = accountGroups[key];
      const platform = g.platform === 'youtube' ? 'YouTube' : 'LinkedIn';
      const postsText = g.posts.map((p, i) =>
        `  [第${i+1}条] ${p.published_at?.slice(0,10)||''}\n  标题：${p.title||'(无标题)'}\n  内容：${p.content||p.title||''}\n  链接：${p.url||''}`
      ).join('\n\n');
      return `◆ 【${g.name}】（${platform}，共${g.posts.length}条动态）\n\n${postsText}`;
    }).join('\n\n' + '═'.repeat(40) + '\n\n');

    const accountSummary = accountOrder.map(key => {
      const g = accountGroups[key];
      return `• ${g.name}（${g.platform === 'youtube' ? 'YouTube' : 'LinkedIn'}，${g.posts.length}条）`;
    }).join('\n');

    userPrompt = `请对以下${accountOrder.length}个社媒账号/品牌的共${posts.length}条动态进行跨账号深度竞对分析：

【参与分析的账号】
${accountSummary}

${'═'.repeat(40)}
以下是所有动态的完整内容：
${'═'.repeat(40)}

${groupsText}

${'═'.repeat(40)}

请严格按照系统规范的格式输出，从以下六大核心维度进行跨账号专业对比分析：

## 一、市场定位与人群画像对比
🔹 各账号/品牌的目标用户画像差异
🔹 市场卡位策略对比：谁在争抢同一批用户？谁在差异化突围？

> 💡 **核心问题**：各品牌的定位是否存在本质性冲突？

---

## ⚖️ 二、差异化对比

### 🔍 传播逻辑差异
🔹 各品牌在内容形式、叙事结构、情感策略上的本质差异
🔹 各自的流量获取逻辑有何不同？

### 🏆 品牌战略差异
🔹 各品牌通过内容传递的品牌主张与价值观差异
🔹 谁在走高端路线/亲民路线/专业路线？

---

## ✨ 三、内容核心特征分析
🔹 各账号的内容风格、频次、话题聚焦对比
🔹 高质量内容的共性规律是什么？

---

## 四、共同热点话题
🔹 多个账号同时在押注哪些热点？
🔹 这反映了什么行业趋势？

---

## 📊 五、市场行业洞察
🔹 从这些内容整体来看，行业正在发生什么？
🔹 用户需求如何在演变？
🔹 哪些细分市场正在崛起或萎缩？

---

## 六、重要信号与策略建议
🔸 竞争态势的关键信号（至少5条，每条用 🔸 开头）

🚀 针对性的内容策略与竞争应对建议（至少5条，每条用 🚀 开头）

> 💡 **最优实践**：提炼跨品牌可直接复用的方法论
${customPrompt ? `\n## 额外要求\n${customPrompt}` : ''}`;
  }

  return { system: systemBase, user: userPrompt };
}

// 超时配置：测试用短超时，分析用超长超时
const TIMEOUT_TEST     = 15000;    // 15s - 用于连接测试
const TIMEOUT_ANALYSIS = 600000;   // 600s (10分钟) - 多条动态大批量分析

/**
 * 豆包 / 火山方舟 API
 */
async function callDoubao(apiKey, model, system, user, timeout = TIMEOUT_ANALYSIS) {
  const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const proxy = getProxyConfig(endpoint);
  const response = await axios.post(
    endpoint,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout,
      ...proxy,
    }
  );
  return response.data.choices?.[0]?.message?.content || '(无返回内容)';
}

/**
 * 智谱清言 (Zhipu GLM) API
 */
async function callZhipu(apiKey, model, system, user, timeout = TIMEOUT_ANALYSIS) {
  const endpoint = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const proxy = getProxyConfig(endpoint);
  const response = await axios.post(
    endpoint,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout,
      ...proxy,
    }
  );
  return response.data.choices?.[0]?.message?.content || '(无返回内容)';
}

/**
 * Google Gemini API
 */
async function callGemini(apiKey, model, system, user, timeout = TIMEOUT_ANALYSIS) {
  const cleanModel = model.replace(/^models\//, '');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;
  const proxy = getProxyConfig(endpoint);
  const response = await axios.post(
    `${endpoint}?key=${apiKey}`,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.7 },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout,
      ...proxy,
    }
  );
  return response.data.candidates?.[0]?.content?.parts?.[0]?.text || '(无返回内容)';
}

/**
 * Claude (Anthropic) API
 */
async function callClaude(apiKey, model, system, user, timeout = TIMEOUT_ANALYSIS) {
  const endpoint = 'https://api.anthropic.com/v1/messages';
  const proxy = getProxyConfig(endpoint);
  const response = await axios.post(
    endpoint,
    {
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout,
      ...proxy,
    }
  );
  return response.data.content?.[0]?.text || '(无返回内容)';
}

/**
 * OpenAI 兼容接口
 */
async function callOpenAICompatible(apiKey, baseUrl, model, system, user, timeout = TIMEOUT_ANALYSIS) {
  const cleanBase = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = `${cleanBase}/chat/completions`;
  const proxy = getProxyConfig(endpoint);
  const response = await axios.post(
    endpoint,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout,
      ...proxy,
    }
  );
  return response.data.choices?.[0]?.message?.content || '(无返回内容)';
}

async function analyzeWithAI(posts, mode = 'single', customPrompt = '', provider = null, options = {}) {
  const settings = getAISettings();
  const useProvider = provider || settings.ai_provider;
  const timeout = options.timeout || TIMEOUT_ANALYSIS;

  if (!posts || posts.length === 0) return { success: false, error: '没有可分析的动态内容' };

  const { system, user } = buildPrompt(posts, mode, customPrompt);

  try {
    let result = '', modelUsed = '';

    switch (useProvider) {
      case 'doubao': {
        const apiKey = settings.doubao_api_key;
        const model  = settings.doubao_model;
        if (!apiKey) return { success: false, error: '豆包 API Key 未配置' };
        result = await callDoubao(apiKey, model, system, user, timeout);
        modelUsed = model;
        break;
      }
      case 'zhipu': {
        const apiKey = settings.zhipu_api_key;
        const model  = settings.zhipu_model;
        if (!apiKey) return { success: false, error: '智谱清言 API Key 未配置' };
        result = await callZhipu(apiKey, model, system, user, timeout);
        modelUsed = model;
        break;
      }
      case 'gemini': {
        const apiKey = settings.gemini_api_key;
        const model  = settings.gemini_model;
        if (!apiKey) return { success: false, error: 'Google Gemini API Key 未配置' };
        result = await callGemini(apiKey, model, system, user, timeout);
        modelUsed = model;
        break;
      }
      case 'claude': {
        const apiKey = settings.claude_api_key;
        const model  = settings.claude_model;
        if (!apiKey) return { success: false, error: 'Claude API Key 未配置' };
        result = await callClaude(apiKey, model, system, user, timeout);
        modelUsed = model;
        break;
      }
      case 'openai':
      default: {
        const apiKey = settings.openai_api_key;
        const model  = settings.openai_model;
        const baseUrl = settings.openai_base_url || 'https://api.openai.com/v1';
        if (!apiKey) return { success: false, error: 'OpenAI API Key 未配置' };
        result = await callOpenAICompatible(apiKey, baseUrl, model, system, user, timeout);
        modelUsed = model;
        break;
      }
    }

    return { success: true, result, provider: useProvider, model: modelUsed };
  } catch (e) {
    const status = e.response?.status;
    const apiErr = e.response?.data?.error?.message || e.response?.data?.message || e.response?.data?.error;
    let errMsg = (typeof apiErr === 'string' ? apiErr : JSON.stringify(apiErr)) || e.message || 'AI分析失败';

    if (e.code === 'ECONNREFUSED')
      errMsg = `无法连接到 AI API（ECONNREFUSED）。如果使用境外服务（OpenAI/Claude/Gemini），请在「设置→网络代理」配置代理。`;
    if (e.code === 'ECONNRESET' || e.message?.includes('socket disconnected') || e.message?.includes('TLS'))
      errMsg = `${useProvider === 'doubao' ? '豆包是境内服务，请勿为其配置代理（如当前代理路由国内流量会导致此问题）。错误' : '连接被中断'}：${e.message}`;
    // ECONNABORTED = axios 自身超时（timeout 参数到期），ETIMEDOUT/ESOCKETTIMEDOUT = 系统级网络超时
    if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.code === 'ESOCKETTIMEDOUT' ||
        (e.message && e.message.includes('timeout'))) {
      const isForeign = ['openai','claude','gemini'].includes(useProvider);
      errMsg = `AI 请求超时（${TIMEOUT_ANALYSIS/1000}秒内未收到响应）。`
             + (isForeign ? '境外服务需要代理，请在「设置→网络代理」配置。' : '请检查网络连接，或减少选择的动态数量后重试。');
    }
    if (status === 401)
      errMsg = `API Key 无效或已过期（401 Unauthorized）。请确认 Key 填写正确。`;
    if (status === 403)
      errMsg = `API 访问被拒绝（403 Forbidden）。请检查账号权限或套餐状态。`;
    if (status === 429)
      errMsg = `请求频率超限（429 Too Many Requests），请稍后再试。`;
    if (status === 404)
      errMsg = `API 地址或模型不存在（404）。模型名称：${settings[`${useProvider}_model`] || '未知'}${apiErr ? '。详情：' + apiErr : ''}`;
    if (status === 400)
      errMsg = `请求参数错误（400）：${apiErr || e.message}`;

    console.error(`[AI] ${useProvider} error:`, e.code, status, errMsg);
    return { success: false, error: errMsg, provider: useProvider };
  }
}

module.exports = { analyzeWithAI, getAISettings };
