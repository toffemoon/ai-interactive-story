---
date: 2026-07-12
plan: docs/2026-07-12-create-board-canvas-2-plan.md
---

# 创作画板二期(H 系列)· loop journal

## 切片状态

- [x] 阶段0 修复切片(create-board 上追加,R1)
- [ ] H0 稳定 id 地基(等 #159–#163 合链,新分支 gengyue/create-canvas2-base)
- [ ] H1 视口引擎
- [ ] H2–H7(交互盘)

## R1 · 2026-07-12 —— 阶段0 修复切片 ✅(commit 50a2e06 + f06316f)

- 现场:create-board @739cfcf,工作树净(仅惯例未跟踪脚手架),无并行会话痕迹。
- 实现(五项,前四项一 commit、第五项引擎核心单独 commit):
  1. onUpload 补 confirmReplaceDraft——上传曾是「替换先确认」范式唯一漏网入口(粘贴/酒馆/改编/模板全有确认);顺手收编预审确认项:hint 读完即清(onUpload 顶部原子消费)+ 两个直传按钮开文件框前清残留 uploadHintRef,面板取消后不再污染下一次任意上传。
  2. genIntro 并发锁+回写合并——`busy` 双向互斥(生成中不许聊/聊着不许生成);回写从整卡覆盖改为镜像 sendText 的 diff 姿势,只合并模型相对快照实际改动的字段落到当前 draft,filled=diff;弹窗介绍 textarea 生成期间 disabled(introAsk 本就有)。
  3. 酒馆导入类型规整(lib/tavernCard.js)——白名单拆 STRING/LIST 两组按 src/models.py CharacterData 对齐;normalizeField 规整(数字/布尔转串、字符串包数组、数组内滤对象与空串);形状不符救不回的值进 dropped 如实播报;根治「手工构造 JSON(如 name:123)直落 draft→渲染层 string 假定崩→脏数据已持久化刷新救不回」。
  4. 构思组件样式解包(Create.css)——E3 圈选(.create-quiz*)+E4 蓝图(.create-bp*)整段移出 @media(min-width:861px)(E6 只解了 .create-comp,这两组漏了,手机门控 UI 一直裸奔浏览器默认样式);同族顺手收编 D4 遗留:.create-shelf-act/.create-shelf-empty 解包(lib/引用/预设弹窗行按钮与空态手机可达)。
  5. **引擎核心(f06316f,须主理人审)**:_UNDERSTAND_SYSTEM_TMPL 第 1 条补计分规则——引用/资料(【用户引用】/【用户已有的资料】段)视同用户明确给过,按维度覆盖计入完整度。第一版措辞(一句"视同")不够硬,case4 仍 FAIL;加强为"逐维度对照+不打折+挂实质引用须明显高于零素材"后过。
- 验收证据:
  - `npx vite build` 2.07s 过(Create chunk 97.39kB);
  - tavernCard 规整 node 单测 9 断言全过(数字转串/对象进 dropped/字符串包数组/数组滤脏/布尔转串/空数组不落/正常卡原样);
  - **冒烟稳定性(真调 DeepSeek):修后 _smoke_refs 4/4 ×2 连跑(case4 comp 0→10 两轮方向一致)、_smoke_completeness 全过 ×2 连跑;修前基线:refs 3/4 ×2(case4 挂引用 comp=5 无增量),completeness 还出现过一次 U3=45 掉线——完整度自评分噪声真实存在,详见如实边界②**;
  - 5199 preview 实测(vite dev 代理本机 8000 真后端):手机媒体(max-width:860 命中)下 quiz-opt/quiz-free/bp-h/shelf-act/shelf-empty 五探针计算样式全部命中(修前=浏览器默认);桌面 1366 同规则四探针仍命中(解包无桌面回归),画板正常渲染、.ct 零泄漏;console 零 error。
- 如实边界:
  - ① genIntro 的 diff 合并对"模型顺手动了非介绍字段"仍如实落盘(filled 墨晕显形),不锁字段——与 C3 坦白原则同口径;
  - ② **完整度自评分是模型主观量,±20 噪声真实存在**(修前 U3 出现过 45/65 两种读数);本片只把"引用计入"钉进规则,阈值附近的抖动是 E0 设计的固有属性,前端 threshold 可调是它的泄压阀;case4 修后余量仍薄(10 vs 0),假如未来再翻车优先怀疑测例语义("参考它造新卡"本身低完整度)而非回退本行;
  - ③ 类型规整只护酒馆导入这一个入口,identify 后端返回与模板骨架本就受 _validate_build_draft/骨架键约束,未动;
  - ④ preview 探针是类级计算样式断言,understand 全流程手机圈选的交互回归留待合并前全链路(照 §7 阶段0 gate)。
- 测试残留:test 库经由 8000 后端真调的构思/引用轮若有入库按历轮口径(私密,不影响用户);preview 端 5199 dev server 由本会话起(launch.json 家目录配置 ais-frontend-next)。
- ⚠️ 下一片是 H0,前置=** #159–#163 合链**(计划 §6 拍板1/§7 阶段0):链未合则 loop 停等,连续两轮停→按停止条件结束并记卡点。

## R2 · 2026-07-12 —— 停等(第 1 轮)

- 现场:create-board @981cc33(本地领先 5 未推),工作树净,无并行会话动静;fetch 后 origin/main 仍 @c94c70a(#158),**#159–#163 全部 OPEN 未合**。
- 判定:当前切片=H0,前置(合链)未满足 → 本轮不动代码。卡点=等主理人审链;阶段0修复 5 个 commit 也未推(待授权,推后 PR #163 自动带上)。
- 连续停等计数:1/2。

## R3 · 2026-07-12 —— 停等(第 2 轮)→ loop 按停止条件结束

- 现场:工作树净;origin/main 仍 @c94c70a(#158),#159–#163 全 OPEN——连续两轮无法推进,按停止条件结束本 loop。
- **卡点(恢复清单)**:
  1. 主理人审合 stacked 链 #159→#163(E0/F0 引擎核心重点审;阶段0修复含引擎一行 f06316f 也须一并审);
  2. 本地 create-board 领先远端 6 commit 未推(阶段0修复×2 + H 计划/journal 文档×4)——授权后推送,PR #163 自动带上;
  3. 合链后重跑同一 /loop 提示词即可从 H0 续起(新分支 gengyue/create-canvas2-base 基于新 main)。
- 阶段0修复切片已完成且验收全绿(见 R1),H0–H7 零开工。

---

# H 系列 loop(第二期,主理人 2026-07-12 重启)

> 阶段0修复已推送,PR #163 已带上(c9eadca..c29e922)。本 loop 从 H0 起,停等计数重新计。

## H-R1 · 2026-07-12 —— 停等(1/2)

- 现场:工作树净;origin/main 仍 @c94c70a(#158),#159–#163 全 OPEN。前置(合链)未满足,本轮不动代码;若主理人正在审合,下一轮自动接上 H0。

## 合链插曲 · 2026-07-12(主理人口头授权「已看过,你去推」)

- 按栈序合并:#159 合入时 `--delete-branch` 触发 GitHub 把 #160 **直接 CLOSED**(base 分支没了,不可 reopen/改 base)——补救:同 head 开替代 PR **#164** 合入;#161/#162/#163 改为「先 retarget 到 main 再合、最后统一删分支」,全部落地。main 顶=8695504(五个 merge:159/164/161/162/163)。
- ⚠️ 经验:**合 stacked 链不要用 `--delete-branch`,先改下一个 PR 的 base 再删分支**。
- `tests/test_db_health.py` 实为本地未跟踪脚手架(从未入库),此前"main 里已跟踪"判断有误,无冲突。

## H-R2 · 2026-07-12 —— H0 画板地基 ✅(commit ddfd194,分支 gengyue/create-canvas2-base)

- 实现:
  - **稳定 id**:built 卡挂 `_bid`(NON_FIELD_KEYS 收编);在 **desks useState 初始化器**同步补齐老数据并持久——第一版走 mount effect,实测暴露两个真问题后重构:①首帧无 id 的兜底 key `b:i0` 跨台撞车(React 重复 key 留幽灵 DOM 节点);②坐标持久化 effect 挂载即写空 v2,抢在迁移前(时序竞态)。教训:**一次性数据迁移放 useState 初始化器,别放 effect**。
  - **坐标 v2**:`ais_create_board_v2` 按 id key(`d:<kind>`/`b:<bid>`),v1 下标 key 在 boardPos 初始化器同步解析迁移;v1 原样保留,回滚=删 v2 一个键。
  - **选中/聚焦换 id**:boardSel/boardFocus={kk,id};`selLive` 活性判定(built 选中但卡已没了=视同无选中);removeBuilt(kk,bid) 显式传台+按 id 定位+剪 v2 坐标+清 sel/focus;出口全 stripBid(导出/发布拼装/改编/引用文本)。
  - 四个下标 bug 修复点:移除按钮不再 setKi+闭包下标;导出补传 bc.kk;坐标不随下标漂;幽灵选中自动解锁。
- 验收证据(5199 preview 实测,真后端 8000):
  - **老数据无缝**:种 v1 格式(2 角色+1 世界,无 _bid,v1 下标坐标)→ 刷新 → _bid 全补齐并持久、v1 四条坐标逐个精确迁到 v2 id key(100,50/300,60/620,40/draft 10,10)、v1 原样保留、板上 3 卡零幽灵;
  - **跨台导出**:tab=角色台导出世界书卡 → 捕获 JSON=裸 data(无 chara_card_v2 信封)、无 _bid;
  - **幽灵选中**:真选中甲一(dock 显 built 语境)→ 移除 → 选中自动清、dock 回「点一张卡开始聊」引导态;甲二坐标纹丝不动(300,60),v2 剪掉甲一键;
  - **跨台移除**:tab=角色台点世界书卡「移除」→ confirm 弹《雾镇》(修前弹错台卡名)、只删 worlds、角色台完好;
  - 全新用户路径:清库刷新 → 空板引导正常、v2={}、零卡;手机 390:.ct 四 tab/composer 就位,board/boardbar/dock/focus 零泄漏;
  - console:修复后两次刷新零新增(缓冲区仅存修前那 2 条 b:i0 重复 key 旧错,该 key 现行代码不可能产生);`npx vite build` 2.04s 过(Create chunk 98.49kB)。
- 如实边界:①发布清台不剪 v2 里 built 坐标(id 键幽灵条目无害——永不匹配任何活卡,留 H 系列顺路清);②测试用 confirm/URL.createObjectURL/setPointerCapture 均为页面内测试垫片,未触真下载;③无头环境 resize 不派发事件,手机回归靠手动 dispatch(历轮已知怪癖)。
- 测试残留:preview 浏览器 localStorage 已清回全新态。

## H-R3 · 2026-07-12 —— H1 视口引擎 ✅(commit 008be2f)+ 地基盘 PR

- 实现:
  - **世界容器**:`.create-world` 单 transform(translate+scale),卡绝对定位其中;板 overflow:hidden,pan/zoom 取代滚动兜底。
  - **手势=ref 直写**:viewRef 为真源,wheel/pan move 只写 ref + rAF 调度 DOM transform,**零 setState**;手势停 200ms(wheel debounce)或 pointerup(pan)才 commit 到 state。wheel 必须原生监听(`{passive:false}`,React 根上的合成 wheel 是 passive,preventDefault 无效)。
  - **手势约定**:ctrl/cmd+wheel=光标锚定缩放(0.25–2 钳制),裸 wheel=平移;Space(输入框内不劫持)/中键=抓手,抓手态卡 pointer-events:none 不截胡;卡拖拽让位逻辑在卡 wrapper 判 spaceRef/中键。
  - **缩放数学**:锚定公式 pan' = m − (m−pan)·nz/z;卡拖拽位移 screen/z 换算。
  - **持久化**:视口住 `ais_create_board_v2.__view` 保留键(红线:视图态只此一处);boardPos 初始化器剥 __view 防混入卡坐标。
  - 控件:右下 −/%/＋/适配(fit=全卡 bbox 居中钳制)。
- 验收证据(5199 preview,真调交互):
  - **零重渲铁证**:20 连 wheel 同步派发后,% 标签与 world transform **纹丝不动**(手势期间零 setState);200ms 后 commit 一次落地,数学精确(2×exp(−1.2)=0.6024,实测 z=0.6023884);
  - **缩放锚定**:30 连 ctrl+wheel 对准 (400,300) → 钳制 z=2,pan=(−400,−299.2)=锚点公式精确解;
  - **拖卡精度**:z=60.2% 下拖卡 screen(120,60) → 世界坐标落点与期望**逐位相等**(247.20701536419287);
  - **平移**:中键拖 (60,−30) → __view 精确 +(60,−30),z 不变;Space 按下/抬起 is-pan class 开关正确;
  - **复原**:刷新后视口 (149.16, 5.11, 60%) 与卡位 (247.207,123.604) 全部精确复原;适配按钮 → 全卡入板内(逐卡 rect 断言);点 % → 回 100%;
  - 手机 390:.ct 就位,world/zoomctl/board 零泄漏;`npx vite build` 2.04s 过(Create chunk 102.02kB,+3.5kB);
  - console:磁盘文件 babel parse OK + 冷加载全功能绿;缓冲区内 parse error/b:i0 条目=本轮分步编辑的 HMR 中间态与 H0 第一版历史(**preview 工具的 console 缓冲跨 server 重启持久、无时间戳,是工具局限**,现行代码物理上产生不了这些错误)。
- 如实边界:①本 headless 环境 rAF 被节流不执行(rafLatency=null 实测),手势中的逐帧视觉更新只能在真浏览器生效,本环境靠 commit 路径兜底落地——代码路径正确性由数学断言与 commit 结果证明;②React 因其它 state 重渲时 world 的 JSX transform 会以最近 commit 值重置(手势中理论上有一帧回跳,200ms 内自愈),真实使用无感,留观;③Profiler 面板不可用于 headless,零重渲证据以「手势期间 % 标签零变化+代码路径只触 ref」口径给出。
- 测试残留:preview localStorage 留有测试视口/卡位(与用户无关)。
- **地基盘 PR 已开**:H0+H1 gate 全绿 → gengyue/create-canvas2-base → main(#165)。

## H-R4 · 2026-07-12 —— H2 BoardActionTrigger+上下文工具条 ✅(commit 9c57bb1,分支 gengyue/create-canvas2-ui,stacked 于 base)

- 实现:
  - **BoardActionTrigger**(template P0 姿势):手势→意图唯一翻译层——单击=select、双击=enter、拖>4px(世界系)=drag;上层只认意图。修三个事件层缺陷:拖后 300ms 抑制 dblclick(浏览器拖完仍派发)、pointercancel/lostPointerCapture 兜底清拖态、onCardPointerMove 查 e.buttons+data-bckey 防跨卡残留拖。
  - **上下文工具条**:选中即见(hover 即现的 .create-bcard-acts 退役,CSS 一并清);零尺寸锚点在世界系(随卡 pan/zoom),条本体 `scale(1/z)` 逆缩放保持视觉恒定;动作按块型×卡态给:构思草稿[聚焦构思/挂资料/丢弃]、落笔草稿[聚焦编辑/引用/收进本台/导出]、built[查看/引用/改编/导出/移除]。
  - **改编语境迁移**:adaptFromBoard=fork 成功后 boardSel 迁到 d:<kind>(dock 立即可聊)——预审「改编后原地打转」根治;新增 discardDraft(confirm 文案区分空卡,seed/built 保留口径镜像 collectToDesk)。
- 验收证据(5199 preview,窄路径先行再铺矩阵):
  - **窄路径 select→act→inline-apply**:真选中甲一 → 工具条浮现于卡上方左对齐(几何断言)→ 点「引用」→ desks.characters.refs 落台持久化 + dock 纸签「卡 角色卡·甲一 ×」+ 引用文本无 _bid 泄漏——闭环全绿后才铺矩阵;
  - built 五键齐;点「改编」→《甲二·改》成草稿(无 _bid)+ **选中自动迁到草稿卡 + dock 解锁**(placeholder=该台起手语)+ 工具条即时切落笔态四键;
  - 拖后立即 dblclick → 聚焦不再误开;pointerdown→pointercancel→悬停他卡 → 原卡纹丝不动(拖态已清);
  - 构思态三键齐;「丢弃」→ confirm 文案正确、台子重置(messages 归开场/questions 清/draft 空)、卡下板、选中与工具条一并清、built 保留;
  - 手机 390:.ct 就位,ctxbar/board 零泄漏;`npx vite build` 2.02s 过。
- 如实边界:①工具条逆缩放用的是已 commit 的 view.z,pan/zoom 手势进行中有短暂尺寸偏差(200ms 内自愈,真实使用无感);②触屏长按=enter 只留了接口未实装(拍板③手机不上画布);③draft 卡「导出」导的是当下草稿(未 finalize),与台账线菜单口径一致。
- 测试残留:preview localStorage 有《甲二·改》草稿与 worlds 台重置痕迹(测试数据,与用户无关)。

## H-R5 · 2026-07-12 —— H3 工具 rail+快捷键 ✅(commit 515af5b)

- 实现:左侧工具 rail(选/手 + 四卡种落卡,自 boardbar 迁入——boardbar 只剩文件级:装订/发布/对话/菜单);抓手=粘性工具(H)或瞬时(Space),hand 态左键拖板即平移、卡 pointer-events:none 不截胡;快捷键 V/H/⌘·Ctrl+0(适配)/1-4(落卡),守卫=输入态/聚焦态/全部弹层不劫持、手机不挂;卡片 Enter 键流(Tab 到卡 → Enter 选中 → 已选中再 Enter 进入,镜像单击/双击)。
- 验收证据(5199 preview 真调):rail 六键就位、boardbar「+」退役;rail 与 dock/zoomctl 矩形互不相交(几何断言);H → rail 高亮+board is-pan,V 复位;hand 态左键拖板 (60,30) → __view 精确 +(60,30);⌘0 → fit 落 v2(z=1 居中);「2」落卡开聚焦;**守卫实证:聚焦态按 V/H 被拦(测试序列先把自己锁了,分析后确认是设计行为非 bug)、textarea 里按「3」不切台**;纯键盘流:focus 卡 → Enter 选中(工具条现身)→ Enter 进聚焦 → Esc 退出;手机 390:.ct 就位,rail/board 零泄漏;build 2.00s 过。
- 如实边界:①rail 图标用汉字字形(零依赖,纸墨皮肤一致),非图标库;②Enter 流的 Tab 顺序依赖 DOM 顺序(=boardCards 顺序),未做方向键空间导航(留观真实反馈);③hand 工具下卡完全不可点(Figma 同口径)。
- 测试残留:同上,preview 测试数据未清。

## H-R6 · 2026-07-12 —— H4 相机聚焦 ✅(commit 58b9934)

- 实现:
  - **相机聚焦**:双击=记住当前视口 → tween(0.32s,reduced-motion 跳切,transitionend+setTimeout 双兜底)推进到卡位居中、zoom=1;聚焦面板 `.create-focuscard` 落在**画板内 screen 空间**(920px 居中,top 12/bottom 210 给最深形态 dock 留身位)——编辑永远发生在 scale=1,文本模糊/光标怪癖不存在;F8 画布 JSX 原样住进面板;聚焦中的迷你卡隐去由面板顶替。取舍如实:计划 D3 写「原地放大编辑」,落地为「相机推进到卡位 + 面板现于板中心(=卡此刻所在)」——机制目标(推进/scale1/overlay 退役/逐层 Esc)全达成,面板不随 world 缩放(规避 transform 容器内编辑的浏览器坑)。
  - **overlay 退役**:fixed z44+shade 删除;预审「z-index 倒挂(抽屉 40 被 44 压)」随层消失;出口三路(Esc/回画板/点空白)统一 exitFocus=拉回原视口。
  - **Esc 逐层退**:字段编辑(editKeys)/指示行(askOpen,本片补 preventDefault)只关自己;窗口监听查 e.defaultPrevented 再逐层:聚焦 → 选中。
- 验收证据(5199 preview + 8017 新代码后端真调):
  - 双击《甲二·改》→ focuscard 渲染、旧 overlay/shade 零残留、迷你卡隐去、相机 commit 至 z=1(world transform=目标精确值)、F8 画布字段在面板内;
  - **Esc 三层逐退实测**:✎ 编辑器开 → Esc① 只关编辑器(面板仍在)→ Esc② 退聚焦+**相机精确拉回**(423.876/223 逐位)→ Esc③ 取消选中——预审「Esc 双关」根治;
  - **聚焦态构思真调闭环**(8017):圈选「阴郁」→ 提交合成「基调? —— 阴郁」→ 真回包:AI 顺着追问、新 3 题圈选渲染在面板、火候线 30%、**硬门槛 draft 仍空**;
  - **聚焦态蓝图批准真调闭环**:种蓝图态(5 要点)→ 面板显蓝图 → 【批准,开始写】→ 真调落笔 → phase=drafting、世界书 5 条 entries 上卡、火候线退场;
  - 抽屉在聚焦态:「对话·N」实点开(27 条对谈体渲染)、×实点关;z 分析:40 之上已无遮挡层(44 已删,46 dock 是底部小岛);面板与 dock 几何不相交(660≤669,含纸签行最深形态);
  - 手机 390:.ct 就位,focuscard/board 零泄漏;build 2.02s 过。
- 排障插曲(记档):①preview 的 vite 代理(家目录 launch.json)钉死 AIS_API_TARGET=8017(E2 时代),8017 已死 → 经代理 API 全 500 而直打 8000 正常——**用 ais-cutover 配置把 8017 用当前工作树新代码拉起**,代理即通且真调的是 E0 门控链路(8000 是合链前旧代码进程,无门控键);②抽屉 elementFromPoint 假阴性=本环境 **CSS animation 冻结**(drawerIn 停在 from 帧 opacity:0,与 rAF 节流同源),真浏览器无此问题——功能证据(实点开关/内容渲染/z 分析)收口。
- 如实边界:①本环境 tween/入场动画不可视(动画时钟冻结),动画正确性以终态断言+真浏览器留观;②聚焦态下 wheel/pan 仍可用(Figma 口径,面板不动板动);③dock 身位按最深形态(≈190px)留白,面板有效高度 860 屏下≈638px,内容自滚。
- 测试残留:test 库经 8017 真调落了构思/蓝图轮次(无入库写操作);preview localStorage 留雾之世界 drafting 台数据。

## H-R7 · 2026-07-12 —— H5 信号上卡 ✅(commit b83b928)

- 实现(template P2:信号=一等可点交互对象):
  - 构思中 draft 卡面:**完整度火候线**(2px 墨→鎏金,宽=comp%,「构思中 · N」)——点击=focusCard 直达聚焦圈选(跨台自动切 ki);蓝图态:**鎏金「蓝图待批 ✦」徽**——点击直达批准;phase 判定用台无关的 deskPhase(desks[bc.kk]),不是当前 kind 的 phase;
  - **busy 墨点**:当前台请求在飞时 draft 卡右下 pulse 墨点(reduced-motion 清单已收);
  - **批注笺**:AI 最新一句(lastAi.show||text,busy 显「正在想……」)锚在活动卡右侧(world 内零尺寸锚+逆缩放,✒ 朱砂左线纸笺,3 行截断)——点击开完整对话抽屉;聚焦态不显(面板内已有会话层)。
- 验收证据(5199 + 8017 真调):
  - 三态三卡同板(角色 drafting/世界 understand·comp40/故事 blueprint):火候线宽 40% 精确、蓝图徽渲染;
  - **不聚焦直达处置(DoD 核心)**:tab=角色台点世界卡火候线 → 聚焦面板开+圈选在+火候线 40%(跨台直达);Esc 退,点故事卡蓝图徽 → 蓝图 5 要点+批准钮直达;
  - 批注笺:选中《甲二·改》→ 笺锚于卡右侧(几何断言)、文本=该台 lastAi、点笺 → 抽屉真开;
  - **busy 全信号联动(真调)**:dock 发「把简述改成一句更冷的」→ 飞行中卡面墨点亮+批注笺「正在想……」;回包后墨点退、笺换 AI 新句(这轮模型选择反问未改字段——坦白原则口径,非 bug);
  - 手机 390:.ct 就位,note/bsig/board 零泄漏;build 2.02s 过。
- 如实边界:①「fresh 墨晕摘要」不另做——G3 已有卡面摘要实时变,重复信号徒增噪;②批注笺只挂活动卡(选中的 draft),非全板每卡都挂(避免多笺糊板);③busy 墨点只标当前台(busy 是全局单发)。
- 测试残留:test 库真调两轮(改编对话);preview localStorage 留三态测试台。

## H-R8 · 2026-07-12 —— H6 空白起草 ✅(commit 1d45732)

- 实现:①双击空白=四卡种落卡菜单(世界锚点+逆缩放;拖拽/平移刚结束 300ms 抑制=误触不落卡;点空白/Esc 收,Esc 分层监听收编 spawnAt);已聊开的台不搬坐标只跳转(newCardOf 语义);②rail 四卡种钮 draggable(`application/x-ais-spawn` MIME),拖到画布按 drop 位置落卡;③文件拖入分流:.json/.png→角色台酒馆本地解析、.txt/.md/.docx→当前台 identify(confirmReplaceDraft 守卫沿用),卡落 drop 位置(screenToWorld 换算);④受理面收紧:仅 spawn MIME/Files 亮接收态(inset 虚线框)与受理,text/引用等其它载荷一律不 preventDefault 不落卡。
- 验收证据(5199 + 8017 真调):
  - 双击空白 (700,400) → 菜单四钮 → 选「演出卡」→ d:players 坐标写入换算位、聚焦构思开、菜单收;Esc/点空白可收菜单;
  - **误触不落卡**:卡拖拽结束后立即双击空白 → 菜单不弹(300ms 抑制);text/plain junk drop → v2 零变化;
  - rail 拖出:x-ais-spawn drop (900,300) → 坐标精确落位+聚焦构思;dragover 接收态高亮分拍断言 ✓;
  - **文件 drop 真调闭环**:「修表匠.txt」drop → identify 真调(8017)→《林一》9 字段落 players 台、**坐标=drop 位置换算(326, 82.2)**、卡库入库回执;第二发落有草稿的台 → confirm 弹出(守卫在);
  - 手机 390:.ct 就位,spawnmenu/board 零泄漏;build 2.02s 过。
- 排障插曲(记档):第一发文件 drop 后查错了台以为链路没跑——实际 rail spawn 已把当前台切到 players(空台不需 confirm),导入静默成功落在 players;第二发按台守卫弹 confirm 后确认链路无恙。教训:多入口测试序列里"当前台"是移动靶,断言前先读 ki。
- 如实边界:①导入被 confirm 取消时 drop 坐标已写(该台无卡渲染,视觉无感,自愈于下次落卡);②手机端不做画布起草(拍板③);③.docx 走 /api/upload 解析,依赖 8017 的 test 库唤醒状态(identify 入库)。
- 测试残留:test 库入库《林一》等私密卡;preview localStorage 留多台测试数据。

## H-R9 · 2026-07-12 —— H7 回归收尾 ✅ + 交互盘 PR + loop 结束

- **性能账(对 07-11 基线)**:主 JS index=410.22 kB/gzip 138.47(基线 410.29/138.49,持平略降——H 系列全部落在懒加载的 Create chunk);Create chunk=108.07 kB/gzip 36.60(合链后起点 97.39/32.85,**+10.7 kB/+3.75 gzip=H2-H6 六片的账**,无回退红线)。
- **reduced-motion 清单**:三块覆盖齐——C 系列通用清单(L1243,createRise/msgIn/fieldInk 族)、抽屉(L2339)、H 系列新增(L2767:focuscard/bcard-live/bsig-busy/note/ctxbar;spawnmenu 复用 ctxbar 类天然覆盖);相机 tween 在 JS 侧判 matchMedia 跳切。
- **冷加载全链路回归(1366,干净种子)**:boardbar/rail/zoomctl/dock/world 全家桶就位;卡坐标(120,100/500,120)与视口(10,5,z1)逐值精确复原;选中 → 落笔态四键工具条 → 双击聚焦 → **dock 真调一发(8017)**:draft 2 键 → 16 键、聚焦面板 14 字段块实时长出、AI 顺势追问 → Esc 逐层退。
- **手机 390 全量**:.ct 四 tab/composer/草稿条完整;桌面 12 个组件(board/boardbar/rail/zoomctl/world/ctxbar/note/bsig/spawnmenu/focuscard/dock/drawer)**全部零泄漏**。
- console:每片 build 过+磁盘 babel parse OK+冷加载功能全绿;preview console 缓冲跨重启且无时间戳的工具局限已于 H-R6 记档。
- **交互盘 PR 已开**(H2-H7,base=create-canvas2-base;#165 合入后 GitHub 自动 retarget 到 main——记得合 #165 时别删分支再 retarget,或先改 base,见「合链插曲」教训)。
- H 系列 H0-H7 全绿收官:真画布(pan/zoom/工具栏/相机聚焦)× template 块-动作模型(BoardActionTrigger/上下文工具条/信号一等公民/空白起草)全部落地;交互盘等主理人审。loop 按停止条件结束。

## 审核修复 · 2026-07-12(主理人实测反馈「新账号连新建都做不到」,commit c72ef59)

- 复现坐实:全新账号桌面空板——功能链路完好(rail「角」可开构思),但**可发现性归零**:空板文案指向 H3 已搬走的顶部「+ 角色卡」、dock 提示指向不存在的「上面 + 新建」、rail 只有无语义单字。H3 boardbar 瘦身漏改文案+入口藏太深,新用户第一分钟死局。
- 修:空板中央放回四个实体「+ 卡种」按钮(复用 .create-boardbar-new 样式,点击直达聚焦构思);空板/dock 两处文案改真话(双击空白/左侧工具栏)。
- 验:清库全新态 → 空板四按钮渲染 → 点「+ 角色卡」→ 聚焦构思开+dock 解锁;build 过。
- 教训:**切片验收都从"有数据的板"出发,漏了全新用户零态走查**——G 系列的空板引导在 H3 改布局时成了孤儿文案。零态(new user first minute)应进 H7 类回归清单的固定项。
