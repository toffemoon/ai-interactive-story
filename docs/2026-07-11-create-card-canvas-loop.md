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
- [x] C3 字段级 AI 动作(⟳/✦ 定向指令)(R4)
- [x] C4 本台架+装订区(R5)
- [x] C5 动效/空状态/文案 pass(R6)
- [x] C6 全链路:preview 实测+console 零错+build+手机 390 回归(R7)

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

## R4 · 2026-07-11 08:19

本轮:C3 字段级 AI 动作 ✅(5199 preview 实测,两次真回包)

- 实现:send() 抽成 sendText()(命令条与字段指令共用,messages/draft 契约不动);**filled 改为客户端 diff**——每轮如实标出实际变化的字段(坦白原则落地);字段动作条:非空文本字段 ⟳ 改写、空字段 ✦ 补写(AI 骨架空行就此收编,显示「还空着——✦ 让 AI 补写,或 ✎ 手写」)、结构化仍走「聊」;busy 时全部动作钮置灰。
- 验收证据:
  - ✦ 补写「锚点」:draft.anchor 由空 →「在每一个雨夜,等待一个永远不会再踏入书店的人。」;actualChanged=[anchor],filled==diff,墨晕精确落在锚点;
  - ⟳ 改写「性格」:在 R2 手改文本基础上扩写(「嘴硬心软」内核保留 → 决策模式展开);actualChanged=[personality],diff==filled==屏上墨晕;
  - **坦白原则双向验证**:首次 ✦ 模型只讨论没写字段 → diff 为空、零墨晕(没有假高亮);随后把指令加硬(「不要反问,这一轮就写」)后成功;首次未遂如实记录;
  - 定向指令以「你」的消息入 messages(手记可溯源);console 零报错;build 1.93s。
- 备注:「尽量别动其他字段」仍是 prompt 约定非硬锁,本轮两次模型都只动了目标字段;若未来动了别处,diff 墨晕会显形——UI 不撒谎。

## R5 · 2026-07-11 08:33

本轮:C4 本台架 + 装订区 ✅(5199 preview 实测)

- 实现:built 卡从「查看本台已建」按钮后面搬成右栏可见竖架——mini 卡(DepthCard 5° 视差,鎏金书脊,卡名楷体+首字段摘要),hover 出「查看/移除」;「查看」直通原 builtView 弹层(降级为入口,弹层沿用),「移除」保留 confirm 守卫;actions 里旧按钮退役。装订区常显 publishManifest() 摘要(dashed 订书线样式,含 ⚠ 隐藏真相提示),与 publish/预览弹层同源 deskCards——「看到的=会发的」(YOR-192)常驻化。
- 验收证据:
  - 初始:架空态(「还空着——聊出一张,点『收进本台』」),装订清单已把 draft 计入(角色卡 ×1:苏晚棠);
  - 收进本台真链路:点按钮 → 完善角色卡弹层 → 确认 → built=1,架上出现「苏晚棠」(副题=简述前 22 字),画布归空,装订清单无缝从 draft 源切到 built 源(仍 ×1:苏晚棠);
  - **manifest 一致性**:装订区文本与预览发布弹层 .ct-pub-manifest-list 逐字一致(同源函数保证);
  - 架上「查看」→ builtView 弹层(「本台已建的『角色卡』(1)」,苏晚棠)✓;「移除」confirm=false 时不删(守卫 wired,未做破坏性删除,苏晚棠留给 C6 全链路用);
  - console 零报错;build 1.96s。
- 遗留观察:收进本台后 desk.messages 重置为 1 条收纳提示,叙述条按「>1 才显示」规则不显示这句(toast 已有反馈)——C5 打磨时评估是否放宽为「非开场白就显示」。

## R6 · 2026-07-11 08:48

本轮:C5 动效/空状态/文案 pass ✅(5199 preview 实测)

