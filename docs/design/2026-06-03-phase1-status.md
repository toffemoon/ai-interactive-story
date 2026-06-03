---
date: 2026-06-03
status: 进行中(去风险通过,全 IP 对照矩阵跑中)
type: status / 自评
作者: gengyue + Claude(Opus 4.8)
relates: decisions/2026-06-03-phase1-memory-fixes.md · docs/design/2026-06-03-phase1-plan.md · eval/STANDARD-VS-DEEP-2026-06-03.md
---

# Phase 1 当前状态自评(诚实版)

> 关键区分:**在去风险 fixture(mistport)上验证了** ≠ **全 IP 证明了**。后者正由对照矩阵在跑。

## 一、问题解决到什么程度

| 原始问题 | 修法 | 状态 | 证据 |
|---|---|---|---|
| **③ 远距抽象事实记忆天花板(~120轮)** | ① 召回 query 条件化 | **已解决** | mistport 召回 3/3,含 baseline/裸deep 都栽的 落雾银锭@距离120 |
| **裸 deep 反而更差(scan_text 稀释)** | 同 ① | **已解决** | 两段向量重放钉死根因 + 条件化修复 |
| **② 忘了就编 + 写回记忆(头号)** | ② CoT `recall_check` + ③ 不回写 | **去风险达标,仅 1 IP** | mistport(iter5)clean 2/2、落假事实 0、recall_check 可靠判 miss;**有一个已知残留(见二)** |
| **① 幻觉发言者** | ④ 已知实体门 | **机制证明,群像活测未跑** | 单测沙僧拦/罗伊洛特放行/id 漂移归一 + mistport speaker 0/114;西游(沙僧)170 轮真跑待矩阵 |

**一句话:去风险 fixture 上四修复全中;"全 IP 都成立"尚未证明(矩阵在跑)。**

## 二、两个已知/预判的残留(还需迭代)

**㈠ 演绎型角色的 abstention 残留(已观测)。** 福尔摩斯这种"一眼看穿你"的角色,问"我外套什么颜色",他不会说"记不清"(不像他),会**演绎/观察一个出来**(早期 sherlock 跑实测到)。本设计的指令针对"记忆型"角色(沈雾查账)很干净,对"观察型"会被演绎绕过。**危害比 baseline 低**(不伪证、大概率不落库 → 不持久化),但不是干净的"=0"。Phase 1.x 需专门区分"据现场可观察证据推断" vs "杜撰未发生的过去"。

**㈡ 西游群像 speaker/state(待矩阵)。** ④ 单测过,但沙僧诱饵在 170 轮真跑里能否拦干净、state_consistency 能否从 3.4 回到 ≥4.5,要矩阵数据。

## 三、待验证 / 待办

- **对照矩阵**(进行中):3 fixture × {baseline, phase1} × 2 种子 × 170 轮,`eval/matrix_run.py`,出 mean±range 前后对照。seed0 先出 → 首份完整三 IP 对照。
- **多种子**:现 n=1~2,精确 pass 率(尤其 speaker/state 这类路径敏感项)需 ≥3 种子。
- **Phase 2(未动)**:完整实体活档(结构化 delta + versioned 人格,可让向量召回在"事实记忆"上彻底降级)、知识图谱/bi-temporal 失效、embedding 选型 benchmark。

## 四、结论

不是"全解决了",而是 **"去风险全中、全 IP 验证在跑、两处残留已预判"**。矩阵回来后:要么确认 Phase 1 全 IP 成立(则可 merge),要么把㈠㈡变成实锤、指明下一轮迭代。**在此之前 PR 保持 open、不 merge。**

> 本文随矩阵结果更新(回填 baseline-vs-phase1 对照表)。
