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
