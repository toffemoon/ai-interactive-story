---
date: 2026-06-04
updated: 2026-06-04
status: 生效
type: governance-decision
作者: gengyue(主理人拍板)
supersedes: CLAUDE.md 旧条款("引擎技术层面 Yufei 自己 merge OK" / "最终决定权在 Yufei(引擎技术)")
---

# 决策:架构/技术主权归主理人 Gengyue;Yufei 负责内容与前端

## 决定

- **架构 / 技术 / 引擎核心逻辑 = 只由主理人 Gengyue 负责**:设计、技术决策、合入 main,都归 Gengyue。
  核心逻辑包括(不限于):**记忆系统(召回 / 实体活档 / consolidation / 长程)、状态机、abstention、story 引擎回合逻辑、适配器层、评测/压测平台**。
- **Yufei 负责:内容 + 前端 + 不动核心逻辑的部分** —— 故事 / 角色 / 世界书等内容、前端 UI、素材(封面等)、部署配置。这些"不会动坏核心、不会出大问题"的部分 Yufei 自行迭代。
- **铁律:任何动引擎核心逻辑的改动,必须经 Gengyue 审 + 压测数据验证,才能进 main。** 不验证不进。

## 为什么(起因)

近期 main 上出现一套**未经任何压测验证、Claude 凭空生成**的长程记忆架构(`长程记忆 A / B①②③④`:实体活档 + versioned persona + 结构化事实 + consolidation,见 `archive/yufei-memory-b234` 分支 / commit a6f910a..b7e0db1)。问题:

1. **未验证就进 main**:这套 ~700 行代码没跑过对照压测,无数据证明它真的降低幻觉 / 提升记忆,反而**每实体多跑 LLM consolidation = 加成本 + 多一处幻觉源**。
2. **与主线冲突**:它和主理人已**压测验证**的 Phase 1(abstention / 召回 query / 发言者门,matrix 实测 speaker 45→0、abstention 0→0.67~1.0)woven 在一起,导致后续 PR 撞车。
3. **重复造轮子**:它和主理人另一支未验证的实体活档实现高度重叠 —— 两套都没验证,谁都不该默认是对的。

**核心教训:架构质量靠数据验证,不靠代码量;"内容/层数更多 ≠ 更好"。** 未验证的 AI 生成架构进 main 会污染主线、增成本、难回滚。

## 怎么执行

1. **架构改动**:Gengyue 设计 → 压测(eval 矩阵 + 探针)验证有净增益 + 不崩成本/canon → 才合 main;门控开关 + 可回退优先。
2. **Yufei 的内容/前端**:自行迭代 + PR,Gengyue 轻 review(不卡内容,只看有没有误碰核心)。
3. **已进 main 的未验证架构(B②③④)**:归档到 `archive/yufei-memory-b234`(本地 + 远端),从 main 移除,改用主理人可验证的代码;**待主理人逐项 review + 压测后,值得的再正式纳入。**

## 同步
- 本 repo:本决策 + CLAUDE.md(职责边界横幅 + §1 owner + §6/§9/§10)已更新。
- 父 repo yorha-a2-team:同步一份项目级决策(引擎架构主权)。
