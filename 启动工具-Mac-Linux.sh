#!/bin/bash
echo "🚀 Orbital — 社媒竞品监控平台"
echo ""
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装：https://nodejs.org"
    exit 1
fi
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，安装依赖..."
    npm install
fi
echo "✅ 启动服务，请在浏览器访问 http://localhost:3000"
node server.js
