---
date: 2026-06-03
updated: 2026-06-03
status: 实施中(去风险通过,全量对照矩阵进行中)
type: engineering-decision
作者: gengyue + Claude(Opus 4.8)
relates: docs/design/2026-06-02-deep-memory-architecture.md · docs/design/2026-06-03-phase1-plan.md · eval/STANDARD-VS-DEEP-2026-06-03.md
---

# 引擎工程决策:Phase 1 记忆修复(召回条件化 + abstention + 不回写 + 发言者门)

## 一、要解决的问题(压测打出来的,讲清楚)

跨 4 类 IP × 170 轮真跑(DeepSeek 生成 + Claude judge)+ standard/deep 对照 + 两段向量重放,定位到**三个真问题 + 一个反直觉发现**:

1. **★ abstention 失败(头号)**:问到忘了/从未建立的具体事实(价格/时刻/颜色/数字),模型**自信编一个具体假值**,而非承认不知道。两个更毒的变体:**伪造证据**(沈雾忘开价→编"七个银币"还当场翻出假账册作证)、**跨角色自我强化**(华生附和福尔摩斯编的"3点17分")。最致命的是**编造被写回记忆**→后续自相矛盾、污染 state。4 个 IP 全中。

2. **幻觉发言者**:群像/知名 IP 下,模型从**自身 IP 记忆**里凭空补出不在 roster 的角色(西游冒"沙僧"被演活 5+ 次、HSR 冒"铁砧"),污染结构化 state(xiyou state_consistency 掉到 3.4)。

3. **抽象一次性事实 ~120 轮记忆天花板**:价/时刻这类"只说过一次"的事实,长程会丢。

4. **反直觉发现**:现引擎的 deep 模式(naive 向量召回)不但没补①③,**反而更差**(记忆 standard 2/3 → deep 1/3)。两段重放钉死根因:`scan_text = 当前问句 + 最近8条消息`,问旧事那刻最近 8 条恰在聊别的,**把真值 establish 轮挤出 top4 → 没注入 → 模型空手编**。即"最需要召回旧事实时,scan_text 噪声最大"。

详见 `eval/STANDARD-VS-DEEP-2026-06-03.md`。

## 二、决策:Phase 1 四个修复(`PHASE1_FIXES` 总开关门控,off=baseline,也是 prod kill-switch)

### ① 召回 query 条件化(`src/story.py`)
具体事实查询(`_is_fact_query`)→ 召回 query 用**问句本身**(防 scan_text 稀释);含糊/指代轮 → 仍用 scan_text(这条路径**逐字节等同 baseline,结构上不可能退化**)。
- **依据**:重放证明纯问句能 rank2 命中真值 establish 轮,scan_text 把它挤出 top4。

### ② abstention 兜底 —— **CoT `recall_check`(经 5 轮迭代定型)**
**关键决策:不用相似度硬阈值,也不靠单条 prompt 指令,而用结构化 CoT。** 迭代过程(都是真跑实测):
- 硬阈值:标定发现跨 IP 分不干净(有真值 0.21~0.29 / 无真值 0.27~0.37 重叠)→ **否决**。
- 软指令:召回好但无真值照编(0% abstention)。
- 硬指令:abstention 中了但**过度拒答**(连"林末"这种真值也退回笼统的"无名")。
- 对称指令("找到就自信答、没找到就认忘,只有'没找到却编'才错"):召回恢复,但仍**概率性**(~50%)。
- **定型 = 结构化 CoT**:模型先在 `reasoning.recall_check` 写 `hit`/`miss`(分类**可靠**,实测 2/2 正确判 miss),再据此写正文;引擎用 `recall_check.startswith("miss")` 强制**不回写**。
- **目标重定义**:纯 prompt 到不了"台词零虚构"(讲故事模型天生爱加细节);真正要紧的是消除**会持久化的危害**(编造→落库→自我强化→矛盾→脏 state)。故验收用 **clean = 表态认忘 且 不落假事实 且 不伪造证据**,而非"台词一字不编"。
- 兜底:top1 余弦距离 > `MISS_DIST`(0.45)= 硬 NOT_FOUND。

### ③ 不回写编造(`src/story.py`)
事实查询且(`recall_check=miss` / 检索硬 miss / 模型已认忘)→ 丢弃本轮 `fact`/`quest` delta(叙事/event/note 保留)。**掐断"编造→落库→自我强化"**——这是②危害的根。

### ④ 发言者已知实体门(`src/story.py` `_normalize_messages`)
合法发言者 = roster(含部分名漂移归一,如 福尔摩斯→holmes)∪ 世界书/故事书**声明过的 canon**(含别名)。
- 罗伊洛特(真凶,故事书声明)/ 村姑(白骨精别名)→ **放行**,归稳定 id;
- 沙僧(本 fixture 未声明、模型 IP 记忆现编)→ **拦截丢弃**。
- 比"硬绑 roster"细一档:**不误伤涌现剧情,只拦 IP 记忆幻觉**。eval `check_speaker_validity` 同步改 canon-aware。

## 三、已验证 / 待验证

**已验证(mistport deep,去风险跑)**:记忆探针 **3/3**(含 baseline/裸deep 都栽的 落雾银锭@距离120)、**speaker 0/170**、有真值召回稳、`recall_check` 可靠判 miss、`③` 修复后假事实不再落库。

**待验证(进行中)**:`clean` 指标全量(迭代5)+ **对照矩阵**(3 fixture × {baseline, phase1} × 多种子 × 170+ 轮,`eval/matrix_run.py`,出 mean±range 前后对照)。验收线见 `docs/design/2026-06-03-phase1-plan.md §4`。

## 四、Phase 2(不在本次)
完整实体活档(结构化 delta + versioned 人格,能让向量召回在"事实记忆"上彻底降级)、知识图谱/bi-temporal 失效、embedding 选型 benchmark、演绎型角色(福尔摩斯)的"观察 vs 杜撰"更细区分。

## 五、风险与回退
- `PHASE1_FIXES=False` 一键回 baseline。
- 演绎型角色仍可能在台词里加非持久化的修饰细节(已知残留,危害低:不落库、不伪证)。
- abstention 标定参数(`MISS_DIST`)与 `recall_check` 依赖模型遵循 CoT,换模型需重测。