- 动效:字段块错峰铺纸入场(40ms 步进,--ci 封顶 8 级防长卡拖沓,实测 delay 0.12/0.16/0.20s);reduced-motion 清单同步(.create-stage/.create-field 入列)。
- 叙述条规则放宽:由「消息数>1」改为「最新 AI 句 ≠ 开场白」——收进本台的确认句(《苏晚棠》放进台子了…)现在会亮在叙述条上(修 R5 遗留);空台仍不显示(开场白只住在空卡上)。
- 文案:LABELS 补 known_public=公开设定 / known_hidden=隐藏设定 / versions=多版本 / relationships=关系(实测注入 draft 显示中文,测试数据已还原)。
- 死样式清理:旧桌面布局层(.create-body/.create-chat/.create-msgs/.create-preview/.create-card/.create-card-tilt + reskin 时期的 sticky/高度规则)8 处精确切除;.create-msg/.create-field 等内容类继续服役(手记抽屉/手机端在用);删后布局完整性实测(canvas/shelf/bind/dock/grid 全在)。
- console 零报错;build 1.94s。

## R7 · 2026-07-11 09:03 —— C6 全链路 ✅ + 收尾账

全链路回归(5199 preview,真后端):

- 冷加载:卡种 tab 记忆(KI)生效——停在故事书台则架空/叙述条静默均正确;切回角色卡后架上苏晚棠/叙述条亮收纳句/装订清单一致;
- 核心循环:起手句 → 真发送 → 14 字段长上画布(全新 draft,fresh ×14 如实)、空卡退场、叙述条=最新回复、手记计数联动;
- 手改:「简述」✎ 追加"(C6 手改回归)"→ store 落盘;
- 收入卡库真链路:finalize 确认 → toast「已收入卡库 · 私密」(test 库 library 真写一行);从卡库补素材 → 15 条列表真读;
- 装订区 vs 发布 overlay:manifest 逐字一致(角色卡 ×2:苏晚棠、未命名);发布 overlay 内 StoryHero 详情页渲染、CTA「发布到探索 · 公开」可用——**未点真发布**(会在 test 库造公开预设,链路验到 CTA 为止,与历轮测试深度一致);
- 手记抽屉:3 条全史,Esc 关;
- 手机 390 回归:.ct 4 tab/草稿条/composer 全在,桌面(stage/dock/shelf/narr/journalBtn)零泄漏;
- console 零报错;build 1.92s(dist 与 C5 相同 hash,未变)。

### 收尾

- 六切片六 commit:C0 6e21bde / C1 7dd94da / C2 c99ba85 / C3 60b3fe8 / C4 6761d7b / C5 e8a0324;分支 gengyue/create-canvas-rework(基于 yor-211 保护点 0091bea)。
- 红线全程未破:手机 .ct 分支零改动;API 契约(/api/build_card /identify* /library/save /presets)与 desks localStorage 形状不动;三弹层沿用;npm 零新增依赖;视觉全语义 token;.env 未读写;main 未碰。
- 已知边界(如实):①「尽量别动其他字段」是 prompt 约定,diff 墨晕兜底显形;②结构化字段(entries/timeline/tags)v1 只读走「聊」;③真发布未在测试中执行;④无头环境 blur/autoFocus 弱,真浏览器无此问题。
- 测试残留:test 库 library 多两行私密卡(苏晚棠/未命名守夜人),preview 浏览器 localStorage 留有测试台数据(与用户浏览器无关)。

---

# D 系列(创作者功能)· 同 journal 续记

