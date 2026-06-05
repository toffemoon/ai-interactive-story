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

## 4. 测试实证(2026-06-04 真实用户 subagent 全程实测 build_card)

一个扮真实用户的 subagent 真调 DeepSeek 建了角色 / 设定卡 / 故事书,确认上面不是猜测:

- **§2.2 设定卡 hidden 被剥(高 · 剧透)**:建「设定卡·组织」时明确告诉 AI"这条是隐藏内幕,默认不说破",AI 照做、最后一轮 `filled` 写着"修正可见性为hidden",但最终 draft 那条 `visibility` 仍是 `public`。根因:`_validate_build_draft` worlds 分支(~549-559)重建 `WorldEntry` 只传 keys/content/comment,丢掉 visibility/source/truth_status/priority,回退 public/world/canon/100。对照:直接 POST `/api/library/save` 带 `visibility:"hidden"` 读回完好 —— **只有 build_card 对话路径剥**,越靠 AI 引导的新手越中招。(前端已补救:`WorldEditor` 加了 visibility 编辑 + 加/删条目入口,可手动设 hidden 经 library/save 存住;但根治要 validator 保留字段。)
- **§2.2 versions / events**:满配角色 seed 要 `versions`,AI 中途主动提"加揭穿后状态轴"却在收尾时留空;故事书对话建卡 `events` 永远空数组(主线 / 结局有,事件无)。根因:`_BUILD_SYSTEM` 角色 prompt **根本没列** anchor/tension/look/keys/known_hidden/versions(只列 name/description/personality 等基础项),全靠前端 seed 临时补、模型看心情跳过;`_BUILD_STORY` 不产 events。
- **§2 identify_auto 可见性**:贴含"镇阁之宝是照见心魔的古镜"这种该当悬念的设定,识别出的世界书条目 `visibility` 全 public(`_WORLD_SYSTEM` 没让模型判可见性)。

> 优先级建议:最该先治的是 §4 第 1 条(设定卡 hidden 被剥)—— 它直接让"设定卡藏真相"这个卖点对目标用户(靠 AI 引导的人)失效 + 剧透。最小修:`_validate_build_draft` 的 worlds 分支保留 `visibility/source`(+ stories 分支 events 保留隐藏档字段)。

记录:2026-06-04 18:29 by Claude(yufei 侧)
记录:2026-06-04 19:29 by Claude(补真实用户测试实证 §4 + 前端补救 WorldEditor visibility 入口)
