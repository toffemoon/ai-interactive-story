---
type: team-governance
project: ai-interactive-story
parent: YoRHa-A2 (yorha-a2-team)
updated: 2026-10-04
---

# 团队治理:本 repo 作为 YoRHa-A2 卫星项目

> 本文件的内容 2026-10-04 从入口文件 CLAUDE.md 原样移入(Claude 按 owner 要求移);入口 [CLAUDE.md](../CLAUDE.md) 只留红线、一句一条的 Git 规矩和指针。文中「本 repo」指 ai-interactive-story,「父 repo」指 yorha-a2-team;路径都相对 repo 根目录。

## 职责边界

> **⚠️ 职责边界（2026-06-04 主理人 Gengyue 拍板,见 `decisions/2026-06-04-architecture-ownership.md`）**
> - **架构 / 技术 / 记忆系统 / 引擎核心逻辑 = 只由主理人 Gengyue 负责**：设计、技术决策、合入 main 都归他;任何动核心逻辑的改动必须经 Gengyue + 压测验证才进 main。
> - **Yufei 负责:内容（故事 / 角色 / 世界书）、前端 UI、素材、部署配置等"不动核心逻辑、不会出问题"的部分。**
> - 起因:未经验证、Claude 凭空生成的架构代码（如长程记忆 B②③④）进了 main 又与主线冲突。**教训:内容更多 ≠ 更好;架构靠数据验证,不靠代码量。**

## 分工

- **架构 / 技术 / 引擎核心 Owner：Gengyue**（主理人,GitHub `yorhagengyue`）—— 记忆系统、状态机、召回、abstention 等核心逻辑的设计/决策/合入归他
- **内容 / 前端 / 素材 / 部署 开发：Yufei**（GitHub `toffemoon`）—— 故事、角色、世界书、UI、部署配置等不动核心逻辑的部分
- 在 YoRHa-A2 里的角色：**互动 AI 内容 / conversion-site "AI 接初接"对话流的候选实现**

## YoRHa-A2 是什么（父项目）

**YoRHa-A2** = 3 人内容 + 产品项目（主理人 **Gengyue**，协作者 **Yufei** + **Zicheng**）。命题：用 AI 的运作机制解释人性现象。分两 part：short-video（引流）+ conversion-site（转化）。

- 父 repo：`~/Desktop/yorha-a2-team`（GitHub `yorhagengyue/yorha-a2-team`，private）
- 父 repo 的宪法：`~/Desktop/yorha-a2-team/SETUP.md` + `~/Desktop/yorha-a2-team/CLAUDE.md`
- 父 repo 的决策目录：`~/Desktop/yorha-a2-team/decisions/`

**本 repo 怎么"挂载"在 YoRHa-A2 上**（见父 repo `decisions/2026-05-31-mount-ai-interactive-story.md`）：

- 本 repo 的**更新**（commit / PR）→ 算 YoRHa-A2 团队的进展，会推到 Slack `#yorha-a2-team`
- 本 repo 的**决策**：引擎工程决策放本地 `decisions/`；任何"这个引擎跟 YoRHa-A2 战略关系"的决策放父 repo `decisions/`
- 本 repo 的**assets**（成品 / 截图 / demo / 数据洞察）→ 算团队 asset，sediment-worthy 的写父 repo team-log 留痕
- 本 repo 的**任务 / bug / UI 问题（截图）/ 客户需求** → 走团队 **Linear**（2026-06-15 起,见父 repo `decisions/2026-06-15-tooling-linear.md`）;**每个 issue 一条独立 branch(A · Linear 建议名 `<name>/yor-NN-…`)→ 默认 1 issue = 1 PR(2026-06-19 放宽:不强制,相关 / trivial 可合批),PR 用 `Fixes YOR-NN` 自动挂回该 issue**。截图/反馈发 issue 或评论,别发 project update(Claude 读不到 update)。(团队 2026-06-15 舍弃 Excalidraw、暂缓 LibTV、改 per-issue 分支取代 name-only-branch。)

