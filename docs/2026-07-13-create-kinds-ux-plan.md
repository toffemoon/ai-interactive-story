# 创作四卡种 UX 补齐 · 计划(2026-07-13,主理人确认)

> 主诉(主理人):角色卡已慢慢完善,但演出卡/设定卡·世界书/故事书三种「用户点开完全没有办法理解这是来干什么的」。要求:一眼看懂 + 补必要功能与内容。
> 执行 journal:`docs/2026-07-13-create-kinds-ux-loop.md`。分支 `gengyue/create-kinds-ux`(stacked on `gengyue/theme-pure-white`,PR base 同;#169 合并后改 base 到 main)。

## 0. 病根

角色卡的待遇(骨架字段+逐字段灰字引导+双模板+完善弹窗)其余三种没有:点「+演出卡」出来的是一张空 `{}` 草稿卡加一句开场白——用户不知道 ①这卡在一局里演什么位置 ②建成后长什么样 ③下一步干什么。

## 1. 引擎事实(后端摸底结论,设计以此为准)

- **演出卡 = PlayerCard(玩家主角操作面)**,整张卡 JSON 每回合进 prompt(`src/story.py:996`)——每个字段都真的有用。字段:name/role/background/goals/abilities/constraints/known_facts/unknown/opening(`src/models.py:87-99`)。goals→初始 active_goals、known_facts→facts.revealed 有结构化消费。
- **世界书 = 条目 + 触发词命中才注入**(`_world_keyword_hits`,`src/story.py:355-367`),非整卡塞 prompt;`visibility=hidden` 条目跳过注入(暗设定);每回合上限 8 条;**keys 为空的条目永远不会出场**。收尾软标准=有名字+≥3 条(`src/identify.py:535`)。「设定卡」在引擎里不是独立运行类型,导入时摊平成世界书条目。
- **故事书 = 引擎机制最重的卡**:premise/timeline/main_plot/endings 常驻 prompt 总览;events 节拍带 trigger_keywords(命中触发)/reveal_after(前置门控)/due_clock(时钟到点主动登场)/escalate_after_idle;结局有代码客观判定(required_events/required_facts,`src/story.py:604`)。创作端目前零露出。
- **完整度 = LLM 按 kind 各 5-6 个维度自评单一 0-100 分**(`_UNDERSTAND_ASPECTS`,`src/identify.py:560-565`),<60 只准提问。
- 角色卡 anchor/tension/keys/known_* 在引擎里是**摆设字段**(2026-06-04 只落字段未接引擎)——创作端降低视觉权重,不渲染假承诺。

## 2. 切片

- **P1a 一眼懂副题层**:新建 fly 菜单/空板四按钮/双击落卡菜单/卡头,每处一行卡种定位——角色卡「AI 扮演的人物」、演出卡「你扮演的主角」、世界书「世界的规则手册,聊到触发词才出场」、故事书「这一局的剧本:开场、节拍、结局」。KINDS 加 `sub` 字段,一处定义全站生效。
- **P1b 新建即骨架**:四卡种直接新建(不走模板)也预铺 skeleton+灰字 hints,拉齐角色卡待遇;世界书=三条空条目起手(一句话世界定义/一条铁则/一个核心地点,对齐完整度维度与 ≥3 条收尾标准)。
- **P2a 通用列表编辑组件·字符串形态**:演出卡 goals/abilities/constraints、故事书 timeline/main_plot 增删改行内编辑(现在数组字段只能「聊」)。
- **P2b 结构条目形态**:世界书 entries(标题 comment+触发词 keys+内容 content+隐藏开关 visibility);故事书 events 节拍(title+trigger_keywords+summary);**keys 为空警示「没有触发词,永远不会出场」**;长按单条目=AI 只改这条(aiCtx 字段语境机制扩一档粒度)。
- **P2c 演出卡防上帝视角**:known_facts/unknown 配对提示(有已知没未知=给提醒)。
- **P3 模板扩容**(createTemplates.js,文案归内容侧):演出卡轻装版(身份/目标/开场三字段);世界书 2-3 套各带三条示例条目;故事书「单幕短局」(前提+3节拍+1结局)+「悬疑长局」(含隐藏节拍/分层揭示)。
- **收尾回归**:四卡种新建→填写→收进本台→装订清单全链路 + 手机 390 不回归。

## 3. 不做(留给主理人拍)

- **P4 引擎侧**:结局条件(required_events)/节拍前置(reveal_after)的创作 UI 要往引擎消费链上接;角色卡摆设字段是否转正——引擎核心=主理人决策域。
- **「演出卡」改名**(如「主角卡」):内容侧命名决策,P1a 先用副题救场;定了改 KINDS 一处全站生效。

## 4. 红线

零后端改动;skeleton/字段键名必须 ∈ `src/models.py` 对应模型字段(否则 `/api/build_card` 回包被 `_validate_build_draft` 按 model_fields 过滤静默丢键);手机 `.ct` 零改动;零新 npm 依赖;颜色只走语义 token;文案直白禁 AI 味;每片一 commit,gate(build+5199 实测+console 零报错)全绿才进下片。
