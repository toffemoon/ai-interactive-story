---
date: 2026-06-02
updated: 2026-06-02
status: active
type: engineering
---

# 长期记忆架构 —— 四层记忆 + abstention(基于对标调研)

## 背景

150 轮压测(`eval/demo/hsr-longtest/FINDINGS.md`)暴露两个真问题:
1. standard 模式可靠召回具体事实只到 ~50 轮,之后大量丢事实;
2. 最危险的失败模式 —— 问到「本该知道」的角色时,模型**自信地编一个错答案(幻觉)而不是承认忘了**;而角色身份 / canon 到 110+ 轮仍稳(**人设稳、碎事实飘**)。

原向量设计(standard/deep 双模式 + turn/lm/kb 三 scope + 按上下文用量门控)被判定为「凭空设计」,需对标。为此做了一次深度调研(26 源 / 119 claim / 25 条过 3 票对抗验证,20 confirmed)。结论:**方向是对的,但缺两块能力;不必引入 Zep/Mem0/Letta 整层。**

## 调研确认(带引用)

- 「遗忘后自信编造」是学术界已命名、可单独度量的能力短板:LongMemEval(ICLR 2025, arXiv:2410.10813)把 **abstention** 列为长期记忆五大能力之一;角色扮演研究 MREval(arXiv:2603.19313)叫它 **Memory-Bounding**,与 Anchoring/Recalling/Enacting 并列、独立打分,并发现「即使召回强,Bounding 仍是关键失败模式」—— 与本项目实测一致。
- 长对话事实漂移是前沿模型通病(GPT-4o 相对 oracle 检索掉 ~30%,商用系统 37%/64%;arXiv:2410.10813)→ 堆长上下文救不了,必须上检索 / 结构化记忆。
- 「人设稳、碎事实飘」是公认现象(arXiv:2603.19313 等):无显式线索时模型无法可靠调用自己的 persona 知识,更长上下文不解决 persona drift。
- 召回 / consolidation 必须带**出处 / 归属**:Zep/Graphiti(arXiv:2501.13956)用 episode↔边双向索引让派生事实可溯源 —— 对应本项目「许给姬子」归属保住的成功案例。**但其「图谱碾压长上下文 +18.5%」效力数据本次被 0-3 否(营销、未独立复现)→ 机制可借鉴,勿迷信整层引入。**
- reflection/consolidation 不能省(Generative Agents 消融,arXiv:2304.03442,去掉 reflection 显著掉点),但写错是灾难且自我强化 → 每条 delta 强制**引用具体来源轮次**(reflection grounding, arXiv:2603.07670)。本项目「自信编造已忘事实」正是论文警告的 self-reinforcing error。
- 生产 RP 引擎(AI Dungeon、SillyTavern)的共识架构 = **滚动摘要 + 阈值/预算门控向量召回 + 关键词 lorebook 强锚 canon + 实体态(覆盖写)与场景记忆(顺序累积)分层** —— 验证了本项目按预算门控 deep 召回、分三层的方向。

## 决策:四层记忆 + 一条横切能力

| 层 | 放什么 | 存 / 召回 / 更新 | 与现状(turn/lm/kb)差异 |
|---|---|---|---|
| **① 世界 canon** | 世界书 + 故事书 | **关键词强锚为主**(已有 `_world_keyword_hits`/`_story_event_hits`)+ 向量补 flavor | kb 从「向量为主」调成 keyword-primary + 向量 secondary(hybrid) |
| **② 实体活档** | 每角色/实体当前态、versioned 人格 | **覆盖写最新态**;每条 delta **引用来源轮次** | = 进行中的 B 系列;补「引用出处」+ 矛盾失效 |
| **③ 逐轮 episodic** | 原始对话轮(保留可检索原文,**不被摘要替换**) | 向量召回(按预算/相关度门控),召回**带 provenance**(谁对谁说、第几轮) | turn 现只存 role+content → **加 addressee/实体 元数据**,让归属能召回 |
| **④ 滚动摘要** | 更早 episodic 的压缩 | **叠加层**,原文仍在底下可检索 | 现摘要会替换旧轮 → 改成「摘要在上、原文可检索在下」 |
| **横切 · abstention** | —— | 召回 miss 时给模型显式信号 + 一致性自检加一条「宁可承认遗忘、不要虚构已忘的具体名物」 | 全新,最便宜、最高 ROI,直接修最危险失败 |

**留在 Supabase Postgres + pgvector 自建**:四层全部可在现有栈实现;Zep/Graphiti 的机制(provenance 双向索引、bi-temporal 失效)借鉴实现即可,不引整层(其效力数字未被独立证实,且 DeepSeek 做边抽取/时间推理的可靠性存疑)。

## 分阶段落地

- **Phase 1(高 ROI、低成本):** ① 一致性自检加 abstention 条 + 召回 miss 信号;② turn 召回加 provenance 元数据;③ canon 走关键词强锚。**外加把 deep 模式真跑起来**(findings 里因没装 sentence-transformers 未启用)。直接修 ~50 轮天花板 + 抗幻觉。
- **Phase 2:** 实体活档(覆盖写)+ 每条 delta 引用来源轮 + 借 bi-temporal 失效做「消解矛盾不丢 canon」(pgvector 内实现)。
- **Phase 3(先验证再投):** temporal KG —— 净收益未被证据确立,先小规模 A/B 再决定,不直接上。

## 证据强度与开放问题(诚实标注)

- **强**:abstention 框架、长对话漂移普遍性、provenance 机制、reflection grounding、生产 RP 共识架构。
- **未确立**:temporal KG 比朴素长上下文更强(效力数据被 refute);纯摘要「必丢」稀有事实(因果未强证,属推断,但「保留可检索原文 > 纯摘要」有 memory-stream 设计佐证)。
- **调研没盖到、需自测**:(a) 中文 embedding 选型(现 bge-small-zh-512 vs bge-m3 / Qwen3-Embedding 的检索精度/成本);(b) 150+ 轮真实成本/延迟曲线;(c) abstention 在中文+DeepSeek 下怎么调(置信阈值 vs 召回 miss 信号 vs prompt;「拒答要 in-character、别 over-refuse」的张力)。→ 用 eval 平台实测。

## 验收与压测

本决策的验收标准与压力测试方案见 `eval/ACCEPTANCE-AND-STRESS.md`。

## 主要来源

arXiv:2410.10813(LongMemEval)· 2603.19313(MREval/Memory-Bounding)· 2603.07670(记忆综述/reflection grounding)· 2304.03442(Generative Agents)· 2501.13956(Zep/Graphiti)· AI Dungeon Memory System 官方文档 · SillyTavern World Info / Chat Vectorization / Data Bank 文档 · SillyTavern-MemoryBooks。完整带引用报告见本次 deep-research 输出。
