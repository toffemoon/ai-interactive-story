# 创作四卡种 UX · loop journal(2026-07-13 起)

> 计划=`docs/2026-07-13-create-kinds-ux-plan.md`;分支 `gengyue/create-kinds-ux`(stacked on theme-pure-white);每片四段式:做了什么/验收/坑/下一片。

## P0 · 计划文档 + journal 骨架

- **做了什么**:落计划文档(病根/引擎事实/P1-P3 切片/不做清单/红线),开分支,建本 journal。
- **验收**:文档齐,分支从 gengyue/theme-pure-white 切出。
- **坑**:无。
- **下一片**:P1a 副题层(KINDS 加 sub,四处消费:fly/空板/落卡菜单/卡头)。

## P1a · 一眼懂副题层

- **做了什么**:KINDS 加 `sub`(卡种一句话定位,单点定义);四处消费——rail 新建飞出菜单、空板四按钮、双击落卡菜单、聚焦卡头(`create-card-kind` 变「角色卡 · AI 扮演的人物」式);`.create-kind-btn/.create-kind-sub` 两行按钮样式(名+定位,muted 12px)。手机 `.ct` 分支零改动(红线)。
- **验收**(5199):fly/落卡菜单四卡种副题全对;聚焦卡头带定位;build 过;console 零报错。空板按钮同构同 class,未单验(板上有卡,空板态不可达)。
- **坑**:新开 preview tab 默认窄视口落进手机 `.ct` 分支,rail 不渲染——resize 到 desktop 后必须手动 `window.dispatchEvent(new Event("resize"))`(已知环境坑)。
- **下一片**:P1b 新建即骨架(直接新建预铺 skeleton+hints;世界书三条空条目;注意键名 ∈ src/models.py)。

## P1b · 新建即骨架

- **做了什么**:createTemplates 新增 `world-starter`(name+三条起手条目:一句话定义/铁则/核心地点,WorldEntry 键名 comment/keys/content ∈ models.py)与 `story-starter`(title/premise/main_plot/timeline,全是引擎真消费字段);导出 `STARTER_IDS`(characters→npc-main、players→player-std 复用既有标准套);`newCardOf` 在真空台(无草稿/没聊开/无问题无蓝图)时静默铺起手骨架——与模板同一条路(draft=skeleton、tpl=id、直通 drafting,E5 口径),不 flash 不占输入框;spawnDraftAt 收口在 newCardOf 无需另接。顺手修 LABELS 缺口:main_plot/opening/abilities/constraints/known_facts/unknown 不再裸奔英文。
- **验收**(5199,清台测种→还原备份):四卡种直接新建各自 tpl/phase/draft 键全对(世界书三条目 comment 正确、演出卡 9 键、故事书 4 键、角色卡 npc-main 13 键);聚焦卡空字段带灰字 hint(前提=「开场局面:谁在哪…(✦ 补写 / ✎ 手写)」,数组字段=「点『聊』到命令条补」);build 过;console 零报错;localStorage 台账测后原样还原。
- **坑**:①headless 里 matchMedia change 不派发——新 tab 挂载瞬间窄视口把 useIsMobile 钉在 true,resize 后必须切路由重挂才吃新值(纯环境坑,真浏览器 mq listener 正常);②starter skeleton 含对象数组(entries),种台用 structuredClone 防模板常量被 draft 改写污染。
- **下一片**:P2a 通用列表编辑组件(字符串列表:goals/abilities/constraints/timeline/main_plot 行内增删改)。

## P2a · 通用列表编辑(字符串数组)

- **做了什么**:字符串数组字段(goals/abilities/constraints/timeline/main_plot/speech_rules/known_facts/unknown…全部按型自动命中)从「只读走聊」升级为就地手改——完整复用 editingKey/commitFieldEdit 惯用机制:✎ 打开=一行一条 textarea(placeholder「一行一条,空行不算」,行数自适应),提交按 draft 现值判型回写数组(trim+空行丢弃);空数组字段收编进 ✦ 补写目标(hint 灰字照常)。对象数组(entries/events)不动,留给 P2b 结构编辑。
- **验收**(5199,清台测→还原):演出卡「目标」空态 hint 带「(✦ 补写 / ✎ 手写)」;✎ 编辑三行(含一空行)提交 → draft.goals=三元素数组、卡面顿号重排;build 过;console 零报错。
- **坑**:synthetic FocusEvent("blur") 不触发 React onBlur(React 监听 focusout)——测试提交要走 Ctrl+Enter keydown 路径;真浏览器 blur 正常(与既有字符串字段同一 onBlur 机制,线上已验)。
- **下一片**:P2b 结构条目编辑(世界书 entries/故事书 events;keys 空警示;长按条目=AI 只改这条)。

