---
date: 2026-06-04
updated: 2026-06-04
status: proposal
author: yufei (Claude 协助)
audience: gengyue (架构 / 引擎 owner)
---

# 建卡前端 best-effort 改造 + 给引擎的待办提案

> 给 Gengyue 看。yufei 这侧做了一批**纯前端 + seed best-effort** 的建卡改造(不动 `build_card` / 引擎核心)。下面 §2 是 best-effort 到不了、需要你改引擎才能真正落地的事,按总览的 A/B 边界整理。

## 1. yufei 已做(前端域,本 PR / 前序 commit)

- 建卡入口对齐卡片模板大类;角色卡 / 世界设定卡进对话前选引导 chips(主要/次要·轻量/满配·隐藏;世界书/设定卡·组织/地点),选项折进 `seed` 传给 `build_card`(best-effort 引导)。
- 建完进「本次已建的卡」列表,每张可「查看/修改」/「保存到故事库」(显式存,不再静默自动存)。
- 事件卡独立步:**前端表单**手动加隐藏事件、挂到当前故事书 `events`(无 AI 建卡)。
- 卡库改名「故事库」+ 6 分类(角色卡/玩家卡/世界书设定/故事书/事件卡/我的故事)+ 每页 12 张分页 + 「详情/修改」单开编辑页。
- 后端侧已就位(前序):`src/parsers.py` 确定性模板解析器 + `models.py` 扩字段(CharacterData anchor/tension/look/keys/versions/known_public/known_hidden;PlayerCard unknown/opening;SettingCard;StoryEvent 隐藏档)。**`parsers.py` 仍未接进任何端点**,等你决定怎么接。

## 2. 待引擎(Gengyue 决策域 · best-effort 到不了)

1. **建卡 AI 联网搜索**。`build_card` → `llm.py` 的 `chat_messages` 是纯 DeepSeek 补全,**无联网 / 搜索 / 工具**(`llm.py` 无 http 请求)。README 路线图「对话建卡联网搜索增强」仍 `[ ]`。要做:接搜索 API(Google/Bing/SerpAPI)+ `build_card` 加「检索后生成」或挂 tool。

2. **草稿按 template 字段产出**。`_validate_build_draft`:
   - `characters` / `players` 分支按 `model_fields` 过滤 → 我新加的字段(anchor/tension/known_hidden;unknown/opening)**只要模型吐出来就能保留**(已验证)。但 `_BUILD_SYSTEMS` 的 system prompt 还没要求模型产出这些,现在只能靠前端 seed 引导(不稳)。建议把模板字段写进 `_BUILD_SYSTEM` / `_BUILD_PLAYER`。
   - `worlds`(设定卡)/ `stories` 分支是**硬编码字段**:WorldEntry 只留 keys/content/comment(丢 `可见性/source/给AI指令`);StoryEvent 的隐藏档(hidden/set_flags/unlock_conditions/once)不在 events 解析里。→ 设定卡的 hidden 可见性、事件隐藏档**会被剥掉**,前端只能引导+预览,落不进数据。

3. **设定卡 / 事件卡 作为独立建卡类型**。`build_card` 只认 4 类(characters/players/worlds/stories)。现状:设定卡走 `worlds` + seed;事件卡前端表单手动挂故事书,**无 AI 对话建卡**。要 AI 建这俩,需后端加 kind + `_BUILD_SYSTEMS` 条目 + validator 分支。

4. (承卡片体系总览 §四 B)隐藏档门控注入(注入+不说破)、flag/条件求值、设定卡引擎独立整张解析、揭穿后状态覆盖 —— 仍是引擎核心待办。`parsers.py` 已能把模板解析成结构化 model,等你定接入口(build_card 新类型 / 上传走确定性解析)。

## 3. 边界声明

以上 §2 全属架构 / 引擎核心 = 你的决策域(2026-06-04 架构主权决策)。yufei 不自合 main、不替你定;本提案只是把前端这侧撞到的引擎缺口列清楚,等你判断优先级。要哪条我配合出最小闭环草案走 PR 给你审。

记录:2026-06-04 18:29 by Claude(yufei 侧)
