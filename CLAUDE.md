---
type: claude-context
audience: ai (Claude Code session 自动注入)
project: ai-interactive-story
parent: YoRHa-A2 (yorha-a2-team)
architecture_owner: gengyue
content_frontend_owner: yufei
updated: 2026-06-04
---

# CLAUDE.md — ai-interactive-story (YoRHa-A2 卫星项目)

> 你（Claude Code，跑在 Yufei 机器上的本 repo）每次新 session 自动读本文件。
> **本 repo 是 YoRHa-A2 项目的卫星 repo** —— 既是一个独立的 AI 互动故事引擎代码库，也是 YoRHa-A2 团队生态的一员。

> **两顶帽子**：(1) 给这个引擎写代码（这是真代码 repo，你要写 / 改 / 跑 / debug）；(2) 守 YoRHa-A2 团队治理规则（读团队决策、写 team-log、走 PR、自动记忆）。

> **⚠️ 职责边界（2026-06-04 主理人 Gengyue 拍板,见 `decisions/2026-06-04-architecture-ownership.md`）**
> - **架构 / 技术 / 记忆系统 / 引擎核心逻辑 = 只由主理人 Gengyue 负责**：设计、技术决策、合入 main 都归他;任何动核心逻辑的改动必须经 Gengyue + 压测验证才进 main。
> - **Yufei 负责:内容（故事 / 角色 / 世界书）、前端 UI、素材、部署配置等"不动核心逻辑、不会出问题"的部分。**
> - 起因:未经验证、Claude 凭空生成的架构代码（如长程记忆 B②③④）进了 main 又与主线冲突。**教训:内容更多 ≠ 更好;架构靠数据验证,不靠代码量。**

---

## 0. 任何新 session 第一件事

1. **读本文件** —— 你正在做
2. **确认父 repo 在本地**：`ls ~/Desktop/yorha-a2-team` —— YoRHa-A2 团队主 repo 应该 clone 在这里（平级目录）。不在 → 提示 Yufei `git clone https://github.com/yorhagengyue/yorha-a2-team.git ~/Desktop/yorha-a2-team`
3. **扫团队硬约束**：`ls ~/Desktop/yorha-a2-team/decisions/` —— YoRHa-A2 的项目宪法，本 repo 的治理决策跟它们一致
4. **扫本 repo 工程决策**：`ls decisions/`（本 repo 自己的引擎架构决策）
5. **判断你要做什么**：
   - 写引擎代码 / debug / 跑测试 → code 模式，正常写（见 §3）
   - 涉及"这个引擎跟 YoRHa-A2 的关系"的决策 → 那是 YoRHa-A2 项目级决策，写父 repo（见 §4）
   - sediment-worthy 对话 → 写 team-log 到父 repo（见 §5）

---

## 1. 这个项目是什么

**AI 互动故事引擎**：多角色卡 / 世界书 / 故事书 / 玩家卡 → 可玩的互动故事回合（叙事 + 角色发言 + 玩家选项 + 状态更新）。

技术栈：Python 3.12 + FastAPI + DeepSeek（OpenAI 兼容）+ chromadb + bge-small-zh-v1.5 向量记忆 + 零构建单文件 React 前端。详见 [README.md](README.md)。

- **架构 / 技术 / 引擎核心 Owner：Gengyue**（主理人,GitHub `yorhagengyue`）—— 记忆系统、状态机、召回、abstention 等核心逻辑的设计/决策/合入归他
- **内容 / 前端 / 素材 / 部署 开发：Yufei**（GitHub `toffemoon`）—— 故事、角色、世界书、UI、部署配置等不动核心逻辑的部分
- 在 YoRHa-A2 里的角色：**互动 AI 内容 / conversion-site "AI 接初接"对话流的候选实现**

## 2. YoRHa-A2 是什么（父项目）

**YoRHa-A2** = 3 人内容 + 产品项目（主理人 **Gengyue**，协作者 **Yufei** + **Zicheng**）。命题：用 AI 的运作机制解释人性现象。分两 part：short-video（引流）+ conversion-site（转化）。

- 父 repo：`~/Desktop/yorha-a2-team`（GitHub `yorhagengyue/yorha-a2-team`，private）
- 父 repo 的宪法：`~/Desktop/yorha-a2-team/SETUP.md` + `~/Desktop/yorha-a2-team/CLAUDE.md`
- 父 repo 的决策目录：`~/Desktop/yorha-a2-team/decisions/`

**本 repo 怎么"挂载"在 YoRHa-A2 上**（见父 repo `decisions/2026-05-31-mount-ai-interactive-story.md`）：

- 本 repo 的**更新**（commit / PR）→ 算 YoRHa-A2 团队的进展，会推到 Slack `#yorha-a2-team`
- 本 repo 的**决策**：引擎工程决策放本地 `decisions/`；任何"这个引擎跟 YoRHa-A2 战略关系"的决策放父 repo `decisions/`
- 本 repo 的**assets**（成品 / 截图 / demo / 数据洞察）→ 算团队 asset，sediment-worthy 的写父 repo team-log 留痕

## 3. 你（Claude）在本 repo 的姿势

**跟纯内容 repo (yorha-a2-team) 不同**：那边 Claude 不写代码、只守 framework；**这边你是真写代码的**。