## P2b · 结构条目编辑(世界书条目 / 故事书节拍)

- **做了什么**:聚焦卡上 entries/events 从只读文本换成结构编辑块——每条=标题行(世界书另有公↔密开关=visibility public/hidden,朱金「密」态)+触发词输入+内容 textarea+删除(有内容先 confirm);「+ 加一条/加一个节拍」;新节拍自带 event_id(引擎 triggered_events 按它结算)。**keys 为空的条目就地朱砂警示「没有触发词,永远不会出场」**(引擎机制的第一可见化)。长按条目空白=AI 只改这条(伪字段 {k:"条目·标题", k0:"entries"} 进 aiCtx 定向指令管线,输入控件 stopPropagation 不误触)。字段头带机制说明(「玩家聊到触发词,这条才注入给 AI」)。story-starter 骨架补 events:[];LABELS.events→「节拍(触发事件)」。触发词输入=uncontrolled+onBlur(受控实时 split 会吃掉刚敲的分隔符),标题/内容受控直写。
- **验收**(5199,清台测→还原):世界书三条起手条目渲染齐(标题/警示×3/公密钮/加一条/机制说明);keys 混合分隔符「灵气、沿海小城,雾」提交=3 词数组、警示 3→2;公→密 visibility=hidden;加/删条目 3→4→3;内容受控写入;长按条目描金 trace→550ms 开 AI sidebar;故事书节拍块渲染、新节拍四键含 event_id、无公密钮(节拍无 visibility);build 过;console 零报错;台账还原。
- **坑**:trace 在触发后还挂 460ms(is-done 封印帧)——验收断言别在 1010ms 前查移除;synthetic 焦点提交用 FocusEvent("focusout")(React 不听 blur)。
- **下一片**:P2c 演出卡 known_facts/unknown 配对提示(防上帝视角)——小片;然后 P3 模板扩容。

## P2c · 演出卡防上帝视角配对提示

- **做了什么**:演出卡「开局未知」字段行内提示——known_facts 非空而 unknown 空时,朱砂警示「『开局已知』写了,这里还空着——不写『不知道什么』,玩家容易开局全知,悬念漏光」;两边都有或都空不打扰。
- **验收**(5199,清台测):初始无警示→列表编辑填两条已知→警示出现(#b5402e)→填一条未知→警示消失;build 过。
- **坑**:无。
- **下一片**:P3 模板扩容。

## P3 · 模板扩容

- **做了什么**:演出卡「轻装上阵」(name/role/goals/opening 四键,三分钟开局);世界书「奇幻规则·带示例」「现代都市·带示例」(各三条**已填好**的示例条目,keys 示范触发词长相,直接改成自己的);故事书「单幕短局」(前提+引子/变数/摊牌三节拍)+「悬疑长局」(四节拍含 hidden 暗节拍「反转」,premise 只写表面局面)。applyTemplate 浅拷贝→structuredClone(模板骨架带对象数组后,防 draft 编辑摸到模板常量)。文案直白无 AI 味;键名全 ∈ models.py(PlayerCard/WorldEntry/StoryEvent 含 hidden)。
- **验收**(5199):演出卡选择器现「轻装上阵 4 字段+标准 9 字段」;world-fantasy 应用=三条示例条目上编辑器、keys 齐全零警示;story-mystery 应用=四节拍(反转带 hidden)、四拍触发词空=四条警示如实提示;build 过;console 零报错;台账还原。
- **坑**:**headless 里 window.confirm 会把 renderer 卡死**(confirmReplaceDraft 弹的替换确认)——navigate force 也解不开,只能关 tab 重开;测试前必须先 stub `window.confirm=()=>true`。已计入环境坑清单。
- **下一片**:收尾回归(四卡种新建→填写→收进本台→装订清单全链路 + 手机 390 不回归),然后删 loop 汇报。
