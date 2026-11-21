@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   教资面试陪跑 · 本地服务
echo   根目录：%CD%
echo   地址：http://localhost:8001/index.html
echo ============================================
echo 关闭「服务」窗口即停止服务。
echo.
start "教资面试陪跑-服务窗口" cmd /k python -m http.server 8001
timeout /t 2 >nul
start "" "http://localhost:8001/index.html"
echo 已在浏览器打开首页；如果显示 404，请确认上面的「服务窗口」里没有报错。
pause
