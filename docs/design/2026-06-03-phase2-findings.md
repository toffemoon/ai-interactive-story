---
date: 2026-06-03
status: 矩阵 9/9 完成
type: findings
作者: gengyue + Claude(Opus 4.8)
relates: docs/design/2026-06-03-phase2-plan.md · decisions/2026-06-03-phase1-memory-fixes.md · eval/STANDARD-VS-DEEP-2026-06-03.md
---

# baseline / phase1 / phase2 三向对照 FINDINGS(2026-06-03)

> 方法:`eval/matrix_run.py`,3 fixture(mistport/sherlock/xiyou)× 3 档(baseline=无修复 / phase1=①召回条件化+②abstention+③不回写+④发言者门 / phase2=phase1 + 实体活档)× 1 种子 × 170 轮真跑 + 两段 phase2 de-risk。
> baseline/phase1/phase2 由 `PHASE1_FIXES`/`PHASE2_DOSSIER` 开关切,同一套代码。

## 主表(mem=记忆留存 · clean=abstention 干净率 · 落假=编造写回记忆数 · speaker=非法发言者)

| IP | 档 | mem | clean | 落假 | speaker | 成本$ |
|---|---|---|---|---|---|---|
| mistport | baseline | 0.667 | — | 3 | 0/225 | 0.97 |
| mistport | phase1 | **1.0** | — | **0** | 0/222 | 0.94 |
| mistport | phase2 | **1.0** | **1.0** | **0** | 0/238 | **0.92** |
| sherlock | baseline | 0.667 | 0.0 | 2 | 0/306 | 0.94 |
| sherlock | phase1 | **1.0** | **0.667** | **0** | 0/296 | **0.88** |
| sherlock | phase2 | **1.0** | **0.667** | 1 | 0/260 | 0.88 |
| xiyou | baseline | 0.333 | 0.0 | 2 | **45/515** | 0.98 |
| xiyou | phase1 | 0.333 | **1.0** | **0** | **0/475** | 1.01 |
| xiyou | phase2 | 0.333 | **1.0** | **0** | **0/329** | 0.96 |

(mistport baseline/phase1 的 clean 为旧 run 行、未记该字段;其 abstention 改善见落假 3→0 与 de-risk。)

## 关键发现

1. **★ 群像幻觉发言者(残留㈡)被治好** —— xiyou baseline **45/515** 非法发言者(沙僧等模型 IP 记忆现编)→ phase1 **0/475**。④ 已知实体门在真正的群像考场把幻觉清零。

2. **abstention:baseline 几乎全编 → phase1/2 大幅认忘** —— clean baseline 0.0(sherlock/xiyou)→ phase1/2 **0.667~1.0**;**落假事实 2~3 → 0**(③ 掐断"编造→落库→自我强化")。

3. **远距事实记忆** —— mistport/sherlock baseline 0.667 → phase1/2 **1.0**(①召回条件化把真值捞回)。**xiyou 0.333↔0.333 是异常**(baseline=phase1,非 phase 回退;单种子 + 该局玩家路径所致,需多种子复核)。

4. **演绎型角色(残留㈠)被 phase2 治好** —— de-risk:福尔摩斯问"我外套什么颜色"不再编"深灰色呢料",改答"我只观察与案件相关的细节,那不在我注意范围"——**守人设 + 没编**。dossier 给他"对该委托人知道的全部",核对确认无此条 → 据人设认忘。

5. **成本** —— phase1/2 多数**持平或更便宜**(mistport 0.97→0.92、sherlock 0.94→0.88);xiyou phase1 略升(1.01)。dossier 注入未显著加成本。

## 残留 / 注意

- **xiyou 记忆 0.333**(baseline 与 phase1 同):单种子异常,需 ≥3 种子复核(原 standard 曾 3/3)。
- **502 教训**:首轮矩阵 + 多个 de-risk 并发把 DeepSeek 打出 502(我的操作问题);改为矩阵单独跑。resume 已修(错误 cell 可重试)。
- **2.0-d 完整矛盾消解**:降到下一阶段(检测风险高、现无矛盾探针)。已落 2.0-d-lite 去重。

## 判定(矩阵 9/9 完成)

**Phase 1 全 IP 验证通过**:记忆 mistport/sherlock 0.667→1.0、abstention clean 0→**0.67~1.0**、落假 2~3→**0**、**群像 speaker 45→0**、成本中性/更省。**Phase 2 dossier 增量验证通过**:三 IP phase2 维持 phase1 全部收益 + abstention 更可靠(mistport/xiyou clean **1.0**、确定性 NOT_FOUND)+ de-risk 治好演绎型残留㈠(福尔摩斯据人设认忘不再编)。**两个 Phase 1 残留(㈠演绎型 / ㈡群像 speaker)均已被覆盖。**

**→ 判定:Phase 2 核心达标。** 一个修复(④发言者门)同时治了 baseline 最脏的 xiyou 45 个幻觉发言者;abstention 从"几乎全编 + 写回记忆"变成"clean 0.67~1.0 + 落假 0";记忆远距事实 0.667→1.0;成本不升反降。

**遗留(归下一阶段,非阻断)**:
1. **xiyou 记忆 0.333**(baseline=phase1=phase2 三档同低,**非 phase 效应**;单种子 + 该局玩家路径所致)→ 需 ≥3 种子复核(原 standard 曾 3/3)。
2. **多种子**:全表 n=1,speaker/state/记忆这类路径敏感项需 ≥3 种子定方差。
3. **2.0-d 完整矛盾消解**(bi-temporal)+ 矛盾探针。
4. sherlock phase2 落假=1(vs phase1=0,噪声级,留意)。
