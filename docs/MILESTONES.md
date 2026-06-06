---
type: milestones
project: ai-interactive-story
created: 2026-06-07
updated: 2026-06-07
---

# ai-interactive-story · 关键节点(Milestones)

> 引擎"走到哪了"的**工程视角时间线**:每个关键节点 = 做了什么 + 为什么 + 对应 PR + 验证证据 + 决策/设计文档链接。
> 维护:有新关键节点就在「时间线」追加一段,旧的不删(同 `decisions/` 的只增不改)。
> 配套权威文档:决策记录 `decisions/`、设计 `docs/design/`、调研 `docs/research/`、长程记忆人话总结 `docs/2026-06-04-memory-phase1-3-总结.md`。

---

## 现状速览(2026-06-07)

| 子系统 | 状态 | 关键 PR | 决策 / 设计 |
|---|---|---|---|
| 持久化(Postgres + pgvector) | ✅ 上线 | #1–#3 | `decisions/2026-05-30-db-supabase-postgres.md` |
| 模型适配器层 | ✅ 建成 | #6 | `decisions/2026-06-02-model-adapter-layer.md` |
| 评测平台(eval/) | ✅ 骨架+judge 验证 | #6 | `decisions/2026-06-02-eval-platform.md` |
| 长程记忆 Phase 1(抗幻觉/认忘) | ✅ 上线 | #13 #18 | `decisions/2026-06-03-phase1-memory-fixes.md` · `docs/design/2026-06-03-phase1-*.md` |
| 长程记忆 Phase 2(实体活档) | ⚠️ 归并(撞已有设计) | #13 #16 | `decisions/2026-06-04-architecture-ownership.md` |
| 长程记忆 Phase 3(角色知识边界) | ✅ 上线 | #18 #20 | `docs/design/2026-06-04-phase3-knowledge-boundary.md` · `docs/research/2026-06-04-knowledge-boundary-research.md` |
| 线上部署(完整 deep 模式) | ✅ onrender | #22 #23 | — |
| 内容能力(去AI味/visibility/确定性导入器) | ✅ 上线 | #24 #25 #26 #27 #29 | `decisions/2026-06-04-去AI味-prompt注入提案.md` 等 |
| 后台导演控制台(注入工具) | ✅ 上线 | #28→#33 | `decisions/2026-06-07-operator-console-design.md` |
| **崩铁宇宙内容** | 🔜 计划已出,待导入 | — | `docs/2026-06-07-hsr-universe-build-plan.md` |
| P0 角色卡级 hidden/versions 注入 | 🔜 提案待实现 | — | `decisions/2026-06-06-角色卡-known_hidden-versions-注入提案.md` |

图例:✅ 已上线/完成 · ⚠️ 有保留/部分 · 🔜 计划中。

---

## 时间线

### M0 · 2026-05-30 — 上云:Supabase Postgres + pgvector
**做了什么**:持久化从 JSON 文件迁到 Supabase Postgres,5 张表(`cards`/`presets`/`sessions`/`messages`/`memory_vec`);`messages` 改 **append-only 行**(每回合 INSERT,不再全量重写整个 session blob,根治旧设计 O(n²))。
**为什么**:上云 + 多端可读 + 向量(pgvector)记忆的基础设施。
**决策**:`decisions/2026-05-30-db-supabase-postgres.md`。**PR**:#1(CLAUDE.md)/#2(决策)/#3(代码)。

### M1 · 2026-06-02 — 模型适配器层 + 评测平台
**做了什么**:
- **适配器层**:引擎产出模型无关的 `ContextBundle` → `ModelAdapter.format/parse` → LLM。DeepSeek 路径逐字节复刻原行为;预留 Claude / 多模型适配器。换模型不再改引擎核心。
- **评测平台 `eval/`**:fixtures / dimensions(8 个 JSON,结构性 + judge 两类)/ player bots / orchestrator / judge / report。
**为什么**:(1) 让引擎"随模型发展壮大"(模型特异逻辑从核心抽出);(2) 引擎此前**没有任何衡量输出质量的手段**,而输出质量就是产品本身。
**验证**:离线 40 轮 4 个结构性维度全 5.0;缺陷注入跑能抓空叙事/未知角色/重复并对基线报警;judge 演示(植入 3 处违背)Claude 精确抓出全部 3 处;真实 DeepSeek 8 轮守住 3 处 canon 边界。
**决策**:`decisions/2026-06-02-model-adapter-layer.md` · `decisions/2026-06-02-eval-platform.md` · `decisions/2026-06-02-memory-architecture.md`。**PR**:#6。