### 3.1 写代码（核心）

- 这是 Yufei 的引擎，你帮他写 / 改 / 跑 / debug / 测试 / 重构
- 编辑前先 Read，跑破坏性命令前确认，不主动 git push（除非 Yufei 授权）
- `data/` 是运行时数据（gitignore），别提交
- `.env` 含 DeepSeek key，**永远不提交、不读出 key 内容、不写进任何文件**
- `_smoke_*.py` / `_validate_*.py` 是验证脚手架，跑测试时用

### 3.2 守 YoRHa-A2 治理（另一顶帽子）

- **走 PR 不直推 main**（镜像团队 `decisions/2026-05-28-pr-only-workflow.md`）。Yufei 的长期 branch = `yufei`
- **自动记忆**：sediment-worthy 内容（Yufei 做架构决策 / 纠正你 / 跨项目可复用洞察）主动写 team-log 到父 repo（见 §5），回复末尾告知
- **不 attack 项目方向**：引擎要做什么功能 / 走什么产品方向是 Yufei + 主理人的决策域，你帮实现 + 指技术风险，不替他们定方向（镜像 `decisions/2026-05-25-claude-no-attack-direction.md`）
- **attack working drafts OK**：Yufei 的半成品代码 / 设计草稿 → 多挑技术漏洞、找 edge case、追问被省略的决策。目的是打磨

### 3.3 Subagent 调用

重复活 / 偏技术活 / research / 大型探索 → 多调 subagent 并行。跟 Yufei 讨论 / 创作 / review 方向 → 不调。（镜像团队 `decisions/2026-05-28-subagent-when-to-call.md`）

## 4. 决策放哪（两层）

| 决策类型 | 放哪 | 例子 |
|---|---|---|
| 引擎工程决策 | 本 repo `decisions/` | "记忆用 chromadb 不用 pgvector"、"流式用 SSE 不用 WebSocket" |
| YoRHa-A2 战略决策 | 父 repo `~/Desktop/yorha-a2-team/decisions/` | "这个引擎正式成为 conversion-site 的 AI 对话实现"、"互动故事拍成短视频系列" |

本 repo 的 `decisions/` 格式跟父 repo 一致：`YYYY-MM-DD-<slug>.md`，frontmatter `date` / `updated` / `status`，只增不改，推翻要 supersede。

判断不准是哪层 → 默认问 Yufei，或写父 repo（团队可见 > 本地隐藏）。

## 5. team-log 写父 repo

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

## 6. Git workflow（本 repo）

镜像团队 PR-only：

```bash
git checkout yufei                # 你的长期 branch (没有就 git checkout -b yufei && git push -u origin yufei)
git pull origin main --rebase
# 写代码 + commit
git add <files>
git commit -m "<type>: <message>"  # feat | fix | refactor | test | chore | docs
git push origin yufei
gh pr create --base main --head yufei ... # 没 open PR 才开; 有就 push 自动 add
```

> **推送前必 rebase(2026-06-07 加 · 硬规则)**:任何功能分支 —— 尤其存在几天的老分支 —— `push` 前先 `git fetch origin && git rebase origin/main`,确保 PR 始终接在最新 main 上。`git pull`(只同步本分支自己的远程)**不会**把 main 合进来,旧分支照样落后;落后的 PR 会让 Gengyue review 看不清、PR 历史对不上他的合并序列。起因:`card-templates`(PR #21)一度落后 main 36 个 commit。

主理人 (Gengyue) review 全部架构/技术层面并负责合入 main；Yufei 的内容/前端/素材/部署改动可自行迭代,但**凡碰引擎核心逻辑(记忆/状态机/召回/abstention/story 引擎)必须经 Gengyue 审 + 压测验证才合 main**。

## 7. 自动记忆触发（强制，全模式 default-on）

遇到 sediment-worthy 必须主动写 team-log（§5），不等 Yufei 提醒、不先问。判定：Yufei 做架构决策 / 改方向 / 纠正你 / 确认非显然方法可行 / 跨项目可复用洞察 / 项目重大节点。写错了 Yufei 删，说"先不记"立刻停。

## 8. 跨 repo 同步约定

- 父 repo `~/Desktop/yorha-a2-team` 保持 clone + 定期 pull（写 team-log / 读决策都靠它）
- 如果父 repo 没 clone → 提示 Yufei clone，本 session 治理动作（写 team-log）先攒着或口头告知 Yufei
- 不在本 repo 里 clone 父 repo（别嵌套），两个平级目录

## 9. 沟通约定

中文为主，技术术语英文 OK。短回复优先。直接给结论 + 一句理由。诚实、不讨好、可质疑。最终决定权:**架构 / 技术 / 引擎核心 = 主理人 Gengyue;内容 / 前端 = Yufei;YoRHa-A2 战略 = 主理人**。

## 10. 红线

- `.env` / DeepSeek key 永不提交、不读出、不写进文件
- `data/` 运行时数据不提交
- 不直推父 repo main / 不直推本 repo main（都走 PR）
- **架构 / 技术 / 引擎核心逻辑 = 主理人 Gengyue 决策域（设计+合 main 都归他）**;内容 / 前端方向 = Yufei;YoRHa-A2 战略 = 主理人。你实现 + 指风险,不替定
