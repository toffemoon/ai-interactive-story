# eval/ — 评测平台(判断力系统)

自动生成 playthrough → 结构性检查 + LLM-as-Judge 评判 → 聚合 + 回归检测。
**维度是数据(JSON 配置),不是代码**:加 `dimensions/*.json` = 加维度,平台零改动生效。

> 完整设计 + 调研依据:Obsidian Vault `01 - Projects/YoRHa-A2/ai-interactive-story-eval-platform.md`
> 决策:`decisions/2026-06-02-eval-platform.md` + `decisions/2026-06-02-model-adapter-layer.md`

## 为什么

对故事引擎来说,**模型吐出来的剧情好不好就是产品本身**。改 prompt / 换模型 / 调参数后,
靠人肉试读判断好坏不可持续。这套平台把"质量"变成可量化、可回归、可随时间演进的数字。

类比 Cursor:先把评测基础设施建好,等模型变强,用同一套 fixture 跑对比,**有数据地选模型**,
而不是盲目追新。

## 怎么跑

```bash
# 离线:注入确定性内容,零 API / 零 DB,验证平台 + 结构性检查(可跑很长)
python -m eval.run_eval --mode offline --turns 40 --persona mixed

# 离线 + 注入缺陷:证明结构性维度真能抓到问题(回归检测)
python -m eval.run_eval --mode offline --turns 24 --flaws 7:empty_narration,9:unknown_rel,20:repeat,21:repeat

# 真实:DeepSeek 真生成,导出 judge 包给 Claude 会话内判(需 .env 里真实 DeepSeek key)
python -m eval.run_eval --mode real --judge export

# 真实 + 自动判:有 ANTHROPIC_API_KEY 时直接调 Claude API 当裁判
python -m eval.run_eval --mode real --judge api
```

报告落在 `runs/<label>-NNN/`:`report.md`(人读)、`report.json`(机读 + 回归基线)、
`playthrough.json`(完整对局)、`judge_packets.json`(裁判上下文包)。

## 五层结构

| 层 | 文件 | 职责 |
|---|---|---|
| Fixtures | `fixtures/*.json` | 测试场景:完整卡组 + 源材料(canon ground truth) |
| Player Bots | `providers.py` | 自动玩家人格(compliant/curious/aggressive/boundary_breaker/repetitive/time_jumper/mixed) |
| Dimensions | `dimensions/*.json` | 维度配置(structural 代码判 / judge LLM 判),动态加载 |
| Orchestrator | `orchestrator.py` | 编排:跑 playthrough × 结构性 × judge 打包 |
| Results | `report.py` | 聚合 + 回归检测(对比同 fixture+mode 上次 run) |

辅助:`harness.py`(内存存储,隔离 DB)、`structural_checks.py`(确定性检查)、
`dimension_runner.py`(加载/渲染)、`judge.py`(裁判上下文包 + 可选 Anthropic API)。

## 加一个维度(无需改代码)

往 `dimensions/` 丢一个 JSON:

```json
{
  "id": "emotional_consistency", "name": "情感一致性",
  "type": "judge", "level": "turn", "lifecycle": "draft", "weight": 0.5, "version": 1,
  "eval_steps": ["1. ...", "2. ..."],
  "judge_prompt": ["...用 {{player_input}} / {{current_narration}} / {{source_excerpts}} 占位..."],
  "output_schema": {"score": "int 1-5", "reasoning": "str", "issues": "list[str]"}
}
```

下次 run 自动 pick up。`lifecycle`:`draft`(实验,不计回归)→ `active` → `stable` → `deprecated`。
structural 维度则把 `check` 指向 `structural_checks.REGISTRY` 里的函数名。

## 加一个 fixture / 玩家人格

- fixture:`fixtures/<id>.json`,含 `characters` / `world` / `story` / `player` / `source_material`。
  `source_material` 是 canon bible(裁判的 ground truth),建议用**原创世界**(版权干净)。
- 人格:在 `providers.py` 的 `persona_action()` 加一个分支。

## 维度的迭代演进(平台的核心)

维度**不是写死的**。随时间:发现新失败模式 → 加 draft 维度;引擎修好某问题 → 该维度降权;
裁判打分不稳 → 改 rubric(version++);某 judge 维度规律稳定 → "毕业"成 structural(省 token)。
详见 Obsidian 设计文档 §3.5。

## 设计依据(2026-06-02 调研)

ConStory(5 类 19 子型一致性分类 + 证据锚定)、G-Eval(auto-CoT + rubric 打分)、
PersonaGym(人格压测)、GPR-bench(生成式回归检测)、"Silent Judge"(偏差防护:
裁判用不同模型家族 + 引用证据 + 长度不计入质量)。
