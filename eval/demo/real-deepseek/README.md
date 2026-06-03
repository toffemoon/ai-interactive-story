# real-deepseek — 真实 DeepSeek 生成 + Claude 裁判

这是**真实 DeepSeek 生成**的对局(`--mode real`,真 key,8 轮,49,535 真实 token),
玩家用同一套 `authored_real_script()`——专门去踩三处 canon 边界。然后 **Claude 在会话内当裁判**逐轮打分。

与 `../`(植入违背的演示)互为对照:那边引擎"故意"违 canon → 裁判 canon 给到 min 1;
这边引擎**真的守住了每一处边界** → 裁判 canon 给 5.0。**裁判会区分好坏,这就是它有用的证明。**

## 引擎在三处探边界都守住了

| 轮 | 玩家探边界 | 真实 DeepSeek + 引擎的反应 | canon |
|---|---|---|---|
| 3 | 无忆珠要凭空读回记忆 | 沈雾拒绝:'若在下有这本事…便是神仙了…强求不得,也替换不得' | ✅ RULE-2 守住 |
| 5 | 逼阿青说会长秘密 | 阿青承认'哪能知道会长的事',只给街头传闻(旧灯塔搬箱),不泄隐藏设定 | ✅ 知识边界守住 |
| 6 | 声称记得卖掉的记忆 | 引擎反驳:'卖家绝不可能自己想起来…那恐怕是别人的记忆?' | ✅ RULE-1 守住 |

## 评分(见 report.md)

- canon_fidelity **5.0**、player_agency 5.0、narrative_progression 5.0、结构性 4 维全 5.0。
- character_voice **4.25** —— 真实发现:DeepSeek 把**沈雾演得比卡设『话短,极少超过三句』更啰嗦**,
  6 轮被标。这正是平台该抓的细颗粒质量信号。

## 成本(见 cost.md,真实 token)

- DeepSeek 生成:**$0.0025/轮**(8 轮 $0.0203)。
- Claude-Sonnet 裁判:**$0.022/轮 ≈ 生成的 8.6×**;Haiku ≈ 2.9×。
- → 生成便宜、评判贵;评判分层 + judge 维度毕业成 structural 是必要的成本设计。

## 复现

```bash
LLM_API_KEY=<真实 DeepSeek key> python -m eval.run_eval --mode real --judge export
# 裁判:把 judge_packets 交给 Claude(会话内)或 --judge api(配 ANTHROPIC_API_KEY)
python -m eval.demo.cost_analysis <run_dir>
```
