# Orbital — 社媒竞品监控平台 v2.0

专业级社媒竞品监控系统，支持 YouTube & LinkedIn 实时动态追踪。

## ✨ 新版特性

### 🎨 全新 SaaS UI 设计
- 极简深色主题（参考 Linear/Vercel 设计语言）
- 支持 Light / Dark 双主题切换
- 响应式设计，适配桌面/平板/手机

### 📊 数据仪表盘
- 实时 Metric Cards（总账号、动态数、未读、AI分析）
- 动态发布趋势折线图（14天/30天）
- 平台分布饼图

### 📡 动态流 (Social Feed Stream)
- 信息流式卡片展示
- 按平台 / 账号 / 排序多维过滤
- 关键词自动提取标签
- 实时 SSE 推送更新提示

### 📈 数据分析
- 30天趋势分析（YouTube vs LinkedIn）
- 各账号发布频率对比柱状图
- 热门关键词词云 + Top10 排行
- Chart.js 驱动，流畅交互

### 🔔 监控提醒
- 所有平台通知历史
- 一键标记已读 / 跳转原文

### ⚡ 全局搜索
- 跨账号 + 跨动态实时搜索
- 快捷跳转

### 🤖 AI 分析集成
- 单条 / 同账号多条 / 跨账号分析
- 支持豆包、智谱、Gemini、Claude、OpenAI

## 🚀 快速启动

```bash
# Windows
双击 启动工具-Windows.bat

# Mac/Linux
chmod +x 启动工具-Mac-Linux.sh
./启动工具-Mac-Linux.sh

# 命令行
npm install
node server.js
```

访问 http://localhost:3000

## 📁 项目结构

```
orbital-social-monitor/
├── server.js          # 主服务器（含新增分析 API）
├── db.js              # 数据库（lowdb）
├── scheduler.js       # 定时调度
├── notifications.js   # 通知模块
├── ai.js              # AI 分析引擎
├── fetchers/
│   ├── youtube.js
│   └── linkedin.js
└── public/
    ├── index.html     # SaaS 前端壳
    ├── css/
    │   └── main.css   # 设计系统（~700行）
    └── js/
        ├── app.js       # 路由、API、主题、SSE
        ├── dashboard.js # 仪表盘
        ├── feeds.js     # 动态流
        ├── analytics.js # 图表分析
        ├── monitoring.js# 账号管理 + 提醒
        └── settings.js  # 设置面板
```

## 🆕 新增 API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/sse` | 实时 Server-Sent Events |
| `GET /api/search?q=` | 全局搜索 |
| `GET /api/analytics/overview` | 数据概览 |
| `GET /api/analytics/trends` | 发布趋势 |
| `GET /api/analytics/platforms` | 平台分布 |
| `GET /api/analytics/keywords` | 关键词提取 |
| `GET /api/analytics/frequency` | 账号发布频率 |
| `GET/POST/PUT/DELETE /api/alerts/rules` | 告警规则管理 |
