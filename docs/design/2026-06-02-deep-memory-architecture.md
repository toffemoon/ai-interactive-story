---
date: 2026-06-02
updated: 2026-06-02
status: design(待落地)
type: design
作者: gengyue + Claude(Opus 4.8)
merges: decisions/2026-06-02-memory-architecture.md(D1) · docs/design/2026-06-01-long-range-memory-architecture.md(yufei) · 跨IP压测 FINDINGS · deep-research
---

# Deep 记忆架构(完整设计)

## 背景

现引擎的 deep 模式(3-scope naive 向量:turn/lm/kb,usage≥0.80 才触发)是**凭空设计、且从未真正验证**(Supabase 暂停 + in_memory 隔离 → 向量层基本没接通)。跨 IP 压测(standard 模式,170 轮 × 4 IP)打出三个真问题:**① abstention 失败(忘了就自信编 + 伪造证据 + 跨角色自我强化)② 群像/知名 IP 冒幻觉角色 + 脏 state ③ ~120 轮抽象一次性事实记忆天花板**;而 canon/人设全员强。深调研(26 源)+ 雨飞设计独立收敛到同一套机制。本文给完整 deep 架构。

## 核心反转(thesis)

**deep 不是"上下文快满才打开的向量搜索开关",而是一套始终在线的分层记忆。** 召回**主要靠"当前在场实体"**(不是相似度碰运气);每条事实带**出处(provenance)**;引擎**要么有据回答、要么诚实弃答(绝不编)**;发言者**硬绑实体名单**。向量翻原文只是**兜底网**,不是核心。

这把现状整个倒过来:最该常开的(实体召回 + 防编 + 卡发言者)现在没做;最不该单独依赖的(相似度检索)现在当了核心。

## 一、四层记忆(存什么 · 怎么存)

| 层 | 内容 | 召回方式 | 可变性 |
|---|---|---|---|
| **① Canon(公理+上传设定)** | 世界法则("卖即忘""唐僧凡胎")+ 卡/世界书/故事书静态基线 | **关键词强锚**(`_world_keyword_hits`/`_story_event_hits`)+ 向量补 flavor | 公理不可变(抗漂移锚);只作者改 |
| **② 实体活档(每实体一份)** ★核心缺失层 | 静态基线 + append-only delta 日志 + versioned 人格指针 | **按在场实体取**(present + 地点 + 命中条目),非相似度 | delta 累积;人格整块换版本 |
| **③ Episodic(原文轮)** | 每轮原文 + provenance(谁对谁说/第几轮/涉及实体) | 向量召回,按预算/相关度门控,max_turn 限 | 只增不删(原文永不被摘要替换) |
| **④ Summary + 历史书** | 更早轮的滚动摘要(叠加非替换)+ 大事件防弹脊柱 | 常驻导航,不当唯一真相源 | 周期重算 |

**delta 记录格式**:`{entity, 类型(设定/事实), text, source_turn(s), 置信, 状态(生效/已取代)}`。
- **两条正交轴**:类型轴(设定=往后行为规则变了→进 canon 长留;事实=发生了什么→可淡出、常是某设定的出处)管"怎么用多久";**实体轴管"取不取得到"——召回靠实体轴**。现引擎有类型轴(`_extract_long_memory` 的 kind),缺 entity 字段 + 按实体召回路径。

## 二、读路径(每轮注入 · 按预算排序)

关键词命中 canon → **在场实体活档(设定优先)** → 近期 recap(L1)→ 摘要+历史书脊柱(L2)→ **针对具体事实的向量召回(带出处,L3)**。L3 结果直接喂 abstention 判定(见三)。

要点:实体活档召回**常开**(便宜,被 scene 大小限界,与故事长度无关 → 绕开 O(n²));向量召回(L3)才按预算门控。所以"standard vs deep"的二元被取消——**实体层 + abstention + 发言者约束始终在,向量召回是可门控的增强**。

## 三、三个横切护栏(对症压测三失败)

1. **★ abstention(头号):** 玩家问具体事实 → 引擎先检索(实体 delta + 向量翻原文)。**有据**→注入(带出处)→照实答;**无据(检索 miss)**→注入显式 `NOT_FOUND` 信号 + 指令"in-character 承认不记得,绝不编具体名物"。两个关键:① 只对"具体事实查询"触发(别 over-refuse 伤沉浸);② **被判 abstention 的回合,绝不把编的内容写回实体层**(掐断自我强化——"七个银币"永不成 delta)。依据:OpenAI 显式置信度 + 空检索硬信号 + LongMemEval abstention。

2. **发言者硬绑(最便宜最干净):** 归一化时,不在名单(按实体,含别名)的发言者直接丢/重归属——把现有 speaker 检查从"只发现"改成"拦截"。**别名↔真身映射**:白骨精登记别名"村姑"绑到 baigujing → 村姑合法出场、state 记真身,既不算幻觉也不脏 state。依据:character hallucination 是约束问题非知识问题,RAG 无效(RoleBreak/RoleFact);发言者约束把 TimeChara 46%→95.5%。可叠 FSM 式 next-speaker 调度。

3. **世界公理生成时拒(雨飞):** 违背不可变公理的玩家行动,**生成时**用世界内逻辑反制(hard_violation→world_counter),不事后审计 → 把贵的抽象矛盾检测降成便宜的生成时预防。

## 四、写路径(consolidation · 把贵活挪出热路径)

