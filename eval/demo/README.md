# eval/demo — Claude-as-Judge 演示

证明 **LLM judge 能抓到结构性检查抓不到的语义 canon 违背**,并给出生成 vs 裁判的成本差距。

## 这是什么

`authored_playthrough.json` 是**手写**的 8 轮对局(贴着 `fixtures/mistport.json` 的 canon,
模拟 DeepSeek 风格的叙事)。它**结构上完全干净**(state 合法、无空叙事、时钟单调),
但在三处**故意植入 canon 违背**:

| 轮 | 玩家行动 | 植入的违背 | 违背的 canon |
|---|---|---|---|
| 2 | 无忆珠要回记忆 | 沈雾凭空唤回玩家记忆 | RULE-2 + 沈雾硬上限 |
| 4 | 问阿青会长秘密 | 阿青说破隐藏设定 | 隐藏 canon + 阿青知识边界 |
| 5 | 声称记得卖掉的记忆 | 引擎认可"玩家记得" | RULE-1(卖出即遗忘) |

干净轮(0/1/3/6/7)作对照。

## 跑

```bash
python -m eval.demo.judge_demo build      # 结构性 + 导出 judge 包 + 打印裁判上下文
# (Claude 读 judge 包,会话内打分 → 写 judge_results.json)
python -m eval.demo.judge_demo finalize   # 聚合出 report.md / report.json
python -m eval.demo.cost_analysis         # 生成 vs 裁判的成本对比 → cost.md
```

`judge_results.json` 是 **Claude 作为裁判**对每轮每维度的实际打分(带证据)。

## 结果(见 report.md / cost.md)

- **4 个结构性维度全 5.0** —— 这些 canon 违背它们一个都抓不到(state 都合法)。
- **canon_fidelity 降到 min 1**、character_voice min 2 —— judge **精确抓出全部 3 处植入违背**,
  每条附源材料原文 + 输出原文的证据。
- **player_agency 仍 5.0** —— 即便违 canon 的轮也回应了玩家;证明维度正交
  (尊重玩家主体性 ≠ 不违背 canon)。
- **成本**:DeepSeek 生成 ~$0.0018/轮 vs Claude-Sonnet 裁判 ~$0.020/轮(**11×**)。
  → 印证分层裁判 + judge 维度"毕业"成 structural 的设计。

## 说明

本演示用**手写对局**(非真实 DeepSeek 生成),因为开发机 `.env` 是占位 key。
配好真实 DeepSeek key 后,`python -m eval.run_eval --mode real --judge export` 即出真实对局,
judge 流程完全一致。裁判这一侧(Claude 打分)在本演示里是**真的**。
