---
type: claude-context
audience: ai (Claude Code session 自动注入)
project: ai-interactive-story
parent: YoRHa-A2 (yorha-a2-team)
architecture_owner: gengyue
content_frontend_owner: yufei
updated: 2026-10-04
---

# CLAUDE.md — ai-interactive-story (YoRHa-A2 卫星项目)

> 你（Claude Code，跑在主理人或协作者机器上的本 repo）每次新 session 自动读本文件。
> **本 repo 是 YoRHa-A2 项目的卫星 repo** —— 既是一个独立的 AI 互动故事引擎代码库，也是 YoRHa-A2 团队生态的一员。

> **两顶帽子**：(1) 给这个引擎写代码（这是真代码 repo，你要写 / 改 / 跑 / debug）；(2) 守 YoRHa-A2 团队治理规则（读团队决策、写 team-log、走 PR、自动记忆）。

> 本文件是入口目录:只写每次都必须知道的事,其余指到对应文件,需要时自己去读。2026-10-04 按 owner 要求改成这个形式(Claude 改),移走的原文都在下面「目录」指到的文件里。

## 这个项目是什么

**AI 互动故事引擎**：多角色卡 / 世界书 / 故事书 / 玩家卡 → 可玩的互动故事回合（叙事 + 角色发言 + 玩家选项 + 状态更新）。

技术栈：Python 3.12 + FastAPI + 默认 DeepSeek / 可选玩家 Codex + Supabase Postgres/pgvector + bge-small-zh-v1.5 向量记忆 + Vite/React/HashRouter 前端。详见 [README.md](README.md)。

- **引擎主线(2026-06-27 战略会拍板)**:找 OC 用户 + 打磨 UX;token 三指标(用户数 / 总 token / 人均 token);**不加新功能**(成就系统已暂缓)。
- 当前状态(上线了什么、部署地址、Supabase prod / test)→ [docs/STATUS.md](docs/STATUS.md)(快照,真源 = 本 repo `docs/` + `decisions/`)。

## 任何新 session 第一件事

1. **读本文件** —— 你正在做
2. **确认父 repo 在本地**：`ls ~/Desktop/yorha-a2-team` —— YoRHa-A2 团队主 repo 应该 clone 在这里（平级目录）。不在 → 提示 Yufei `git clone https://github.com/yorhagengyue/yorha-a2-team.git ~/Desktop/yorha-a2-team`
3. **扫团队硬约束**：`ls ~/Desktop/yorha-a2-team/decisions/` —— YoRHa-A2 的项目宪法，本 repo 的治理决策跟它们一致
4. **扫本 repo 工程决策**：`ls decisions/`（本 repo 自己的引擎架构决策）
5. **判断你要做什么**：
   - 写引擎代码 / debug / 跑测试 → code 模式，正常写（见下方「写代码（核心）」）
   - 涉及"这个引擎跟 YoRHa-A2 的关系"的决策 → 那是 YoRHa-A2 项目级决策，写父 repo（见 [docs/TEAM-GOVERNANCE.md](docs/TEAM-GOVERNANCE.md)「决策放哪（两层）」）
   - sediment-worthy 对话 → 写 team-log 到父 repo（见 [docs/TEAM-GOVERNANCE.md](docs/TEAM-GOVERNANCE.md)「team-log 写父 repo」）

## 红线

- `.env` / DeepSeek key 永不提交、不读出、不写进文件
- `data/` 运行时数据不提交
- 不直推父 repo main / 不直推本 repo main（都走 PR）
- **架构 / 技术 / 引擎核心逻辑 = 主理人 Gengyue 决策域（设计+合 main 都归他）**;内容 / 前端方向 = Yufei;YoRHa-A2 战略 = 主理人。你实现 + 指风险,不替定

## 你（Claude）在本 repo 的姿势

**跟纯内容 repo (yorha-a2-team) 不同**：那边 Claude 不写代码、只守 framework；**这边你是真写代码的**。

### 写代码（核心）

- 这是 Yufei 的引擎，你帮他写 / 改 / 跑 / debug / 测试 / 重构
- 编辑前先 Read，跑破坏性命令前确认，不主动 git push（除非 Yufei 授权）
- `data/` 是运行时数据（gitignore），别提交
- `.env` 含 DeepSeek key，**永远不提交、不读出 key 内容、不写进任何文件**
- `_smoke_*.py` / `_validate_*.py` 是验证脚手架，跑测试时用

守 YoRHa-A2 治理(另一顶帽子)、Subagent 调用 → [docs/TEAM-GOVERNANCE.md](docs/TEAM-GOVERNANCE.md)。

## Git 流程

一句一条;细则、命令示例和来由见 [docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md)。

- 每个 Linear issue 一条分支,名字用 issue 详情页给的 `<name>/yor-NN-<slug>`;默认 1 issue = 1 PR(不强制,相关 / trivial 可合批);PR 写 `Fixes YOR-NN`。
- 推送前必 rebase:`git fetch origin && git rebase origin/main`。
- commit 类型:`feat | fix | refactor | test | chore | docs`。
- 主理人 Gengyue 负责合入 main;碰引擎核心逻辑(记忆 / 状态机 / 召回 / abstention / story 引擎)必须经 Gengyue 审 + 压测验证;内容 / 前端 / 素材 / 部署改动 Yufei 可自行迭代。

## 沟通约定

中文为主，技术术语英文 OK。短回复优先。直接给结论 + 一句理由。诚实、不讨好、可质疑。最终决定权:**架构 / 技术 / 引擎核心 = 主理人 Gengyue;内容 / 前端 = Yufei;YoRHa-A2 战略 = 主理人**。

## 目录:要做什么,读哪里

| 要做什么 | 读哪里 |
|---|---|
| 看当前状态:上线了什么、部署地址、Supabase prod / test | [docs/STATUS.md](docs/STATUS.md) |
| 跟 YoRHa-A2 的关系、决策放哪(两层)、team-log、跨 repo 约定、分工 | [docs/TEAM-GOVERNANCE.md](docs/TEAM-GOVERNANCE.md) |
| Git 细则与命令示例 | [docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md) |
| 技术栈、本地跑起来、代码结构 | [README.md](README.md) |
| 引擎工程决策 | [decisions/](decisions/)(格式见 [decisions/README.md](decisions/README.md)) |
| 给 AI / 调用方的 API 参考 | [docs/AI-API.md](docs/AI-API.md) |
| Codex 本机反代模式 | [docs/LOCAL-CODEX-PROXY.md](docs/LOCAL-CODEX-PROXY.md) |
| 记忆架构设计、升级计划、调研 | [docs/design/](docs/design/) · [docs/plans/](docs/plans/) · [docs/research/](docs/research/) |
| 某次改动的计划与过程记录 | `docs/` 下按日期命名的文件 |
| 团队硬约束 | 父 repo `yorha-a2-team` 的 `decisions/` |
