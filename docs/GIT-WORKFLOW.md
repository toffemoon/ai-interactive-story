---
type: git-workflow
project: ai-interactive-story
updated: 2026-10-04
---

# Git workflow（本 repo）

> 本文件内容 2026-10-04 从入口文件 CLAUDE.md 原样移入(Claude 按 owner 要求移),原是入口里的同名节;入口 [CLAUDE.md](../CLAUDE.md) 只留一句一条的摘要。文中「父 repo」指 yorha-a2-team。

镜像团队 PR-only。**2026-06-15 改 per-issue 分支(A,见父 repo `decisions/2026-06-15-tooling-linear.md`):每个 issue 一条 `<name>/yor-NN-<slug>`(Linear 建议名,复制即用)→ 默认 1 issue = 1 PR(2026-06-19 放宽:不强制,相关 / trivial 可合批),PR `Fixes YOR-NN` 自动挂回;下面示例的 `yufei` 单分支按此改成 per-issue branch。**

```bash
git checkout -b <name>/yor-NN-<slug> origin/main   # 每个 issue 一条(Linear 详情页复制建议名);旧的 git checkout yufei 单分支已废
git pull origin main --rebase
# 写代码 + commit
git add <files>
git commit -m "<type>: <message>"  # feat | fix | refactor | test | chore | docs
git push origin <name>/yor-NN-<slug>
gh pr create --base main --head <name>/yor-NN-<slug> ... # 没 open PR 才开; 有就 push 自动 add
```

> **推送前必 rebase(2026-06-07 加 · 硬规则)**:任何功能分支 —— 尤其存在几天的老分支 —— `push` 前先 `git fetch origin && git rebase origin/main`,确保 PR 始终接在最新 main 上。`git pull`(只同步本分支自己的远程)**不会**把 main 合进来,旧分支照样落后;落后的 PR 会让 Gengyue review 看不清、PR 历史对不上他的合并序列。起因:`card-templates`(PR #21)一度落后 main 36 个 commit。

主理人 (Gengyue) review 全部架构/技术层面并负责合入 main；Yufei 的内容/前端/素材/部署改动可自行迭代,但**凡碰引擎核心逻辑(记忆/状态机/召回/abstention/story 引擎)必须经 Gengyue 审 + 压测验证才合 main**。
