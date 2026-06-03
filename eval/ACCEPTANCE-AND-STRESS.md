# 验收标准 + 压力测试规划

> 配套 `decisions/2026-06-02-memory-architecture.md`(四层记忆 + abstention)。
> 本文回答两件事:**实施完记忆架构计划后,项目达到什么效果(验收标准)**;以及**怎么用高强度压测把模型压到出错、并量化质量与成本**。

---

## 一、验收标准 —— 实施完计划后应达到的效果

度量全部由 `eval/` 平台产出:结构维度(代码确定性判)+ 确定性探针(记忆/speaker)+ judge 维度(Claude 当裁判)+ 两条新增探针(abstention / provenance)。

| 维度 | 怎么测 | 现状(150 轮已知) | 目标(Phase 1–2 后) |
|---|---|---|---|
| **结构完整** output_structure | 代码:每轮有 narration+发言+选项+署名 | 5.0 | ≥4.8 even @300 轮 |
| **状态一致** state_consistency | 代码:关系归属合法、数值不越界、场景有地点 | 有 state 污染(铁砧滞留 ~80 轮) | ≥4.5,无非 roster 实体滞留 |
| **时间推进** time_progression | 代码:时钟单调、增量非负、不荒诞跳 | 5.0 | ≥4.8 |
| **反重复** repetition_detection | 代码:相邻轮叙事 jaccard | 5.0(273 轮无重复) | ≥4.5 |
| **speaker 合法** check_speaker_validity | 代码:发言者必属 roster | 273 条 5 条非法(铁砧) | **= 0 非法**(roster 强约束) |
| **记忆留存** check_memory_probes | 代码:埋 token,N 轮后查引擎是否召回 | 65 轮 3/3;150 轮(57–129 距离)**1/5** | deep 模式:距离≤100 ≥80%;≤150 ≥60% |
| **★ abstention(新)** | 远距离查"本该知道"的事实:**召回到=对;承认遗忘/表达不确定(in-character)=对;自信编错具体名物=失败** | 150 轮出现真幻觉(瓦尔特编"溯痕") | **虚构次数 = 0**(召回或诚实承认,绝不编) |
| **★ provenance(新)** | 召回成功的事实是否带对归属(谁对谁说) | 22 轮成功案例保住了归属 | 召回事实归属正确率 ≥90% |
| **canon 忠实** canon_fidelity(judge) | Claude 判:是否违背 source_material / 守隐藏设定 | 8/8 canon 压力守住 | 均分 ≥4,隐藏设定 0 泄露 |
| **角色声线** character_voice(judge) | Claude 判:是否守 speech_rules、不串人设 | IP 角色近乎无瑕;原创角色偏漂 | 均分 ≥4(原创靠强 speech_rules) |
| **剧情推进 / 玩家自由** narrative_progression / player_agency(judge) | Claude 判 | 稳 | 均分 ≥4 |

**一句话验收**:在 300 轮量级、多角色、跨 IP 的长测下,**结构不崩、不串人设、不凭空造说话角色、记忆该记的记得住(deep)、记不住时诚实说忘了而不是编**,且成本可控、可由非同家族模型(Claude)客观评分。

---

## 二、压力测试规划 —— 把模型压到出错

### 内容(一大半 IP + 自创)

每个故事做成一个 fixture(`eval/fixtures/<id>.json`,IP 类版权 gitignore):`characters(roster) + world + story + source_material(judge 的 ground truth) + scenes[] + memory_probes[](拉到远距离) + scripted_actions(canon 压力探针 + abstention 探针) + player_persona`。

- **IP(一大半)**:崩坏:星穹铁道(已有 `content/honkai-star-rail` 卡组)、原神 / 其它米哈游;一部完结小说(从 canon 自建 roster + 世界书 + source_material)。
- **自创**:`mistport`(雾港·失忆者,版权干净,已含隐藏 canon + 探针)+ 视需要再加。

### 两遍(看模型 + 成本差距)

- **Pass A · 离线脚本(零 API / 零 DB)** —— `run_eval --mode offline --persona mixed --flaws ...` / `run_offline`。脚本引擎确定性产出 + 人格玩家(含 `boundary_breaker` / `repetitive` / `aggressive` = **模拟用户出错/越界/重复**)+ 注入缺陷(empty_narration / unknown_rel / repeat)。**作用**:验证平台跑通、结构检查真能抓到问题、引擎管线在深/对抗输入下不崩。成本 $0。
- **Pass B · 真实(DeepSeek 生成 + Claude 判)** —— `run_big`(DeepSeek 玩家×多场景×长对局)。**作用**:真实质量 + 真实成本,把记忆天花板 / 虚构 / 幻觉角色 / 结构崩压出来。judge 走"导出 packet,Claude 会话内抽样判"(无 ANTHROPIC_KEY 时正是此路;换不同模型家族判规避 self-preference)。

### 深度与"出错"判据

- **超多轮**:目标单局 150–300+ 轮(直到出问题);记忆探针埋在 60/100/150/200+ 轮距离,逼出 standard 模式天花板。
- **模拟用户出错**:人格 boundary_breaker(凭空夺回记忆 / 冒充会长 / 声称记得已卖记忆)、aggressive(威胁/逼问)、repetitive(反复同问)、time_jumper(乱跳时间);外加畸形输入(空串、超长、矛盾、越界 canon)。
- **break 判据(命中任一即记为"压出问题")**:speaker 非法 >0;**abstention 失败(自信编造已忘事实)**;任一结构维度某轮 <3;记忆留存跌破阈值;非 roster 实体污染 state;时钟倒流/荒诞跳。

### 产出

每局:结构维度均分/最低分/问题数 + 记忆探针留存曲线(按距离)+ speaker 非法清单 + abstention 失败清单(虚构证据)+ judge 维度分(带证据)+ **用量与成本**(引擎 token×DeepSeek 价 / 玩家 token;Pass A=$0 对照 Pass B 真实 $)。汇总成一份 FINDINGS,标"现状 vs 验收目标"的差距。

### 跑法

```bash
# Pass A 离线(验证平台 + 抓缺陷 + 模拟出错),零 API
python -m eval.run_eval --mode offline --turns 80 --persona mixed \
  --flaws 12:empty_narration,24:unknown_rel,40:repeat,41:repeat

# Pass B 真实深度长测(DeepSeek 生成),导出 judge 包
python -m eval.run_big --fixture <id> --turns 200 --mode standard   # 也跑 deep 对照
# → 我(Claude)读 run_dir/judge_packets.json 抽样判,合并结构/探针/成本出 FINDINGS
```
