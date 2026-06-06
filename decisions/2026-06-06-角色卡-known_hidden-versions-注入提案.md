---
date: 2026-06-06
updated: 2026-06-06
status: proposed
owner: Gengyue (引擎核心决策域)
proposer: Yufei (内容侧,经 Claude 整理)
---

# 提案:引擎接 CharacterData.known_hidden + versions 注入(角色卡级防剧透 / 版本人格)

> 给主理人 Gengyue。内容侧已把字段结构化落库,注入与门控属引擎核心 = Gengyue 决策域。本提案只陈述缺口 + 建议,不擅自改核心。

## 背景
《如我所书》角色卡 2026-06-06 起走**确定性 `parse_character`**(scripts/import_amphoreus.py,免 LLM),已把每张卡结构化为:
- `known_public` / `known_hidden` ← 卡内「知识边界(public / hidden)」段
- `versions` ← 卡内「版本人格 / 状态轴」段(含揭穿后状态覆盖)

这么做的直接原因:折叠后公开角色卡正文含 L4(白厄=盗火行者 等),若走 LLM `identify()` 全文解析会把 L4 卷进**会注入、不门控**的 `description` → 剧透。确定性解析把 hidden 隔离进 `known_hidden`、版本人格进 `versions`,**绝不进 description**。

## 缺口(现状)
`src/story.py` 目前**只读故事书的 `character_boundaries`**做角色级防剧透,**不读** `CharacterData.known_hidden / known_public / versions`(models.py 注释亦标"只落字段,接引擎注入由 Gengyue 决策")。后果:
1. 卡级 `known_hidden` 真相**未注入** AI——当前 L4 的"注入+不说破"只覆盖在故事书 `_BOUNDARIES` 里硬编码的 5 个角色(白厄/昔涟/盗火行者/来古士/赛飞儿);其余角色卡里更细的 hidden 用不上。
2. `versions`(离散切版 v1→v2→v3 / 连续状态轴 / 揭穿后状态覆盖)未接运行时,人格切换/reveal override 仍只是文本。

## 提案(引擎侧,Gengyue 定)
1. **注入 `known_hidden` + 门控不说破**:对齐已落地的世界书 hidden gating(story.py 认 `visibility=="hidden"` 跳过注入/到披露才引入)+ `hard_violation` + CoT 自检。`known_public` 可随卡常注入。
2. **`versions` 接运行时**:至少把"揭穿后状态覆盖"接 reveal override(揭穿触发后覆盖 speech/人格);离散切版 / 连续轴接状态机(对应总览 §四 待补 10/12)。
3. **去重口径**:卡级 `known_hidden` 与故事书 `character_boundaries[].hidden` 可能重叠,定一个优先/合并口径(建议:故事书 boundary 为权威闸门,卡级 known_hidden 为补充细节)。

## 现状兜底(不阻塞上线)
上线版《如我所书》防剧透靠故事书 `_BOUNDARIES`(5 角色,已 gating);`known_hidden / versions` 已落库但 **dormant**(引擎不读=不注入),**不泄漏**。本提案是把"卡级 hidden/版本人格"也接进引擎的增强,非上线阻塞项。

## 关联
- 卡片体系总览(vault)§四 待补清单 2(角色卡承接 hidden 真相)/ 12(揭穿后状态覆盖)。⚠ Gengyue 看不到 vault,故本提案落 repo decisions/。
- 同类先例:`decisions/2026-06-04-去AI味-prompt注入提案.md`。