## 守 YoRHa-A2 治理（另一顶帽子）

- **走 PR 不直推 main**（镜像团队 `decisions/2026-05-28-pr-only-workflow.md`）。Yufei 的长期 branch = `yufei`
- **自动记忆**：sediment-worthy 内容（Yufei 做架构决策 / 纠正你 / 跨项目可复用洞察）主动写 team-log 到父 repo（见下文「team-log 写父 repo」），回复末尾告知
- **不 attack 项目方向**：引擎要做什么功能 / 走什么产品方向是 Yufei + 主理人的决策域，你帮实现 + 指技术风险，不替他们定方向（镜像 `decisions/2026-05-25-claude-no-attack-direction.md`）
- **attack working drafts OK**：Yufei 的半成品代码 / 设计草稿 → 多挑技术漏洞、找 edge case、追问被省略的决策。目的是打磨

## Subagent 调用

重复活 / 偏技术活 / research / 大型探索 → 多调 subagent 并行。跟 Yufei 讨论 / 创作 / review 方向 → 不调。（镜像团队 `decisions/2026-05-28-subagent-when-to-call.md`）

## 决策放哪（两层）

| 决策类型 | 放哪 | 例子 |
|---|---|---|
| 引擎工程决策 | 本 repo `decisions/` | "记忆统一进 Supabase Postgres/pgvector"、"流式用 SSE 不用 WebSocket" |
| YoRHa-A2 战略决策 | 父 repo `~/Desktop/yorha-a2-team/decisions/` | "这个引擎正式成为 conversion-site 的 AI 对话实现"、"互动故事拍成短视频系列" |

本 repo 的 `decisions/` 格式跟父 repo 一致：`YYYY-MM-DD-<slug>.md`，frontmatter `date` / `updated` / `status`，只增不改，推翻要 supersede。

判断不准是哪层 → 默认问 Yufei，或写父 repo（团队可见 > 本地隐藏）。

## team-log 写父 repo

sediment-worthy 内容（Yufei 做引擎架构决策 / 改方向 / 纠正你判断 / 跨项目洞察 / 项目重大节点）→ 写 team-log 到**父 repo**：

```bash
cd ~/Desktop/yorha-a2-team
git checkout yufei                       # Yufei 的长期 branch
git pull origin main --rebase
# 写 team-logs/yufei/YYYY-MM-DD-<slug>.md (frontmatter author: yufei)
git add team-logs/yufei/<file>
git commit -m "team-log: <简述>"
git push origin yufei                     # PR 自动更新
cd -                                      # 回到 ai-interactive-story
```

team-log 格式见父 repo `~/Desktop/yorha-a2-team/CLAUDE.md §4` + `team-logs/README.md`。写完回复末尾告知：`📝 已写 team-log: yorha-a2-team/team-logs/yufei/<file>`。

**为什么写父 repo 不写本地**：YoRHa-A2 团队记忆是统一的，主理人 git pull 父 repo 就能收 sediment。本 repo 是代码库，不存团队记忆。

## 自动记忆触发（强制，全模式 default-on）

遇到 sediment-worthy 必须主动写 team-log（见上文「team-log 写父 repo」），不等 Yufei 提醒、不先问。判定：Yufei 做架构决策 / 改方向 / 纠正你 / 确认非显然方法可行 / 跨项目可复用洞察 / 项目重大节点。写错了 Yufei 删，说"先不记"立刻停。

## 跨 repo 同步约定

- 父 repo `~/Desktop/yorha-a2-team` 保持 clone + 定期 pull（写 team-log / 读决策都靠它）
- 如果父 repo 没 clone → 提示 Yufei clone，本 session 治理动作（写 team-log）先攒着或口头告知 Yufei
- 不在本 repo 里 clone 父 repo（别嵌套），两个平级目录
