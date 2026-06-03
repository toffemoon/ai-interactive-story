"""ai-interactive-story 评测平台。

自动生成 playthrough(脚本 / 真实 LLM 玩家)→ 结构性检查 + LLM-as-Judge 评判
→ 聚合 + 回归检测。维度动态(加 JSON 配置 = 加维度,不改代码)。

详细设计:Obsidian Vault `01 - Projects/YoRHa-A2/ai-interactive-story-eval-platform.md`
决策:decisions/2026-06-02-eval-platform.md
"""
