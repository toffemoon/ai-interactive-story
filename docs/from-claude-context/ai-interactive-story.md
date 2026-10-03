---
project: YoRHa-A2
sub-project: ai-interactive-story
type: 子项目速报
owner: 内容/前端 = Yufei (雨飞) · 引擎核心 = Gengyue (架构最终权)
repo: https://github.com/toffemoon/ai-interactive-story (独立 repo · 卫星模式挂进 yorha-a2-team)
local: ~/Desktop/ai-interactive-story
status: 前后端共存 · 前端已 cutover 到 frontend-next · YoRHa-A2 当前主线
last-updated: 2026-07-11
upstream: ../YORHA-A2.md
working-mode: ../WORKING-MODE.md
---

> 迁自 claude-context `shared/projects/yorha-a2/sub-projects/ai-interactive-story.md`（2026-10-04 入口瘦身）。以下为原文逐字搬运；个别涉及凭据、邮箱或个人信息的地方换成了 ‹…已略› 标记，原文留在 claude-context。文中「CLAUDE.md §x」「§8 [日期]」和相对链接指旧布局，现位置查 claude-context `archive/2026-10-04-entry-slimming/MIGRATION.md`。

# 子项目 · ai-interactive-story（AI 互动故事引擎）

> **一句话**：AI 互动故事引擎。多角色卡 / 世界书 / 故事书 / 玩家卡 → 可玩的互动故事回合（叙事 + 角色发言 + 玩家选项 + 状态更新）。**是 YoRHa-A2 当前的主线产出**（2026-06-17 战略排序更新）。
>
> **owner**：内容 / 故事 / 前端 / 素材 / 部署 = 雨飞；**引擎核心逻辑（记忆 / 状态机 / 召回 / abstention / story 引擎）= Gengyue**，设计 + 合 main 都归他（2026-06-04 拍板，见 repo `decisions/2026-06-04-architecture-ownership.md`）。‹此处一句涉及具体他人的评价已略›
>
> **repo 是独立的**：用"卫星模式"挂进团队，不并进 claude-context。

## 现状（2026-07-11 增补）

- **07-10 受控 Codex 本机模式上线**（PR #150–#157）：默认仍 Render 后端 DeepSeek；获授权账户可用本机 Codex（Windows 一键桥接 + ChatGPT OAuth，凭证不进 app/Render），主故事真实 SSE；唯一超管 `SUPERADMIN_EMAIL=‹邮箱已略›`。同日 YOR-209/210 首页 + 探索页 UI/性能（主 JS 568→394 kB）。见 repo `docs/LOCAL-CODEX-PROXY.md`、`decisions/2026-07-10-browser-local-codex-proxy.md`。
- **07-11 一批（PR #158，`Fixes YOR-211`）**：①**DB 连接池防僵死硬化**（现场曾 10/10 连接 idle in transaction 僵死整站 → session 级超时 + 池参数 env 化 + 借出探活 + TCP keepalive；DB 异常统一 503；`/api/health` 1s 快速 ping + 池指标；`tests/test_db_health.py`，25 passed）；②**导航 rail 化**（桌面 icon rail + 悬停展开 StaggeredMenu，手机 PillNav）；③探索页 ShowcaseGrid 货架；④创作页 react-bits 触点。文档 `docs/2026-07-11-db-pool-hardening.md` + `docs/2026-07-11-nav-rail-and-showcase-pass.md`。
- **创作页「卡即界面」整页重做进行中**：计划已批（repo `docs/2026-07-11-create-card-canvas-plan.md`，仿 template「文档即界面」交互骨架），在分支 `gengyue/create-canvas-rework` 上跑切片 loop。
- ⚠️ **部署盲区（repo 文档未写）**：Render 该服务 **Auto-Deploy 已关**，merge 后须手动 / API 触发（service `srv-d8fq43p9rddc73ap5gh0`）。

## 现状（2026-07-08）

