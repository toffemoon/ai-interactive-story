---
date: 2026-07-11
status: approved(主理人 2026-07-11 口头「可以」)
scope: frontend-next 桌面创作页整页重做;手机 .ct 分支本期不动
---

# 创作页重做:卡即界面(参考 template「文档即界面」模式)

> 模式来源:template repo `docs/onboarding/07-frontend-interaction-plan.md` + `act2-frontend-retrospective.md`。
> 内核:用户对着**产出物**直接动手;块模型 + 块动作 + 内联信号 + 轻入口起草;对话框退役成命令条,AI 的话降级为叙述层。
> 拿的是**交互骨架**,视觉全走沐言语义 token(paper/ink/朱砂/鎏金,kai/serif)。

## 模式映射

| template | 创作页 |
| --- | --- |
| /documents 单画布,旧五页删 | 卡画布居中铺开,聊天栏退役 |
| 有类型的块树 | 字段块:简述/性格/开场白…每字段=独立可选中块 |
| BlockActionTrigger(点选+hover 动作条) | 字段块 hover:✎ 手改 / ⟳ AI 重写 / ✦ AI 补写(空块) |
| P1 窄路径 select→act→inline-apply | 字段级动作=合成定向指令走**同一个** /api/build_card,就地落块+墨晕 |
| 内联信号画在块上 | 空块=虚线待填+引导;新填=鎏金墨晕;隐藏真相=「密」印 |
| ⊕ 轻入口起草(杀 wizard) | 命令条钉底:「说一句,让它长在卡上……」+上传文档 |
| L0 叙述层 | 叙述条:AI 每轮 reply+next_question 只浮最新一句,可关 |
| 📋 时间线 | 创作手记抽屉:完整对话史降级右上角 |
| doc overlay | 不需要:draft 即共享真相,手改直接写 draft,AI 下轮在其上继续长 |

## 布局

```
┌ 创作 · 副标 ─────────────────────── [创作手记 📋] ┐
│ [角色卡·2] [演出卡] [设定卡·世界书] [故事书]              │
├──────────────────────┬─────────────┤
│      卡 画 布(宣纸大卡 ~680px)   │ 本台架(mini卡×n,     │
│  卡名(楷体大字·点击就地改)        │  DepthCard)+补素材   │
│  立绘/头像缩略                │ ── 装订区 ──        │
│  [字段块]×n / ⊕空块引导+起个头   │ manifest 摘要常显     │
│                          │ [收入卡库][收进本台]    │
│                          │ [预览并发布·公开]      │
├──────────────────────┴─────────────┤
│ ✒ 叙述条(最新一句,晕染进场)                            │
│ [说一句,让它长在卡上……          ][上传文档][发送]         │
└────────────────────────────────────┘
```

## 关键交互

- 命令条 = 原 `send()` 原封不动:messages append → build_card → draft 更新;数据结构不变,只是显示降级(叙述条最新一条+手记全史)。
- 字段级 ⟳:合成定向指令(「只把『性格』改写得更立体,别动其他字段」)走同一管线;**坦白原则**:这是 prompt 约定非硬约束,UI 用墨晕如实展示全部实际变化,不宣称锁字段(真锁=引擎核心域,不碰)。
- 就地手改:字段块 ✎ → textarea,blur/⌘Enter 落 draft;entries/timeline 等对象数组字段 v1 只读,动作只有「聊着改」(预填指令跳命令条)。
- 本台架:built 卡从按钮后面搬成可见竖架(mini DepthCard,hover 查看/移除);装订区常显 publishManifest(),「看到的=会发的」(YOR-192)更显性。
- 弹层沿用:完善角色卡 finalize / 补素材 libModal / 预览发布 overlay 原样;builtView 降级为本台架「查看」入口。

## 红线(每片都要守)

- API 契约零改动:/api/build_card、/api/identify*、/api/library/save、/api/presets。
- desks localStorage 形状不变(messages/draft/filled/input/built),老草稿无缝。
- 手机 .ct 分支整个不动;`.env`/key 永不读写;不碰引擎核心;不直推 main。
- 已装素材复用:DepthCard(本台架)/BlurHighlight(叙述条)/StaggeredText(标题)/fieldInk·起个头(已有);不新增 npm 依赖。

## 实施切片(顺序执行,每片独立验收)

- **C0 骨架**:新布局落地(画布+右栏+底部命令条),旧功能全搬家不丢 —— 验收:四卡种切换/发消息/收纳/发布全链路同现状。
- **C1 字段块化**:块渲染+hover 动作条+就地手改落 draft —— 验收:手改后刷新不丢;AI 下轮基于改后 draft。
- **C2 命令条+叙述条+手记抽屉**(聊天栏退役)—— 验收:发送后叙述条只显最新一句;手记全史可见;busy 墨点。
- **C3 字段级 AI 动作**(⟳/✦ 定向指令)—— 验收:目标字段更新+全部实际变化墨晕如实展示。
- **C4 本台架+装订区** —— 验收:收进本台后架上出现;manifest 与发布清单一致。
- **C5 动效/空状态/文案 pass**(铺纸入场/字段错峰/reduced-motion 全量降级)。
- **C6 全链路**:preview 交互脚本全过+console 零报错+`npm run build` 过+手机 390 回归干净。

工作量:Create.jsx 渲染层重写约六七成(逻辑函数原样);Create.css 桌面段重写;新组件 3-4 个(CardCanvas/FieldBlock/CommandBar/DeskShelf)。

## 已拍默认

① 右窄栏保留为「产出侧」(本台架+装订/发布),重心在左画布;② 手机端本期不动;③ 分支切新的(不混进 yor-211 的 Explore/侧栏工作)。
