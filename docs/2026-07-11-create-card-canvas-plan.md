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


---

# E 系列:完整度门控创作(2026-07-12 批准,主理人四拍板+两修正)

> 拍板:后端硬门槛 / 选项式问题 / 左会话右卡双栏(artifact 式) / 蓝图批准才落笔。
> 修正:评分术语=**完整度(completeness)** 非"理解度";前端用 React Bits + frontend-design skill;**少用卡片和框**(排版层次/留白/墨线,不框套框)。

## 状态机(desks[kind].phase 可选键,向后兼容)

understand(新空台默认,只问不写) → 完整度≥60 → blueprint(蓝图待批) → 批准 → drafting(现行为)。
快速通道:导入/改编/模板铺骨架=已带内容 → 直接 drafting;老草稿(有 draft 无 phase)→ drafting。

## 切片

- **E0 后端门控(引擎核心,单独 commit,主理人审+压测)**:BuildCardReq 加可选 phase(默认 "drafting"=旧行为,MCP/smoke/旧前端零影响)+threshold(默认 60)。understand 阶段换 JSON 契约:completeness 0-100 自评+questions(≤3 题,每题 3-5 具体选项+自由输入,复刻 StoryChoice 的 _normalize 范式)+达标改出 blueprint(4-6 要点);**代码强制:understand 阶段 draft 一律回退 prev(丢弃模型输出)**——prompt+代码双保险。解析失败降级现状纯文本。压测脚本(untracked 惯例)3 用例:信息少→低分+问题+draft 不动;补答→分升;高分→blueprint。
- **E1 双栏骨架(先 invoke frontend-design skill)**:左会话流(全部消息+问题/蓝图/完整度都长在流里,命令条钉底)|右卡画布=artifact。叙述条/手记抽屉退役。**设计纪律:少框——问题/蓝图用排版层次(缩进/字重/hairline/留白)不用边框卡;React Bits 素材合适才用**。
- **E2 门控接线**:phase 状态机+完整度进度(60 刻度);understand 态画布=构思中空态;收纳/发布置灰。
- **E3 问题交互**:选项 chips 点选+自由输入,一键提交合成一条用户消息走原管线。
- **E4 蓝图与批准**:要点排版呈现+【批准,开始写】(切 drafting+自动发落笔指令)/【再聊聊】。
- **E5 快速通道**:导入/fork/模板直通 drafting;seed 在 understand 照常参与;老数据无缝。
- **E6 手机+回归+PR**:.ct 对话流渲染问题/蓝图/完整度组件(布局不动);全链路回归;stacked PR(#159→#160→#161)。


---

# F 系列:AI 触点皆可控(2026-07-12 主理人宗旨)

> 宗旨:**任何用到 AI 的地方(改写/从零写/解析),用户都必须能——写提示词、拖拽、或 refer(提示词/角色卡等)**。
> 两拍板:引用通道**动后端做干净**(refs/hint 可选参数,默认空=旧行为,单独 commit+主理人审+压测);一键 AI 按钮改成**点开一行指示输入,可空回车=默认**。

## 现状落差(盘点结论)

全站 AI 收敛到两端点:build_card(富:draft+seed+对话)/identify*(贫:只吃 text)。黑盒触点:✦ 补写/⟳ 改写(Create.jsx:347-353 固定指令)、批准蓝图(:282)、自动生成介绍(genIntro:528-552)——全是一键无输入;导入解析(TextReq 只有 text)完全带不了指示;refer 载体只有 seed 一条(6000 字,语义混装);提示词库/拖拽零实现(green field)。

## 通道设计

- **build_card 加 `refs: list[{label,text}]`**(≤4 条,单条 text 截 3000、label 截 60):拼接在 seed 之后 draft 之前,每条独立标签段「【用户引用:label——优先照它的口味/设定来,别整段照抄】」;understand 阶段同样吃(完整度评分计入引用材料)。
- **identify 四函数加 `hint: str`**(截 1000,共享 `_hint_block`):「【用户对这次解析的额外要求——不破坏 JSON 格式前提下优先遵守】」;世界书 markdown 快路径在 hint 非空时跳过(用户给了指示=要 AI 按指示重组,纯代码切分吃不到指示)。
- **前端 desk 加可选键 `refs`**(挂台常驻,chips 可摘,随每轮请求走;与 seed 双轨:seed=散文资料,refs=结构化引用);提示词库 localStorage `ais_prompt_lib_v1`。

## 切片

- **F0 后端通道(引擎核心,单独 commit,主理人审+压测)**:BuildCardReq+refs / TextReq+hint / identify.py 五处注入;压测 4 用例(refs 空=旧行为;带 ref 卡→内容被参考;hint 空=旧行为;hint 可验证指令生效)。
- **F1 提示词库**:localStorage 存/删/改名;引用面板一个 tab;「把当前输入存为提示词」。
- **F2 引用面板+纸签 chips**:composer 上方 refs 纸签行(小字+hairline+×,少框);「@ 引用」命令条按钮+输入 @ 唤起;面板 tab=本台已建/我的卡库(四 kind 可切)/提示词库;卡→cardToRefText(核心字段拼可读文本)。
- **F3 一键 AI 长出指示行**:✦/⟳ 点开内联一行(可空回车=默认指令,Esc 收);生成介绍同款;批准蓝图旁可选附言拼进落笔指令。零后端(extra 拼指令文本)。
- **F4 拖拽引用(桌面)**:台架/装订区/卡库行 draggable;composer 区 onDrop=落纸签;拖起时接收区淡纸底+虚线 hairline 提示。手机不做(@ 面板覆盖)。
- **F5 导入解析指示**:导入面板(粘贴/上传)加可选「解析要求」一行→请求带 hint;酒馆卡纯本地解析无 AI,如实不加。
- **F6 手机+回归+PR**:ct-composer 加 @ 按钮与纸签行(布局红线内);全链路回归;stacked PR #162(base=E 分支)。

## 边界(如实)

refs 每轮随请求进 prompt=token 成本随挂随涨(纸签常显可摘,与 seed 同口径);identify hint 属解析口味微调,不保证字段级服从(prompt 约定);拖拽 HTML5 原生 API,无第三方依赖。
