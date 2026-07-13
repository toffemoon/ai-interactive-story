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
