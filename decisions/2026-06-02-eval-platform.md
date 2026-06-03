---
date: 2026-06-02
updated: 2026-06-02
status: planned
type: engineering
---

# 评测平台(判断力系统): 自动化故事质量衡量

## 决策

构建自动化评测平台: 自动生成 playthrough(LLM player bot) + Claude 作为 Judge 评判质量 + 动态维度配置 + 回归检测。住在本 repo `eval/` 目录,import 引擎代码直接调用。

## 为什么

引擎没有任何衡量"输出质量"的手段。对故事引擎来说输出质量就是产品本身。改 prompt/换模型/调参数后,好没好全凭人试读。随时间推移这个缺口只会越来越痛。

Cursor 类比: Cursor 有 evals。我们也要有。而且要动态(维度随时间演进),不是一组写死的测试。

## 核心设计

**五层架构**:
1. Fixtures(测试场景: 已知 IP 的完整卡组 + 源材料)
2. Player Bots(自动玩家: LLM + persona prompt, 多种人格压测)
3. Dimensions(维度注册表: YAML 配置, 加维度不改代码)
4. Orchestrator(编排: 选场景×选玩家×跑N轮×评)
5. Results & Regression(存储/趋势/回归检测)

**裁判**: Claude API(不是 DeepSeek, 避免 self-preference bias)。分层: Haiku 快筛 → Sonnet 详评 → Opus session-level。

**维度动态**: lifecycle = draft→active→stable→deprecated。加 YAML = 加维度。维度可升权/降权/毕业为 structural check。

## 验收

- 自动跑 30 轮 playthrough 无人干预, 输出报告
- 故意注入退步, 系统检测到并报警
- 加新 YAML 维度配置, 下次 run 自动生效
- 改引擎 → 5 分钟出结论(好/坏/持平)
- 终极: 引擎组 vs 对照组(直接聊天) A/B 测试, 三维度显著高

## 研究基础

基于 2026-06-02 调研:
- ConStory-Checker(5维度19子类型一致性分类, F1=0.678)
- PersonaGym(persona-based 压测方法论)
- GPR-bench(生成式 AI 回归检测)
- ATANT(playthrough-and-verify 架构)
- WebNovelBench(LLM-as-Judge 中文叙事可行性验证)

空白(我们的机会): 没有人做过"bot 自动跑互动叙事 + 对特定已知 IP 判 canon fidelity + 维度动态演进"的完整平台。

## 影响

- 新增 `eval/` 目录(dimensions/ + bots/ + fixtures/ + orchestrator + judge)
- 需要 Claude API key(裁判用, 与引擎的 DeepSeek key 独立)
- 评测结果存同一个 Supabase Postgres(新表, 不影响引擎表)
- 依赖模型适配器(见 2026-06-02-model-adapter-layer.md)做模型对比

## 详细设计

→ Obsidian Vault: `01 - Projects/YoRHa-A2/ai-interactive-story-eval-platform.md` §3-5

## 实施顺序

Week 1-2: 模型适配器(前置依赖)
Week 3-4: 评测骨架(fixtures + orchestrator + structural checks)
Week 5-6: Claude Judge 接入(API + 第一批 judge dimensions)
Week 7+: 迭代(加 fixture/bot/dimension, 根据评测改引擎)
