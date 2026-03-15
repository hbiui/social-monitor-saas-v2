@echo off
echo 🚀 Orbital - 社媒竞品监控平台
echo.
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 未检测到 Node.js，请先安装：https://nodejs.org
    pause
    exit /b
)
if not exist "node_modules\" (
    echo 📦 首次运行，安装依赖...
    npm install
)
echo ✅ 启动服务中，将自动打开浏览器...
node server.js
pause