> 方案:.claude 计划已批(2026-07-11 晚),D 系列=prompt 脚手架+从现有内容 generate。分支 gengyue/create-creator-tools(基于 rebase 后的 create-canvas-rework@47cf57c,PR #159 已随 rebase 更新)。
> 切片:D1 seed 参考资料 / D2 导入即成卡(粘贴/上传/酒馆 JSON+PNG) / D3 模板库(card-templates 提炼) / D4 改编(卡级+故事级) / D5 导出 / D6 手机最小入口 / D7 回归+PR。

## D1 · 2026-07-11 20:41 ✅ 参考资料(seed 喂料)

- 实现:sendText/genIntro 传 desks[kind].seed(可选键,老数据 || "" 兜底);collectToDesk 保留 seed 清 tpl;命令条「挂资料」钮/鎏金徽章(参考 · N字);空卡入口行;弹窗(6000 存储即截断+超长高亮提示+成本明示「每轮都参考,更慢更贵」+清除)。
- 验收(5199 实测,真后端):
  - 挂 103 字私设 → 载荷 seed 完整;**考题实锤**:问「她怕什么」,AI 答「根据资料,她唯一害怕的是打雷,因为母亲在雷雨夜失踪」并写进 draft.description——从"从零聊"变"基于我的资料长";
  - 7500 字粘贴 → 计数红提示"超出不保存" → 存 6000,徽章 6.0k字;
  - worlds 老 desk(无 seed 键)→ 拦截验载荷 seed:""(零真调用),行为同现状;
  - 收进本台 → seed 保留(6000 仍在,built+1,draft 清);刷新 → 徽章仍亮;
  - console 零报错;build 过。

## D2 · 2026-07-11 21:0x ✅ 导入即成卡(粘贴/上传/酒馆 JSON+PNG)

- 实现:空卡「直接导入成卡」面板三入口——粘贴文本(直调 identify,跳过 /api/upload)/上传文档(现有链路,抽出共享 applyIdentified)/酒馆角色卡(.json/PNG,仅 characters;lib/tavernCard.js 纯前端解析)。两种口径当面写清:identify 路径「会同时收进你的卡库(私密)」,酒馆路径「本地解析,不入库、不耗额度」。已有草稿导入前 confirm 替换。白名单与后端 model_fields 对齐(15 键),酒馆特有字段如实播报略过;character_book 自动提文本并询问「挂为参考资料」(桥接 D1);PNG 本体压缩后顺手填 draft.image(空才填);zTXt/iTXt 压缩变体诚实报错引导导 JSON;大 chunk 分块解码防栈溢。
- 验收(5199 实测):
  - 粘贴散文「林默」→ 真 identify → 16 字段铺上画布、面板自关、卡库入库(文案已预告);
  - 酒馆 V2 JSON「白栎」→ 白名单进 draft(creator_notes 被滤),叙述条播报「4 个酒馆特有字段暂不支持:creator_notes、alternate_greetings、system_prompt…」;**character_book 两条目桥成 seed(42 字)——D1/D2 打通**;
  - 手工构造 PNG(tEXt chara chunk)→「PNG测试·砚青」纯本地解析进 draft,零网络请求;
  - 坏文件(JPG 改名 .png)→ 面板内红字「导入失败:不是 PNG 文件」,不关不崩;
  - console 零报错;build 2.03s。

## D3 · 2026-07-11 21:2x ✅ 创作模板库(card-templates 提炼)

- 实现:createTemplates.js(文案归内容侧,来源逐套标注)——characters 两套(主要NPC 13 字段/隐藏角色 11 字段;**次要NPC 忠于 2026-06-08 内容侧决定不做**,已收进设定卡)、演出卡、世界书(纯 opener)、故事书;skeleton 键名全部 ∈ 后端模型字段。空卡「从模板起手」入口+选择器(复用导入卡片样式+字段数徽章);applyTemplate:骨架直落 draft(空串=✦ 目标、空数组=「聊」目标)、opener 只进输入框、tpl 只存 id;空值渲染统一接 hints(文本+数组都显引导,替换默认「还空着」)。
- 验收(5199 实测):
  - 选主要NPC → 13 键骨架铺开、锚点/说话规则等字段显专属引导、opener 预填未发送、tpl=npc-main 落盘;
  - ✦ 补写锚点(真调)→ **骨架 13/13 键全部过后端存活**(_validate_build_draft 键名铁律实证);anchor 内容取自 seed(D2 桥进来的伞骨信世界书)——模板骨架×seed 资料×字段补写三者协同;diff 墨晕如实标出模型顺手动的 tags/versions;
  - 刷新 → tpl/骨架/引导文案全持久;
  - 世界书模板 → 纯 opener 进输入框,draft 保持空;
  - console 零报错;build 1.78s。
- 边界如实:模板入口只在空卡态(有草稿时不可达,confirmReplaceDraft 分支保护的是「只有图无字段」的边缘态);「已有草稿时选模板 confirm」未实测(该状态在 UI 上不可达,逻辑保留)。

## D4 · 2026-07-11 深夜 ✅ 从已有改编(卡级+故事级)

- 实现:forkToDraft(双层解包兼容 chara_card_v2 信封;名字加「·改」防 library upsert 覆盖原卡;目标台有草稿先 confirm);「从卡库补素材」行改双动作(加入本台/改编成草稿,行由 button 改 div 防按钮嵌套);Mine「我创建的」详情弹层加「去改编」(CharDetailModal 可选 onAdapt prop,sessionStorage 一次性 payload 复刻探索→纯聊范式,读完即删);故事级:「↺ 从我发布的故事继续改」(装订区入口)→ /api/presets 列表 → 整组拆回四台 built(追加不覆盖、不动原预设,官方故事也可拆——拆的是副本)。
- 验收(5199 实测):
  - 卡级 fork:《林默》→《林默·改》16 字段铺画布、弹层自关、原卡在库;
  - Mine 链路:发送端在本地 AUTH off 环境不可达(「我创建的」按 official 过滤,匿名保存的卡全记官方名下——环境语义非 bug,真机 AUTH on 复查留 D7 备注);**接收端实测**:注入 payload →《白栎·改》铺画布+自动切角色卡 tab+payload 读完即删(刷新不重复);反向验证以代码判定收口(onAdapt 仅 Mine created 传);
  - 故事级拆回:官方《雨夜档案-第七站台》→ 角色 3→6、演出 0→1、世界 0→1、故事 0→1(追加语义,原 3 张保留),toast 精确汇报,装订清单实时联动(角色卡 ×7…);
  - build 1.88s。
- ⚠ 插曲如实:D4 编辑中途 console 出现 6 条 Create 崩溃(同一事件×6 订阅通道)——分批 Edit 的 HMR 中间帧(kind effect 先引用 setPresetsModal、state 声明后落)。冷加载复验:error 计数零新增、全功能正常,最终代码干净。教训:同组 state+引用应一次 Edit 落盘,已记。

## D5 · 2026-07-12 凌晨 ✅ 导出 JSON

- 实现:exportCard——characters 走现成 wrapCard 套 chara_card_v2 信封(与酒馆 JSON 同构,**可被 D2 导入原样吃回**),其余卡种导裸 data;Blob+<a download> 纯前端零请求。入口:动作列「导出草稿 JSON」(无草稿置灰)+ builtView 每卡「导出」。
- 验收:点击导出 → toast「已导出《白栎·改》.json」(链路无异常);builtView 6 卡各带导出钮;round-trip 由同构性成立(D2 已实测解析 {spec,data} 信封);build 过(1.80s)。

## D6 · 2026-07-12 凌晨 ✅ 手机最小入口

- 实现:①结构修正——D1-D4 四个弹窗从桌面分支迁到「桌面/手机共用弹层区」(python 锚点搬移+缩进归一,否则手机触发状态弹窗不渲染);②.ct「更多」面板加两项:导入已有内容(开 D2 面板)/参考资料徽章行(字数+查看/清除)。.ct 布局其余零改动。
- 验收(390px 实测):ct-more 五项就位;导入面板在手机打开(3 入口)、seed 弹窗打开(42 字徽章正确);.ct 聊天/composer 原样;桌面 1366 回归:seed 弹窗/presets 弹窗迁移后照常可开;build 过。

## D7 · 2026-07-12 凌晨 —— D 系列收尾账 ✅

- 冷加载全量回归(5199):画布(白栎·改)/本台架 ×6/seed 徽章(42字)/装订清单(角色×7+世界+演出+故事)+拆回入口/导出按钮/字段动作条全部就位;手机 390(D6 轮)/桌面弹窗迁移回归已各自验;console error 总数封在 6(全部为 D4 编辑中途一次 HMR 瞬时事件,冷加载零新增);build 1.73s。
- 六切片六 commit:D1 3cfdd7c / D2 52b11c6 / D3 0187242 / D4 04d095e / D5 4dbea99 / D6 e084d38;分支 gengyue/create-creator-tools(基于 rebase 后的 create-canvas-rework,stacked 于 PR #159)。
- 红线:API 契约零改动(seed 用的是后端已实现参数);desks 兼容扩展(seed/tpl 可选键,双向兼容);手机 .ct 仅 ct-more 两项(主理人拍板的例外);三弹层沿用;npm 零新增;token 皮肤;main 未碰。
- 已知边界(带进 PR):seed 每轮计费(UI 三重明示);「别动其他字段」是 prompt 约定(diff 墨晕兜底);酒馆 zTXt 不支持(诚实报错);Mine「去改编」发送端在 AUTH off 本地不可达(环境语义),真机 AUTH on 建议走查;identify 入库 vs 酒馆本地的双口径已当面写清。
- 测试残留:test 库 library 新增若干私密卡(林默等),preview 浏览器 localStorage 留测试台数据(与用户浏览器无关)。

---

# E 系列(完整度门控)· journal 续记

> 分支 gengyue/create-completeness-gate(stacked on create-creator-tools/#160);方案见 plan 文档 E 章。

## E0 · 2026-07-12 01:54 ✅ 后端完整度门控(引擎核心,请主理人重点审)

- 实现(src/identify.py + src/api.py):build_card 加 phase(默认 "drafting"=原行为,旧前端/MCP/冒烟零影响)+threshold(默认 60);understand 阶段独立 system 模板(按 kind 给评估维度)——completeness 0-100 自评+questions(≤3 题,每题 3-5 具体选项,_normalize_questions 容错规整,复刻 StoryChoice 姿势)+达标出 blueprint(≤8 条);**代码强制:understand 阶段 draft 一律 _validate_build_draft(kind, prev, prev) 回传——模型输出的 draft 丢弃**;questions/blueprint 按分数互斥整理;next_question 兜底第一题(纯文本降级);BuildCardReq 加两可选字段,端点透传(无 response_model,新键自动到前端)。
- 压测(_smoke_completeness.py,untracked 惯例,真调 DeepSeek 四用例全过):
  - U1「我想要一个角色」→ completeness=0、questions 带具体可点选项(林默/瘸腿老猫/夜莺…)、零蓝图、draft 空壳;
  - U2 已有 draft+用户催「随便写完」→ **不写**:draft 三字段与 prev 逐字一致,分 25 继续问(「你和她是什么关系」);
  - U3 充足信息+seed → 65 分达标、blueprint 5 条(锚点/基调/带例句的腔调/关系/开场画面)、questions=[];
  - R4 缺省 phase → 原行为(写出 8 字段),返回不带门控键。
- 治理:引擎核心改动,单独 commit;合 main 前主理人审(压测输出如上,脚本在工作树可复跑)。

## E1 · 2026-07-12 02:1x ✅ 双栏骨架(左会话右卡,artifact 式)

- 设计(frontend-design skill 校准):调色/字体不动(沐言 token 是既有体系);设计自由度花在会话流排版语言——**稿纸对谈体**:说话人小楷标(你=朱砂/助手=墨灰)+正文直排纸面,零气泡零框;栏间一条墨线分隔;完整度火候线/圈选词/填空题式自由输入将在 E2/E3 落。
- 实现:.create-studio 双栏(会话 clamp(320,26vw,400) | stage 吃剩余);stage 内产出侧瘦身 300→240,画布优先(1366 实测 355/477/240);命令条(含挂资料/上传)钉左栏底;chatRef 移会话流;**叙述条/手记抽屉/页头手记按钮全部退役**(会话即历史),孤儿状态(journalOpen/narrClosed/lastAi)与样式段清除。
- 验收(5199 实测):双栏就位、7 条历史以对谈体渲染(无气泡背景)、发送流(拦截式零 token)消息 append+busy 墨点+错误行+自动滚底;画布/产出侧(架/装订/动作 5 钮)照旧;页面不滚;390 手机 .ct 原样零泄漏;console 零报错;build 过。

## E2 · 2026-07-12 02:4x ✅ 门控接线 + 完整度火候线(端到端首验)

- 实现:deskPhase 状态机(显式 phase 优先;老数据有草稿/已聊开=drafting 不回拽;新空台=understand);sendText 按台阶段带 phase/threshold,understand 响应只存 comp/questions/blueprint 不动 draft,拿到蓝图自动切 phase=blueprint;**完整度火候线**(signature:墨→鎏金渐染 2px 细线,60 处朱点=落笔线,一根线不是框),drafting 后退场;understand 画布空态文案=「构思中——…完整度过线、蓝图点头,再落笔」;dev 基建:vite 代理目标支持 AIS_API_TARGET 环境变量(默认 8000 不变,用户 dev server 零影响),5199 preview 指向自起的 8017 新代码后端。
- 验收(8017 新后端,真调三轮):
  - 「我想演一个人」→ comp=10,火候线 10%,两题各 4 选项落 desks,draft 零用户内容,画布构思态,收纳灰;
  - 丰富信息一轮 → comp=40(爬升),仍只问不写;
  - 补性格/开场+「就这些,够了」→ **comp=85 过线,blueprint 五条**(锚点/基调/关系张力/能力限制/开场方向,内容精准贴用户素材),phase 自动切 blueprint,火候线「过线,可以落笔」;**三轮全程 draft 无一字用户内容——硬门槛端到端铁证**;
  - 兼容性实证(意外收获):旧后端(8000)+新前端=优雅降级为旧行为不崩;console 零报错;build 2.30s。
- 备注:E2 首验时误把旧后端(8000)当新码,发现后走 AIS_API_TARGET+8017 路线;8000 是用户进程未动。players 台测试数据(阿澈)保留给 E3/E4 用。

## E3+E4 · 2026-07-12 03:1x ✅ 问题圈选 + 蓝图批准(相关合批)

- E3 实现:问题=稿纸圈选词(虚线下划可点词组,选中转朱砂实线;「其他」=填空线;零卡片零边框);本地作答态(题目换即清);提交合成「问 —— 答」多行用户消息走原管线;「没答全没关系,也可以直接在下面说」逃生口常在。
- E4 实现:蓝图=鎏金眉题+破折号要点直排纸面;【批准,开始写】=唯一重元素(切 drafting+phaseOverride 防 setState 异步读旧相位+让 AI 按蓝图一次落笔);「再聊聊」回 understand。
- 验收(8017 真调):
  - E4:players 台现成蓝图态(阿澈五条)→ 批准 → 载荷不带 phase(override 生效)→ **AI 按蓝图落笔,「阿澈」9 字段上画布**,phase=drafting,火候线退场——构思(10→40→85)→蓝图→批准→落笔完整 Plan 流首次端到端闭环;
  - E3:stories 台「想写个故事」→ 3 题渲染(选项有画面:旧书店/云上城市/雨镇),圈选「永远下雨的小镇」+填空「守灯塔的聋哑少年」→ 提交合成消息精确(「问 —— 答」两行);
  - console 零报错;build 过。

## E5 · 2026-07-12 03:3x ✅ 快速通道

- 四入口(粘贴/上传 identify、酒馆卡、模板骨架、改编 fork)显式 phase=drafting+清构思残留(comp/questions/blueprint);世界书纯 opener 模板留在构思阶段(它本来就是"聊出来"路径);收进本台重置=新对象天然回 understand(带 seed 重新构思);老草稿由 deskPhase 兜底。
- 验收:fork《林默·改》→ phase=drafting、火候线不现、残留清零;其余三通道同一 patch 模式(主链路 D2/D3 已验);build 过。

## E6 · 2026-07-12 ✅ 手机进流 + 全链路回归 + PR(E 系列收官)

- 手机(拍板红线内最小动作):.ct 整体布局零改动,只往 `.ct-chat` 对话流里长三个已有组件——火候线(流顶)、问题圈选、蓝图批准(消息之后、busy 之前),类名/条件与桌面完全同一套;CSS 侧把 E2/E3/E4 组件段从 `@media (min-width:861px)` 解包成通用(python 脚本处理,`.create-blank-link` 文字链一并通用化)。
- 回归(5199+8017):
  - 手机 390:stories 台火候线「完整度 20 · 过 60 才落笔」+2 题圈选词进流,composer/布局原样;
  - 桌面 1366:stories 台会话流火候线+quiz 正常且 `create-comp` 全 DOM 仅 1 份(桌面/手机分支互斥,无重复渲染);characters 台(drafting)火候线/quiz 零渲染、14 字段画布原样——门控组件对 drafting 态零打扰;
  - console 全程零报错;`npx vite build` 过。
- 已知边界(如实):① E0 属引擎核心(identify.py build_card 加 understand 分支+服务端 draft 硬回退),**须主理人审+压测后才可合**;② understand 每轮多一次完整 JSON 契约调用,token 成本与 drafting 同量级;③ 完整度是模型自评分,60 阈值前端可调(threshold 参数已留);④ 测试期 8017/test 库落了少量私有卡库行(阿澈/林默·改等)。
- E 系列(E0-E6)全绿:后端硬门槛(评分之下 AI 不得写)+ Plan 流(问题圈选→蓝图批准→落笔)+ artifact 式双栏 + 快速通道兼容 + 手机进流。stacked PR:#159(C)→#160(D)→#161(E,本次)。

## F0-F6 · 2026-07-12 ✅ AI 触点皆可控(宗旨落地,F 系列一次收官)

- 宗旨(主理人):任何用到 AI 的地方,用户都必须能写提示词 / 拖拽 / refer(提示词、角色卡等)。两拍板:通道动后端做干净;一键按钮改点开一行可空指示。
- **F0 后端(引擎核心,单独 commit 2603847,须主理人审+压测)**:build_card+refs[{label,text}](≤4条/单条3000,seed 后 draft 前独立标签段,understand 同吃)、identify 四端点+hint(截1000,_hint_block 共享;worldbook markdown 快路径 hint 非空跳过)。全可选默认空=旧行为。_smoke_refs.py 4/4:空参基线/引用生效/hint tags 全英文/understand 吃 refs 门槛不动摇。
- F1 提示词库:localStorage ais_prompt_lib_v1,面板「提示词」tab 内存/删/引用,跨台通用。
- F2 引用体系:desk.refs 可选键挂台常驻;纸签行(hairline+×,零胶囊零框)/「@ 引用」按钮/输入 @ 唤起;面板三 tab(桌上的卡=四台 built+draft / 我的卡库四 kind 切 / 提示词);refText.js 按 models.py 字段拼紧凑可读文本;去重+上限 4(后端预算对齐)。
- F3 指示行:✦/⟳ 点开一行(可空回车=默认写法,Esc 收);蓝图批准附言;生成介绍口味指示——全拼进既有指令走原管线,零新端点。
- F4 拖拽:台架卡/卡库面板行 draggable → 命令条 onDrop 落纸签;自定义 MIME application/x-ais-ref(普通文件拖入不误触);接收态淡纸底+虚线+「松手,挂为引用」。
- F5 导入指示:导入面板 hint 行(pick/paste 两 step 共享保留;上传路径经 uploadHintRef 递——面板先关后弹文件框);酒馆卡本地解析无 AI,如实不加。
- F6 手机:.ct 布局零改动——纸签行入 ct-foot、更多面板+「引用卡 / 提示词」、输入 @ 同规则、手机蓝图块补附言行;面板弹窗天然可用。
- 端到端验收(5199+8017 真调,全新 localStorage 从零跑):
  - 提示词「文风偏冷句子短」存→挂→build_card 载荷 refs 正确,understand 轮 AI 回复口吻立变(短句直问);
  - 卡库挂林默(refText 拼出名字/设定/性格…),✦ 指示「糙汉自称老子」→ anchor 落笔完全服从且提示词文风叠加生效("哭啥,天塌不下来,老子顶你");
  - identify_world hint「keys 全英文小写」→ 5 条目 keys 全变 mist season/fog keeper/canal town——解析指示被服从;
  - 拖拽:接收态亮+离开复位+drop 落签;同名去重+上限 4 拦截;
  - 手机 390:纸签可摘、更多面板入口、面板三 tab 可用,composer/actions 布局原样;
  - console 全程零报错;build 过。
- 如实边界:refs 每轮进 prompt=成本随挂随涨(纸签常显可摘,与 seed 同口径);hint 是 prompt 约定非硬锁;提示词库本机 localStorage 不跨设备;测试期 test 库又落两行(深夜电台构思没入库,雾季运河镇世界书入库了)。
