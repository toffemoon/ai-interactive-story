---
date: 2026-07-11
branch: gengyue/create-canvas-rework
plan: docs/2026-07-11-create-card-canvas-plan.md
---

# 创作页「卡即界面」重做 · loop journal

## 切片状态

- [x] C0 骨架:画布+右栏+底部命令条,旧功能全搬家不丢(R1,6e21bde)
- [x] C1 字段块化:块渲染+hover 动作条+就地手改落 draft(R2)
- [x] C2 命令条+叙述条+手记抽屉(聊天栏退役)(R3)
- [ ] C3 字段级 AI 动作(⟳/✦ 定向指令)
- [ ] C4 本台架+装订区
- [ ] C5 动效/空状态/文案 pass
- [ ] C6 全链路:preview 实测+console 零错+build+手机 390 回归

## R1 · 2026-07-11 07:34

- 现场保护:yor-211 工作区(侧栏重做/Explore showcase/创作页 reskin/dist 新产物/react-bits 组件/方案文档)原样 commit `0091bea`,未 push;长期本地脚手架(prototype/_recon*/.agents/skills-lock/tests/test_db_health.py)保持未跟踪原状。
- 切出 `gengyue/create-canvas-rework`(基于 yor-211 @0091bea)。
- 本轮目标:C0 骨架。

### R1 结果:C0 ✅(证据全实测,5199 preview @1366×860)

- 布局:`.create-stage` grid 796px|300px;画布 680px 居中(x=212);信笺坞(消息条+命令条)在底;页面不滚(scrollHeight==viewport);旧 `.create-chat` 不再渲染。
- 四卡种切换:kind 标签/输入框占位/起手句/空卡开场白四者联动实测通过(演出卡/故事书/角色卡来回切)。
- 发消息全链路(真后端:8000+DeepSeek):起手句点击→输入框填入→发送→"你"气泡入坞→墨点 busy→AI 真回包("雨夜、书店、银发少女——氛围感已经有了…")→**14 个字段长在画布上**(简述/性格/情境设定/开场白…),空卡退场,fresh 墨晕×2,收入卡库/收进本台按钮由灰转亮;输入框清空。
- 弹层沿用:完善角色卡 modal 开/关 ✓;预览发布 overlay 开/关 ✓(manifest:「角色卡 ×1:未命名」);无草稿时收纳按钮置灰(同现状)。
- console 零报错;`npm run build` 1.92s 过(Create chunk 59.1kB);手机 390 回归:`.ct` 4 tab/草稿条/composer 全在,桌面骨架无泄漏(preview 模拟器 resize 不派发事件,手动 dispatch 后验证——工具环境怪癖非代码问题;preview_screenshot 30s 超时=本环境已知,证据走计算样式+交互实测)。
- 遗留观察:①卡名暂"未命名"(AI 追问阶段未起名,行为同现状);②世界书 known_public/versions 等键无 LABELS 中文映射,现状既有,C5 顺手补;③旧 .create-body/.create-chat/.create-preview/.create-card 样式已无引用,C5 清理。
- ⚠️ 并行会话注意:同工作树有另一会话活动(yor-211 已推成 PR #158;本分支被叠了 docs commit 8654805)。本轮提交只收 C0 自己的文件。

## R2 · 2026-07-11 07:49

本轮:C1 字段块化 ✅(5199 preview 实测)

- 实现:字段=块(hover 出动作条),纯文本字段 ✎ 就地手改(textarea,blur/⌘Enter 提交、Esc 取消),结构化字段(entries/timeline/tags…)「聊」= 预填定向指令跳命令条;卡名点击就地改(Enter 提交,写 name/title 所在键);「密」印内联标记隐藏真相字段;切卡种丢弃未提交编辑。手机 .ct 分支零改动(同名字段渲染出现 2 处匹配时用桌面空卡分支锚点精确替换,红线守住)。
- 验收证据:
  - 手改「性格」→ store draft.personality=改后值,画布同步渲染,编辑器关闭;
  - **刷新不丢**:reload 后 14 字段仍在、性格=手改值;
  - **AI 下轮基于改后 draft**:fetch 透传拦截实捕 /api/build_card 载荷,draft.personality=手改值、messages 尾=新输入(真发真回,AI 顺着继续聊名字);
  - 卡名就地改:「未命名」→「苏晚棠」,store+显示同步;
  - 「聊着改」:点「说话规则」的聊 → 命令条预填「把「说话规则」这部分改一下:」;
  - console 零报错;build 1.93s(Create chunk 60.9kB)。
- 环境备注:无头 preview 里 autoFocus 拿不到真焦点,element.blur() 无事件 → 测试用 focusout 手动派发走通提交;真浏览器 blur 自然触发,代码无改动必要。
- 遗留观察:AI 骨架会带一批空串字段(name/first_mes/anchor…)在画布上渲染成空行——现状既有;C3 把空的可编辑字段做成 ✦「补写」目标顺手收掉。

## R3 · 2026-07-11 08:04

本轮:C2 叙述层 ✅(5199 preview 实测)——聊天栏正式退役

- 实现:信笺坞的临时消息条删除;叙述条=AI 最新一句浮在命令条上方(✒ 批注笺样式,BlurHighlight 晕染进场,✕ 可关,新回复自动重亮);busy=墨点在叙述条位置起伏;页头「✒ 创作手记 · N」入口 → 右滑抽屉看全史(开即滚底,scrim/Esc/✕ 三路可关);空台(messages==1)不显示叙述条,开场白只在空卡上,不重复。desk.messages 数据结构原样,纯显示降级。
- 验收证据:
  - 消息条退役:.create-dock-msgs 不再渲染;
  - 叙述条=最新一句:与 store 最后一条 AI 消息前缀比对通过(改名回合/开场白回合两次);
  - 手记抽屉:5→7 条全史与 store 一致,打开即滚到底,scrim 点击/Esc/✕ 关闭全通;
  - ✕ 关闭后,真发一条(「就叫苏晚棠,把开场白写一句」)→ 回包自动重亮且只显新句;AI 顺带把 first_mes 真写进画布字段;
  - 空台不显条:故事书(1 条开场)无叙述条 ✓;
  - console 零报错;build 2.10s(Create chunk 62.8kB)。
- 红线自查:手机 .ct 未动;desks 形状未动;三弹层未动;无新依赖;token 皮肤;不碰 main。