### M2 · 2026-06-02 — 崩铁 65 轮大规模多角色长测
**做了什么**:`eval/big_test.py` —— DeepSeek 驱动的"像真人"玩家 + 8 角色 roster 多场景轮换 + 确定性记忆探针(早埋 token、N 轮后追问、代码核对)+ speaker 合法性校验。
**结果**(8 角色 × 3 阵营 × 4 场景 × 65 轮真实 DeepSeek,$0.31):**记忆 3/3 召回**(含跨场景换角色仍带归属上下文)、**178 条发言 0 非法**、**8/8 canon 压力探针守住**、结构性 4 维全 5.0。
**跨测发现**:DeepSeek 对**知名 IP 角色声线把握 > 原创角色** → 做原创世界时原创角色要更强的 speech_rules + mes_example 锚点。
**PR**:#6(HSR fixture 因版权 gitignore,结果留 `eval/demo/hsr-longtest/FINDINGS.md`)。

### M3 · 2026-06-03 — 治理:架构主权归主理人 + 移除未验证代码
**做了什么**:把未经验证、Claude 凭空生成的长程记忆 B②③④ 归档移除;明确**架构/技术/引擎核心由主理人(Gengyue)负责**,内容/前端归 Yufei,核心改动必须经主理人审 + 压测才进 main。
**为什么**:未验证架构进了 main 又与主线冲突。**教训:功能更多 ≠ 更好;架构靠数据验证,不靠代码量。**
**决策**:`decisions/2026-06-04-architecture-ownership.md`。**PR**:#16。

### M4 · 2026-06-03~04 — 长程记忆 Phase 1:抗幻觉 + 认忘
**问题**:~50 轮后大量丢事实;最危险=问"本该知道"的角色,模型不认忘反而**自信编错答案**。
**怎么修**:检索只用问句本身(不被闲聊冲淡)+ 回答前自检"这事查到没",没查到就 in-character 认忘,且**认忘时绝不把编的存进记忆**;顺手堵"冒充没出场角色发言"。
**验证**:3 个 IP × 多种子 × 200 轮全过,成本略降。
**决策/设计**:`decisions/2026-06-03-phase1-memory-fixes.md` · `docs/design/2026-06-03-phase1-plan.md` · `docs/design/2026-06-03-phase1-status.md`。**PR**:#13 #18。

### M5 · 2026-06-04 — Phase 2:实体活档(踩了重复造轮子)
**做了什么**:另设计"实体活档(dossier)"想强化记忆 → 发现主干**已有更完整的同类设计**(队友原作)。
**结果**:归并,未验证旧代码归档。这一步的教训直接催生 M3 的治理决策。
**PR**:#13(三向对照验证)。

