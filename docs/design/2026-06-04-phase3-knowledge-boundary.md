---
date: 2026-06-04
updated: 2026-06-04
status: plan(待实施)
type: design
作者: gengyue(架构 owner)+ Claude(Opus 4.8)
依据: deep-research(TimeChara ACL24 / EnigmaToM ACL25 / RoleRAG·S2RD / DEL / Dwarf Fortress rumor / access-control RAG)· xiyou 压测根因 · 实体活档 A(0f579e0)· Phase 1 abstention
---

# Phase 3 设计:每角色知识边界(per-character epistemic boundary)

## 一、问题(精确定义)

**叙事真相(omniscient ground truth)≠ 单个角色的知识(what THIS character witnessed / was told / can infer)。** 现引擎按"在场实体"召回挂在实体身上的事实,但**不区分"哪个角色其实知道这条"**。

实测翻车(xiyou):玩家问孙悟空"那妖怪篮子里几个馒头",**悟空当时被支开、根本没在场**,却"回忆"出具体内容——叙事里(全知)建立过,但**这个角色没有获得它的途径**。

**调研确认这是有正式命名、仍未被现成工具解决的问题**:
- `TimeChara`(ACL'24)叫 **"point-in-time character hallucination"**,其 **"past-absence" 类型 = 本案**(角色事件发生时不在场却声称知道)。
- 实测**纯 prompt 让模型自律无效**(GPT-4o 这类题 ≤51%)→ **必须显式机制**(印证 Phase 1 教训)。
- 形式根基 = **动态认知逻辑 DEL**:每个 agent 有自己的可达关系,事件只在其前提在该 agent 世界成立时才更新其知识(product update),**非对称可观测性** = "悟空被支开→不更新→无法获知",尽管全知真相已建立。(当设计词汇,不当运行时。)
- 现成 benchmark(RoleEval)**测不了**这个(它测第三人称客观事实,非"角色主观知道什么")——**评测得自建**。

## 二、核心设计:witnessed_by + 按发言角色过滤 + 没见证就认忘

直接搬 **EnigmaToM(ACL'25)的"观察者过滤召回"**,落到我们"实体活档 + 按在场召回 + Phase1 abstention"上:

### 数据模型(在 A 的 long_memory 事实项上加一字段)
A 现状每条事实 = `{kind, text, importance, entity, derived, superseded}`。**加 `knowers: list[str]`**(知道这条的角色规范键集合)。
- **canon/上传设定**(角色卡/世界书)= 公共知识,**不进 knowers 过滤**(人人知道;`public`)。
- **玩出来的派生事实**(derived=True,进 long_memory)= **受 knowers 约束**。

### 写路径(谁"知道"——自动、确定性)
事实落库时(`_store_memory_writes`),`knowers` = **该轮在场实体**(`state.scene.present_characters` / `data["_present"]`)+ 玩家(若涉及)。
- **见证 = 共场**:在场即见证(EnigmaToM 的 co-location 掩码)。
- **被告知 = 共场的特例**:A 当着 B 的面说出 X → B 在场 → B 自动进 knowers。**所以"场内被告知"被共场覆盖**,不用额外检测。
- **离场自动失效**:knowers 取的是"建立那刻的在场集",离场的角色自然不在里头(EnigmaToM 的 awareness 更新自动满足)。

### 读路径(按"当前发言角色"过滤——EnigmaToM mask)
每轮注入时,对**在场的每个角色 C**,只注入 **C ∈ knowers 的派生事实**(+ 全部 canon 公共事实)。即从 A 的"按实体召回"升级为**"按发言角色的知识召回"**(per-character 知识块)。C 没见证的事实对 C **mask 掉**。

### 认忘(没见证就诚实不知——扩展 Phase 1)
玩家问角色 C 一个具体事实,C 的知识块里没有(C ∉ knowers)→ 走 **Phase 1 的 abstention**(recall_check=miss → in-character"我当时不在场 / 我不知道",绝不编)。**= Phase1 abstention 从"没记录"扩到"不是你的记录"**。叠加 RoleRAG/S2RD 的"超范围→注入理由→认忘"。

### 为什么这套适配我们(且低成本)
- **确定性**:knowers 是集合过滤,不像 RoleRAG 要额外 LLM 判断 scope → ~0 额外 token。
- **长在现有件上**:knowers 写自 `present_characters`(已track)、事实来自 A 实体活档、认忘来自 Phase1 —— 三块都已在,只加一个字段 + 一层过滤。
- **可回退**:`PHASE3_KNOWERS` 开关门控,off = 回 A 的"按实体召回"。

## 三、范围:3.0(做)vs 3.1(押后)

**Phase 3.0(本次)**:共场=知道 的 knowers + 按发言角色过滤 + 没见证认忘。覆盖绝大多数(在场/缺席)。
**Phase 3.1(押后,调研明确的难点)**:**非感知知识**——
- **场外被告知 / 转述**(A 私下告诉 C,或留信)——共场覆盖不了;参考 **Dwarf Fortress 的 rumor 传播**(知识在角色间扩散)。
- **可推断**(C 没见证但能合理推理出)。
这两支没有低成本现成解,且容易过度复杂化,故 3.0 先做确定性的共场版,3.1 按需再排。

## 四、压力测试过程

**自建中文·按在场知识边界测试集**(调研指出 RoleEval 测不了,必须自建):

### 知识边界探针(新探针类型 `knowledge_boundary_probes`)
每条探针 = 一个"在场/缺席"对照:
1. **establish**:在场角色集 P 见证某事实 F(某角色 A∈P 在场,某角色 B∉P **被支开/不在场**)。
2. **witness-query**:稍后问**在场过的 A**关于 F → **期望 A 答对**(不该过度认忘)。
3. **absent-query**:问**缺席的 B**关于 F → **期望 B 认忘**("我当时不在/不知道"),**绝不编**。

放进 fixtures(重点 **xiyou 群像**——把"悟空被支开→问悟空篮子内容"这个真实翻车做成探针;再加 sherlock/mistport 的在场/缺席对照)。

### 对照矩阵
`baseline(无知识边界=当前 A)` vs `phase3(knowers 过滤)` × 3 fixture × ≥2 种子 × 170+ 轮,沿用 `matrix_run`。新增 `check_knowledge_boundary`。

### check_knowledge_boundary 判定
- **absent-abstain**:缺席角色被问 → 回复含认忘标记 / recall_check=miss、**不含 F 的具体值**。
- **witness-recall**:在场角色被问 → 回复**含 F 的具体值**(没被过度 mask)。
- **over-abstention 守卫**:在场角色**不该**对自己知道的事认忘(测 helpfulness↔truthfulness 权衡,调研明确的风险)。

## 五、可验证验收标准

| 验收项 | baseline(当前 A)预期 | **Phase 3 目标** | 判据 |
|---|---|---|---|
| **★ 缺席角色认忘**(没见证就不知) | ~0(照编,= 悟空翻车) | **≥ 0.8**(缺席被问→认忘、不编具体值) | check_knowledge_boundary absent-abstain |
| **在场角色召回**(不过度认忘) | 高 | **≥ baseline**(知道的照答,**不因过滤回退**) | witness-recall |
| over-abstention(误拒守卫) | — | 在场角色对已知事实**误认忘率 ≤ 5%** | witness-recall 反指标 |
| Phase 1 abstention(无真值) | 已达标 | **不退化** | check_abstention |
| Phase 1/2 记忆 + #2 矛盾 + speaker | 已达标 | **不退化** | 既有探针 |
| 成本 | 基线 | **持平**(knowers 纯集合过滤,无额外 LLM) | token 统计 |

**通过线**:**缺席认忘 ≥0.8 且 在场召回不回退(误拒 ≤5%)**,且 Phase 1/2 全不退化、成本持平。**核心是同时拿下"该认忘的认忘"和"该答的还答"——只做到一头(全认忘/全答)= 不合格。**

## 六、分阶段落地

1. **3.0-a 写路径**:long_memory 事实加 `knowers`(= 建立轮在场实体 + 玩家);`PHASE3_KNOWERS` 门控。单测:在场进 knowers、缺席不进。
2. **3.0-b 读路径**:按发言角色过滤注入(per-character 知识块,canon 不过滤)。单测:缺席角色拿不到该事实。
3. **3.0-c 认忘衔接**:缺席被问 → 复用 Phase1 abstention(没见证=miss)。
4. **3.0-d 评测**:`knowledge_boundary_probes` + `check_knowledge_boundary`;xiyou 悟空案做成探针。
5. **压测对照** baseline vs phase3 → 出数 → 对验收线。
6. (3.1)被告知/转述/推断,按需再排。

## 七、风险
- **over-abstention**(调研明确):过滤太狠→角色对该知道的也认忘。靠"在场召回不回退"验收项守 + knowers 自动取在场(不漏真在场的)。
- **knowers 标注质量**:依赖 `present_characters` 准确;模型自由文本地点/在场可能不准 → 用受限实体词表(A 已有)归一兜底。
- **场外被告知**漏判(3.1):3.0 共场版会把"私下被告知"误判成不知 → 偏保守(宁可认忘),可接受;3.1 再补。
- 换模型需重测(abstention 依赖模型遵循指令)。
