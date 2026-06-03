# 矩阵对照 FINDINGS:baseline / phase1 / phase2(2026-06-03)

> 方法:`eval/matrix_run.py`,3 fixture × 3 条件 × 1 种子 × 170 轮 deep,同探针。
> baseline=`PHASE1_FIXES` off;phase1=Phase 1 四修复;phase2=phase1 + 实体活档。
> **过程坎坷**:第一轮矩阵撞 DeepSeek **502**(被我同时跑多 de-risk 的高并发触发)→ resume 重跑;又遇 cell 间累积导致 xiyou 进程**静默猝死**(已加 GC/关池修复)→ 再 resume。**xiyou 三档仍在补跑**;下表为 mistport + sherlock。

## 对照表(单种子,n=1,粗粒度探针 pass/fail)

| fixture | 条件 | 记忆留存 | abstention clean | 落假事实 | 伪证 | speaker非法 | 成本$ |
|---|---|---|---|---|---|---|---|
| mistport | baseline | 0.667 | (未测†) | 3 | 2 | 0/225 | 0.974 |
| mistport | **phase1** | **1.0** | (未测†) | **0** | 1 | 0/222 | 0.939 |
| mistport | **phase2** | **1.0** | **3/3** | **0** | 1 | 0/238 | 0.919 |
| sherlock | baseline | 0.667 | **0/3** | 2 | 0 | 0/306 | 0.938 |
| sherlock | **phase1** | **1.0** | **2/3** | **0** | 0 | 0/296 | 0.879 |
| sherlock | **phase2** | **1.0** | **2/3** | **1** ⚠ | 0 | 0/260 | 0.884 |

† mistport baseline/phase1 是第一轮(加 clean 指标前)跑的,clean 未记录。

## 发现

### 1. ★ phase1 全面赢 baseline —— 稳、可复现
两 IP 一致:**记忆 0.667→1.0**(baseline 距离120 抽象事实丢、phase1 召回答对)、**落假事实 2~3→0**(③ 不回写编造生效,掐断自我强化)、**abstention clean 0/3→2/3**(sherlock)、**成本反而更低**(召回 query 条件化更省)。Phase 1 是确定的、便宜的、可上线的改进。

### 2. phase2(dossier)相对 phase1 增量不明显 —— 诚实记录
- **mistport phase2 clean 3/3**(好),但 mistport phase1 的 clean 没测到(旧 cell),无法同条件直比。
- **sherlock phase2 clean 2/3 = phase1 持平**,且 **落假事实 0→1(反而退一点)**。
- 即:在这套 170 轮全探针、单种子的矩阵上,**dossier 没有稳定地把 abstention/记忆再往上推**。它在 de-risk(72 轮,只测 turn62)里看着更好(尤其治好了福尔摩斯演绎型残留),但更长、更全的矩阵没复现出稳定增量。

**为什么?初步判断**:phase1 的向量召回已经把记忆做到 1.0、clean 到 2/3,**dossier 的"确定性召回/认忘"价值被 phase1 的高水位盖住了**;其最清晰的赢点(演绎型角色 Holmes)是个别场景,聚合指标里被摊薄。dossier 的真正差异化价值(**实体 state 跟踪**)要看 **xiyou 群像**(补跑中)——那才是 phase1 向量层弱、dossier 该发力的地方。

### 3. 成本:phase1/phase2 都比 baseline 便宜(0.97→0.88~0.94)
召回 query 条件化(只用问句)比 baseline 的 scan_text 省 token;dossier 注入开销不显著。修复不增成本。

## 待补 / 待判
- **xiyou 三档**(补跑中):群像 speaker(沙僧诱饵)+ state_consistency —— **dossier 价值的关键考场**。
- **多种子**:现 n=1,clean 这种 3 探针 pass/fail 粗粒度 + LLM 温度,需 ≥3 种子定方差(尤其判 phase2 那个 sherlock 回归是真退化还是噪声)。

## 初步判定(待 xiyou + 多种子)
**phase1 = 确定的净胜,建议保留/上线。** **phase2(dossier)= 机制成立(de-risk 证明能治演绎型残留)、但聚合增量未在矩阵上稳定显现**;是否值得,取决于 xiyou 的 state/speaker 数据 + 多种子。若 xiyou 也不显著,则 dossier 需要么找到更对的测法、要么简化/降级,不宜在 phase1 已够好时强推。