### M6 · 2026-06-04 — Phase 3:角色知识边界(确定性删除)
**问题**:角色"不在场却什么都知道"——悟空被支开没在场,却自信编妖怪篮子内容。叙事是全知的,但**单个角色只该知道自己亲历或被当面告知的事**。
**走过两次弯路**:① 只在结构化记忆做边界 → 过度认忘(把见证者也压成"不知道");② 给召回的旧对话打"当时在场"标签、劝模型自律 → 崩铁过了但**西游悟空没修住**(火眼金睛+就在附近,模型会编"远远瞄一眼"钻空子)。
**对的方向(第三版)**:**确定性裁决** —— 玩家点名问某角色一件往事、而他不在那条召回的"当时在场"名单 → **直接把这条从他这轮视野删掉**。只是"名字在不在名单"的是/否,与作品/角色能力无关。
**结果**:崩铁姬子诚实认"没下地表";西游悟空从编"黄符纸"→ 改成"老孙盯妖气没顾上,你问八戒"(认忘+正确改指)。**附带抓到自家指标的假阴性**(角色认忘只因顺口当转述提一嘴被误判)→ 评测脚本本身也要审。
**调研**:修之前做了 20+ 来源对抗验证,确认这是学术上有正式命名的问题、纯提示自律无效、按"谁观察到"过滤记忆可落地。
**决策/设计/调研**:`docs/design/2026-06-04-phase3-knowledge-boundary.md` · `docs/research/2026-06-04-knowledge-boundary-research.md` · 人话总结 `docs/2026-06-04-memory-phase1-3-总结.md`(PR #19)。**PR**:#18 #20。

### M7 · 2026-06-04 — 部署:线上开完整 deep 模式
**做了什么**:onrender 线上开 deep(深度向量过滤真生效);`/api/health` 增报 `embeddings_installed/loaded` + `deep_capable`,用来**确认线上跑的是完整 Phase 1–3**。
**验证**:线上 health 三项为 true。**PR**:#22 #23。

### M8 · 2026-06-04~06 — 内容能力:去AI味 / visibility / 确定性导入器 / 玩家角色
**做了什么**(一串内容/前端向能力,多为 Yufei 主开发、主理人审):
- **去 AI 味**:注入反 AI 写作规则(可开关),改善叙事腔。`decisions/2026-06-04-去AI味-prompt注入提案.md`(PR #25)。
- **建卡 visibility / hidden**:对话建卡保全设定卡 visibility(修剧透 bug),build prompt 支持标 hidden(PR #26)。
- **确定性导入器**:`scripts/import_story.py`(《如我所书》)—— 固定模板 → 引擎确定性解析,不走 LLM(PR #17 #24);卡片模板体系提案(PR #21);`decisions/2026-06-06-建卡读卡-确定性格式-与事件卡引擎-提案.md`。
- **玩家扮演角色修复**:玩家扮的角色不再被当 NPC 代说(PR #27)+ 发言者门硬兜底丢弃引擎替玩家角色生成的台词(PR #29)。
- 引擎待补汇总给主理人:`decisions/2026-06-06-引擎待补汇总-给Gengyue.md`。

### M9 · 2026-06-06~07 — 后台导演控制台(运营注入工具)
**做了什么**:运营者(导演)在后台对正在玩的某一局实时施加影响。一个 `OPERATOR_TOKEN` 闸、无账号、玩家无入口、入口 `/operator`。演进:
- token 闸 + "AI 下回合看到"(#28)→ 两栏控制台(session 列表 + 点选看上下文,#30)→ session 人话标签 + 「立即生效」瞬间出回合(#31)→ **玩家端实时弹出**(`/api/session/{id}/tail?after=N` 轮询,#32)→ **三模式 + 留痕**(#33)。
- **三模式**:🎬 导演(写指令,AI 织进剧情,走 LLM)/ 🎤 直接台词(角色逐字,引擎直插,不走 AI)/ 🌧 旁白(逐字,引擎直插)。
- **生效时机**(仅导演):立即 / 下回合 / 持续。**留痕**:每条生效注入记进落地回合的 `operator_applied`,永久可查原文。
**验证**:`_validate_operator_modes.py` 24 项全过(TestClient 临时局跑完即删)。
**决策**:`decisions/2026-06-07-operator-console-design.md`。**PR**:#28 #30 #31 #32 #33。

---

## 当前真实玩家数据(production,实时查 2026-06-06)

库:Supabase 项目 `hhrqxllcamdxqcoepwgx`(onrender 线上连这个;本地 `.env` 是另一个调试库)。**共 65 局 / 1090 轮**。

| 故事 | 局数 | 轮数 | 备注 |
|---|---|---|---|
| 《某一个轮回里确实发生过》 | 41 | 720 | 翁法罗斯/黄金裔群像,深度模式,**绝对主力** |
| 《所以我出手了》 | 11 | 112 | 黑天鹅线 |
| 《渡口》 | 4 | 11 | |
| 《账单在星海里回响》 | 2 | 50 | |
| 《雾港轮渡:第七位乘客》 | 2 | 32 | 原创悬疑 |
| 《听雪山庄·风雪密室》 | 1 | 106 | 单人深玩,单局最长 |

**洞察**:玩家高度集中在翁法罗斯群像(占 2/3 轮数);存在 106 轮的单局长玩 → Phase 1–3 长程记忆是真用得上的。

---

## 下一步(关键节点路线)

1. **崩铁宇宙内容**(最大块):L0 共享世界书 + L1 开拓队 + 4 弧(序章/雅利洛/罗浮/匹诺康尼),建在确定性导入器上。计划详见 `docs/2026-06-07-hsr-universe-build-plan.md`。
2. **P0 引擎能力 — 角色卡级 hidden/versions 注入**:解锁"按玩家进度看到不同信息层"(崩铁剧透分层的前置)。提案:`decisions/2026-06-06-角色卡-known_hidden-versions-注入提案.md`。
3. **Phase 3 短路径补全**:确定性删除目前只盖"长距离召回",近期对话原文 + 全角色共享摘要两条短路径未盖。
4. **评测增值 A/B + 多模型对比**:引擎组 vs 直接聊天(终极验收);写 Claude 真实适配器跑同 fixture 比分。
5. **多种子统计**:Phase 3 当前单种子,需加种子做更稳的统计。

---

## 决策记录索引(ADR map)

| 文件 | 一句话 |
|---|---|
| `2026-05-30-db-supabase-postgres.md` | 持久化选 Supabase Postgres + pgvector,messages append-only |
| `2026-06-02-memory-architecture.md` | 记忆分层(turn/lm/kb 三 scope)+ standard/deep 两模式 |
| `2026-06-02-model-adapter-layer.md` | 引擎与 LLM 间插 ContextBundle + ModelAdapter,换模型不改核心 |
| `2026-06-02-eval-platform.md` | 评测平台:bot 跑 playthrough + Claude judge + 动态维度 + 回归检测 |
| `2026-06-03-phase1-memory-fixes.md` | Phase 1:窄检索 + 答前自检认忘 + 认忘不入库 |
| `2026-06-04-architecture-ownership.md` | 架构主权归主理人;核心改动经审+压测才进 main |
| `2026-06-04-去AI味-prompt注入提案.md` | 注入反 AI 写作规则(可开关)改善叙事腔 |
| `2026-06-04-建卡前端best-effort-与引擎待办提案.md` | 建卡前端尽力解析 + 引擎待办清单 |
| `2026-06-06-建卡读卡-确定性格式-与事件卡引擎-提案.md` | 卡片固定模板 → 引擎确定性解析(不走 LLM) |
| `2026-06-06-角色卡-known_hidden-versions-注入提案.md` | 【P0】角色卡级 known/hidden/versions 注入(信息分层) |
| `2026-06-06-引擎待补汇总-给Gengyue.md` | 引擎待补项去重汇总(P0/P1) |
| `2026-06-07-operator-console-design.md` | 后台导演控制台:3 模式 + 时机 + 留痕(已实施,PR #33) |

---

## PR 时间线(#13 → #33)

```
#13 Phase 1 收尾 + Phase 2 实体活档(dossier)三向对照
#14 asset: 如我所书预设封面(cover-only 部署测试)
#16 治理:架构主权归主理人 + 移除未验证的长程记忆 B②③④
#17 yufei: 如我所书导入器 + 前端重构 + 去AI味提案
#18 长程记忆架构(A 实体记忆 + 矛盾消解 + Phase3 每角色知识边界)
#19 docs: 长程记忆 Phase 1–3 人话总结
#20 Phase3 确定性删除——根治"缺席角色编造"(西游悟空案)
#21 卡片模板体系 + 引擎对接提案
#22 线上开完整 deep 模式   #23 health 报 embeddings 状态
#24 如我所书确定性导入器 + 角色卡 hidden 注入提案
#25 叙事去 AI 味(可开关)   #26 对话建卡保全 visibility + build 标 hidden
#27 玩家扮演的角色不再被当 NPC 代说  →  #29 玩家角色硬兜底(补 #27)
#28 后台注入 token 闸  →  #30 两栏控制台  →  #31 人话标签+立即生效
#32 玩家端实时弹出(tail 轮询)  →  #33 导演控制台三模式 + 留痕
```