- **形态：前后端共存**（不是纯后端）。⚠️ 2026-06-02 的"纯后端 pivot"**已撤销** —— 当初因 spine 动态立绘渲染排查陷黑洞想删前端，实际删的是 **spine 立绘、不是前端**；Yufei 简版前端 + 后端 API 在 main 共存。
- **前端已 cutover（2026-07-08）**：主前端从旧零构建单文件 `frontend/`（React + `@babel/standalone`）**切到 `frontend-next`**（Vite + React + HashRouter），旧 `frontend/` 已删除；`src/api.py` serve `frontend-next/dist`（dist 提交进 git，main 自包含可部署）。同期收敛了 57 条前端修复分支（56 合入 + onboarding 看板 yor-205 + 发布清单 yor-192），补了 Story 服务器存档续玩 + 实时 tail 轮询。全貌见 repo `decisions/2026-07-07-frontend-next-cutover.md`。
- **技术栈**：Python 3.12 + FastAPI + **DeepSeek**（OpenAI 兼容，改 `.env` 换 provider）+ 模型适配层（DeepSeek/Claude）+ Supabase Postgres + pgvector + 本地 `bge-small-zh-v1.5` 向量记忆；前端 Vite + React。
- **进度**：建卡/识别、卡库、故事预设、故事回合引擎（状态机 + 世界时钟 + 一致性自检 + Phase 1 记忆护栏 + 流式 SSE）、记忆两模式（standard/deep）、导演 / 运营台、账户系统 + 成本熔断（prod `AUTH_ENABLED=1` / `COST_GUARD_ENABLED=1`）—— 核心闭环 + 前端 cutover 均已成，prod 有上百局真实使用。
- **两个 Supabase**：prod `hhrqxllcamdxqcoepwgx`（Render 用 / Supabase MCP 连的）vs test `yldfnbmpzkzjzjoyvfhb`（本地 `.env`；免费实例闲置会 **auto-pause**，连不上报 `tenant/user not found`，用 Management API restore 或控制台唤醒）。
- **任务追踪**：走团队 **Linear**（YoRHa workspace）；每 issue 一条 `<name>/yor-NN` 分支 → PR `Fixes YOR-NN` 挂回。
- **已知坑**：Supabase 免费实例 auto-pause；`.env` 有 DeepSeek key + DB 连接串，永不读出 / 写进任何文件。

## 定位:通往 Inception 的当前阶段(2026-07-08 转向)

⚠️ **重大转向(2026-07-08 Gengyue 拍板)**:这个引擎的**终极目标正式命名为 [Inception](inception/INCEPTION.md)** —— 把任何书的世界观推演成一个**可进入、多玩家共建、可 fork 的活世界**(每个 NPC 是独立 subagent 投影)。**当前 ai-story 引擎(单人 + 一段对话的故事生成)是通往 inception 的"中间站、手段",不是终点、远没到"做完"**;定位从"AI 互动故事引擎(工具)"升级为"可进入的世界(inception)"。设计见 [inception/DESIGN-v1.md](inception/DESIGN-v1.md);**底层只 Gengyue 本人做**,未来若分歧再拆两份、当下不拆。

**跟 YoRHa-A2 团队最终目标(咨询网站 conversion-site)的关系**:ai-story 仍是 YoRHa-A2 当前主线(2026-06-27 战略会:找 OC 用户 + 打磨 UX + token 三指标);conversion-site 是团队级终点;inception 是这条引擎线自己的北极星。将来把对话 / 记忆能力接进 conversion-site 的"AI 接初接"是后话,不阻塞。

## 治理（卫星模式）

- 工程决策放引擎 repo 自己的 `decisions/`；它跟团队 / 最终目标的战略关系放 team repo `yorha-a2-team/decisions/`。
- 引擎 repo 根有自己的 `CLAUDE.md`（双帽子：给 repo 写代码 + 守团队治理），假设父 repo clone 在 `~/Desktop/yorha-a2-team`。
- ⚠️ **引擎核心改动（记忆 / 状态机 / 召回 / abstention / story 引擎）必须经 Gengyue 审 + 压测才合 main**；内容 / 前端 / 素材 / 部署改动 Yufei 可自行迭代。

## 详情

引擎架构 / 路线在它的 repo 内（`README.md` + `decisions/` + `docs/`）。本文件只是 YoRHa-A2 视角的子项目指针，不重复引擎内部细节。前端 cutover + 分支收敛全貌见 `decisions/2026-07-07-frontend-next-cutover.md`。