三层触发(雨飞):
1. **每轮即时**(便宜):`_store_memory_writes` 写带 entity 标签的 note,立刻可按实体召回(补"连续游玩"的洞)。
2. **事件触发**(高信号):story event resolved 时,对受影响实体跑小巩固(note→结构化 delta)。
3. **回来批量**(提质):用 `updated_at` 差检测"用户回来了"(无状态后端盯不住钟),批量精炼 + 矛盾消解,水位 `consolidated_upto`。

**铁律**:
- **每条 delta 必须引 `source_turn`**(reflection grounding,防 consolidation 自己编)。
- 矛盾用 **bi-temporal 失效**:新 delta 与旧冲突 → 旧标"已取代"(记失效轮),**不删,留历史**(non-lossy)。
- 人格**只整块换版本**(作者谓词或高闸门 consolidation 提议,需跨 N 轮证据),**不逐轮 delta 改**;OOC 对照**当前已提交版本**(版本间冻住),不对活值。

## 五、存储 · 跟现有三套的关系

- **存储**:全在 pgvector/Supabase 自建。借 Graphiti 的**机制**(出处双向索引 + bi-temporal 失效)但**不引整层**(其效力未独立证实 + DeepSeek 做图谱边抽取可靠性存疑)。embedding 现 bge-small-zh-512,中文选型(vs bge-m3/Qwen3-Embedding)待 benchmark。
- **现引擎 deep**:留 kb 关键词锚 + turn 原文存储;"naive 向量当答案"→"实体召回为主、向量为辅";实体/abstention 从 0.80 门控→**常开**。
- **雨飞设计**:几乎全盘采纳(实体活档/三层 consolidation/versioned 人格/公理不可变)。
- **D1**:本文是 D1 四层+abstention 的完整化,嵌入雨飞实体机器 + 补两块压测发现(abstention 护栏 + 发言者硬绑/别名)。

## 六、Deep 最终验收标准(必须跑赢 standard 才算"有提升")

度量全部用 `eval/` 平台,同一批 fixture(mistport_deep/sherlock/xiyou)跑 **standard vs deep**,deep 要在不牺牲 canon/结构的前提下显著改善记忆与抗幻觉:

| 验收项 | standard 现状(已测) | **deep 目标** | 判据 |
|---|---|---|---|
| **抽象一次性事实留存**(价/时刻 距离≥100) | mistport/sherlock 距离120 忘 | **召回率 ≥ standard + 显著提升**(目标距离≤150 ≥60%) | check_memory_probes 留存率 |
| **★ abstention 虚构次数** | 4 IP 全失败(编+伪证+自我强化) | **= 0**(召回到则答,召不到则 in-character 认) | 人工/judge 判 query 轮:有无自信编造 |
| **幻觉发言者** | xiyou 11 / sherlock 1 | **= 0**(发言者硬绑+别名) | check_speaker_validity |
| **state 一致**(群像) | xiyou 3.4 | **≥ 4.5**(无非 roster 实体滞留) | state_consistency |
| **canon/人设**(不退化) | 强(全守) | **持平,不因 deep 退化** | judge canon_fidelity/character_voice ≥ standard |
| **成本/延迟** | ~$0.9/170 轮 | **可接受上浮**(向量召回 + consolidation 的额外开销量化) | 引擎+embedding+consolidation token/时延 |

**通过线**:deep 在"抽象事实留存"和"abstention 虚构=0"上明显赢 standard,且 canon/结构/成本不崩。**任一退化(尤其 canon 掉、成本爆)= deep 这版不合格,回炉。**

## 七、验证方法 + 实测结论(空白已填:`eval/STANDARD-VS-DEEP-2026-06-03.md`)

做法:deep 真生效(直连 Supabase pgvector + 预热 bge + 召回门控降到 0.45 常开),mistport/sherlock 同 fixture 各 170 轮跑 standard vs deep。

**结论(2026-06-03):这版裸向量 deep 不合格——给了最好机会仍在每个要紧维度持平或更差,且贵 13~14%。**

| | mistport std→deep | sherlock std→deep |
|---|---|---|
| 记忆探针 | 2/3 → **1/3** | 2/3 → **1/3** |
| abstention(150/165) | 编 → **仍编**(换个假值) | 编 → **仍编** |
| 引擎成本 | $0.85 → $0.96 | $0.83 → $0.94 |
| speaker/state | 0·5.0 → 0·5.0 | 1·5.0 → 64·3.98† |

**根因(两段向量重放坐实)**:① 纯 query 能 rank2 召回真值 establish 轮 → **检索是好的**;② 但 story.py 真实 query=`action+messages[-8:]`,被近期场景主导 → 真值被挤出 top4 → **没注入** → 模型拿不到事实就自信编 + 写回。即**最该召回旧事实的时刻,scan_text 噪声最大**。(†罗伊洛特 64 含玩家路径放大,见 FINDINGS。)

这正好实证本设计的必要性:**召回必须实体锚定(非近期文本相似度)+ abstention NOT_FOUND 兜底(召回 miss 强制认忘)+ 不回写编造 + 出处化注入(别再"不要照抄")+ 发言者硬绑**。近期可先验证一个便宜修法:scan_text 改纯问句/实体锚 重跑,看 150 轮探针能否翻绿——但补不了"真没有时仍会编",那需要 abstention 横切。**Phase 1 = abstention + 召回query/注入改造,而非继续堆裸向量。**
