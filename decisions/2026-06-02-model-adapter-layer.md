---
date: 2026-06-02
updated: 2026-06-10
status: shipped
type: engineering
---

# 模型适配器层: 引擎与 LLM 解耦

## 决策

在 story.py 的上下文决策和 LLM 调用之间,加一层 `ModelAdapter` 协议。引擎产出模型无关的 `ContextBundle`,适配器负责按目标模型的特性组装 messages 数组。

## 为什么

当前引擎跟 DeepSeek 的 json_mode 多轮空白 quirk 焊死: 所有历史折进 system prompt,只发 [system, user]。这不是"最优设计",是针对特定模型 bug 的 workaround,但它被做成了架构级决策。结果:换模型 = 改引擎核心。

引擎要"随模型发展壮大"(类 Cursor 策略: 先建基础设施,等模型能力到了自然利用),必须让"给模型看什么"和"怎么组装给具体模型"可分离。

## 设计

```
引擎 → ContextBundle → ModelAdapter.format() → messages[] → LLM call
                        ModelAdapter.select_model(call_type) → model_name
LLM response → ModelAdapter.parse() → 标准化 dict → 引擎继续
```

ContextBundle 含: system_skeleton, recent_messages, recap_text, summary_text, recall_text, action_prompt, call_type, json_mode, max_tokens 等。

三个初始适配器:
- DeepSeekAdapter(当前行为显式化)
- ClaudeAdapter(真正多轮 + multi-model routing)
- MultiModelAdapter(按 call_type 路由: 主回合贵模型, 辅助任务便宜模型)

## 验收

- 切 adapter 配置, 不改 story.py, smoke test 全过
- 同一 fixture 跑两种 adapter, 输出格式一致可对比

## 影响

- story.py 需重构: 把末尾构建 llm_messages 的逻辑抽出
- llm.py 可能拆分或新增 adapter 模块
- 评测平台(见 2026-06-02-eval-platform.md)依赖此层做模型对比实验

## 详细设计

→ Obsidian Vault: `01 - Projects/YoRHa-A2/ai-interactive-story-eval-platform.md` §2
