---
date: 2026-06-04
type: research-notes
作者: deep-research(103 agent / 21 源 / 22 条交叉验证)+ Claude 综合
feeds: docs/design/2026-06-04-phase3-knowledge-boundary.md
---

# 调研:每角色知识边界(per-character epistemic boundary)

支撑 Phase 3 设计。每条都经 3-vote 对抗验证(✓ 3-0 / 2-1)。

## 验证通过的核心发现

1. **问题有正式命名,我们的案例是教科书例**(✓3-0):`TimeChara`(ACL'24 Findings,10,895 实例)定义 **"point-in-time character hallucination"**,含 **"past-absence" 类型**(角色事件发生时不在场却声称知道)= **孙悟空/馒头案**。 https://arxiv.org/abs/2405.18027

2. **纯 prompt 自律无效,必须显式机制**(✓3-0):GPT-4o 在相关题型 ≤51%(zero-shot 46 / CoT 48.5 / few-shot 47 / self-refine 48),只有专门分解法到 94.5%;角色知道越界的"检测"上限 ~65%、对"熟悉(在范围)知识"还低 15%。→ 别信模型自觉。 https://arxiv.org/html/2409.11726v2 · https://aclanthology.org/2025.emnlp-main.1689

3. **最佳可落地机制 = EnigmaToM 观察者过滤召回**(✓3-0):per-character 事件/场景视图 + **null node mask 掉角色没观测的事件** + per-character "Awareness"(离场→不知场内事)。依据心理学"信念只取决于自己能获得的信息"。**直接映射我们"实体活档+按在场召回":每条事实加 witnessed_by、召回按发言角色过滤。** 注意:它只管共场感知、不管"被告知/推断";且是第三方 ToM 准确率管线、不自带 abstention。 https://arxiv.org/pdf/2503.03340

4. **形式根基 = 动态认知逻辑 DEL**(✓3-0):每 agent 自有可达关系(a 知 F ⟺ F 在 a 可达的所有世界成立);事件只在前提于 a 的世界成立时才更新其知识(product update);**非对称可观测性** = 私有事件可让一人知 p、其他人毫无变化 = 悟空被支开案。当设计词汇,非运行时(DEL 是理想化逻辑全知 agent)。 https://plato.stanford.edu/entries/dynamic-epistemic/

5. **运行时认忘(低成本,RAG式)**(✓3-0):**S2RD**(先从角色自己语料 RAG 自我回忆→自我怀疑→对越界题反驳/拒答,检测↑≥78%);**RoleRAG**(越出角色知识范围的实体→注入"无关+理由"信号劝阻幻觉,拒答 0.857 vs 0.714 vanilla)。注意 RoleRAG 的"越界"是宇宙级(实体在不在该角色宇宙)+ 软劝阻,**不解决宇宙内按见证过滤**(悟空案)→ 须配 EnigmaToM 的 witnessed_by。 https://arxiv.org/html/2409.11726v2 · https://arxiv.org/html/2505.18541v1

6. **显式 belief state 注入有因果增益**(✓3-0/2-1,medium):SynchToM(11 前沿模型)证注入 golden belief 一致涨分、打乱则降——支持"维护显式 witnessed_by 存储"而非靠隐式推断。注意:它测的是 USER belief、且证的是 oracle 注入(非自维护的近似存储)→ 仅类比支持。 https://arxiv.org/pdf/2602.13832

7. **拒答训练(重武器,押后)**(✓3-0):RLKF 教模型拒答越界(reliability 46.6→56.5,泛化优于 SFT),但有 helpfulness↔truthfulness 权衡 + 需 RL 设施 + 绝对准确率低 → **比 prompt/RAG 级认忘贵得多,低优先**。 https://arxiv.org/pdf/2403.18349

8. **别复用 RoleEval**(✓3-0):它测第三人称客观事实(属性/关系/经历),**不测"角色主观知道什么"**→ 现成工具测不了我们的需求,评测必须自建。 https://arxiv.org/html/2312.16132v1

## 被否的(0-3,别踩)
- "KKE/UKE 分类 = 本 bug 的形式化":**否**。UKE 是时代错置/出宇宙泄露(牛顿引用居里),≠ 时间线内的"在场但缺席"。别混。

## 奇奇怪怪源(3.1 参考)
- **Dwarf Fortress rumor/知识传播**(知识在角色间扩散 = "被告知"分支)。http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter41_Simulation_Principles_from_Dwarf_Fortress.pdf
- **访问控制 RAG**(按主体可见性过滤检索 = witnessed_by 过滤工程类比)。https://supabase.com/docs/guides/ai/rag-with-permissions
- **SillyTavern per-character lorebook 作用域**。https://docs.sillytavern.app/usage/core-concepts/worldinfo/

## 开放问题(Phase 3.1 / 评测)
1. 非感知知识("被告知/推断")的低成本实现——无现成解。
2. LLM-judge scope gate vs 确定性 witnessed_by 过滤在**我们 DeepSeek 中文栈**上的召回/精度/成本——所有数字来自别的模型。
3. witnessed_by 谁来标 + 长局维护成本。
4. 中文·按在场评测集怎么建 + over-abstention 目标率。
