---
type: status-snapshot
project: ai-interactive-story
updated: 2026-10-04
---

# 当前状态(快照)

> 本节原在入口文件顶部,2026-10-04 从入口文件 CLAUDE.md 原样移入(Claude 按 owner 要求移);入口只留指针。唯一改动:管理员邮箱换成环境变量名(公开仓不再新增邮箱)。引擎主线(找 OC 用户 + 打磨 UX、不加新功能)是方向约束,留在入口 [CLAUDE.md](../CLAUDE.md)「这个项目是什么」。

## 当前状态 (2026-07-10)

> synced 2026-07-10 · 真源=本 repo `docs/` + `decisions/`（下面是快照,细节以真源为准）

- **受控 Codex 本机模式已上线**(见 `decisions/2026-07-10-browser-local-codex-proxy.md`、`docs/LOCAL-CODEX-PROXY.md`):
  - 默认仍为 Render 后端 DeepSeek;operator 只向特定账户开放 Codex 本机选项。
  - 唯一授权管理员为 `SUPERADMIN_EMAIL` 指定的账户(值见 `render.yaml` / Render 环境变量,文档里不写邮箱);该账户固定拥有能力且不可撤销,数据库 role 不能产生第二个授权管理员。
  - Windows 玩家一键安装本机桥接并走 Codex 官方 ChatGPT OAuth,无需自建 Render、手填 URL/模型或管理 token;凭证不进入 app/Render。
  - 主故事支持真实 SSE;内部步骤不显示,旧桥接自动退回非流式,浏览器断开会中断 Codex turn。
  - 主流程 PR #150/#151;自动 OAuth/安装 PR #152;SSE PR #154,merge `8019f8b`,Render deploy `dep-d98bm4e7r5hc73cr6qh0` 已验证 `live`。

- **双前端已收敛(2026-07-08,见 `decisions/2026-07-07-frontend-next-cutover.md`)**:
  - **`frontend-next`(Vite + React + HashRouter)已作为唯一主前端合入 `main`(commit fc430b2)**;旧零构建 `frontend/` 已删除;`src/api.py` 现挂 `FRONTEND = ROOT / "frontend-next" / "dist"`,**dist 已提交进 git** 让 main 自包含可部署(Render 无 node build 也能 serve)。
  - 57 条前端修复分支收敛:**56 合入**(48 批量 + 6 手动解冲突 + onboarding 看板 yor-205 + 发布清单 yor-192)、**yor-56 过时跳过**(改的是已删的 `frontend/`);另补 Story 存档续玩 + 实时 tail 轮询。⚠️ yor-205 onboarding 引导流程建议真机走查;主体 Home 微修复(yor-179/180)在 onboarding 版的回归待验。
  - **首页 UI / 性能第一批已完成(2026-07-10,YOR-209)**:React Bits `StaggeredText` + `AnimatedList` 已接入;ClickSpark 改为事件驱动并释放空闲画布;菜单防点击穿透、全屏隐藏、onboarding 键盘推进和测试路由已修。立绘双层交叉溶解与身份卡几何仍是敏感区,后续优化不要顺手改。详见 `docs/2026-07-10-home-ui-performance-pass-1.md`。
  - **探索页 UI / 性能优化已完成(2026-07-10,YOR-210)**:全路由懒加载让主 JS/gzip 约下降 31%;探索页改为紧凑响应式货架,补齐 skeleton、延迟搜索、封面懒加载、错误重试、减少动态效果及卡片/弹窗键盘语义。热度/点击因缺可信后端字段继续隐藏,图片衍生图/CDN 留待后续。详见 `docs/2026-07-10-explore-ui-performance-pass.md`。
- **部署**:`https://ai-interactive-story.onrender.com`,Render(`AUTH_ENABLED=1`、`COST_GUARD_ENABLED=1`)。Supabase prod=`hhrqxllcamdxqcoepwgx`、test=`yldfnbmpzkzjzjoyvfhb`。
- 记忆 Phase 1–3 已上线;导演 / 运营台已发布;最新使用数据以 operator 看板为准。
