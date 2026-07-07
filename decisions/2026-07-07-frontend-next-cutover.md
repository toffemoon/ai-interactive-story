---
date: 2026-07-07
status: accepted
owner: gengyue
---

# 主前端 cutover:frontend-next 取代零构建 frontend/

## 决策
frontend-next(Vite + React + HashRouter)正式取代零构建单文件 frontend/ 成为唯一主前端;后端 serve 其构建产物 `frontend-next/dist/`。旧 frontend/ 删除。

## 背景
双前端长期未收敛(头号结构债):线上 serve 的是 frontend/(prototype 1:1 复刻,Recon* 视图),而近三周几乎全部前端工作在 frontend-next(YOR-92..200)。评估(见本 repo 会话记录)确认 frontend-next 已覆盖核心用户流(游玩/建卡/纯聊/探索/登录/个人中心),主理人 2026-07-07 本机拍板:替换 + 删除旧前端(除非重合部分)。

## 执行(commit 90ec795)
- `src/api.py`:`FRONTEND = ROOT / "frontend-next" / "dist"`(HashRouter,`/` 挂 dist 即可,无需 SPA catch-all fallback)。
- 非重合静态资源 `frontend/covers` → `frontend-next/public/covers`(预设封面,后端 `/api/presets` 数据里 `cover` 字段引用;vite build 打包进 `dist/covers`)。
- 删除整个 `frontend/`(app.jsx / views / vendor / styles / mu-settle.js / assets)。其中 `assets`(recon 立绘)经 grep 确认 frontend-next 源码零引用,一并删除。
- 新增 `frontend-next/vercel.json`(Vercel 部署新前端:`npm run build` → dist + `/api` 反代 Render)。
- `operator_console.html`(`/operator` 路由)与 `/oc-assets` 白名单路由独立于 frontend/,不受影响。

## 验证
本地 HTTP 层(`uvicorn ... --lifespan off` 跳过当前不可达的 test 库):
- `GET /` 返回 frontend-next dist(vite 产物 `index-*.js`,已无旧 babel/app.jsx)
- `/covers/*`、`/assets/*`(vite)、`/home/*`(立绘)、`/operator` 均 200 或预期 404
- 删除 frontend/ 后对运行中服务复测,serve 仍全 200

## 部署影响 / 待办
- 生产生效需:① Vercel Root Directory 改 `frontend-next`(自动 build);② Render 是 python runtime、不 build 前端 —— 若不提交 dist,Render 上 `FRONTEND.is_dir()` 为 False 会退化为纯 API(前端交 Vercel),要 Render 也 serve 前端需提交 dist 或给 buildCommand 加 node build。
- `dist` 仍被 `frontend-next/.gitignore` 忽略(未提交)。
- 完整交互/渲染测试待 test 库(Supabase 免费项目 auto-pause,当前 `tenant/user not found`)resume 后补。
- **未合并的 51 条 `yor-*` 前端修复分支需后续收敛**:本次 cutover 的是当前 main 版 frontend-next,不含这些分支里的 bug 修复。
- 本改动在分支 `feat/frontend-next-cutover`,未 push;走 PR 合 main。

## 影响的旧记录
README「前端 = 零构建单文件 app.jsx」、CLAUDE.md「线上实际服务的是 frontend/」需相应更新为 frontend-next。
