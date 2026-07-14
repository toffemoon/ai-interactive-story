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

## 收尾回归 · 全链路 + 手机 390(loop 终片)

- **做了什么**:四卡种全链路回归 + 手机不回归验证;无代码改动(纯验证片)。
- **验收**(5199,清台跑→还原):**四卡种各自走通 新建(种骨架)→改名→收进本台**(角色卡含「完善角色卡」弹窗确认),四台 built 各 1、板上 4 卡;**装订清单**「装订 4 卡」,四类齐列(角色卡×1:测试角色卡 | 世界书×1 | 演出卡×1 | 故事书:测试故事书);**手机 390**:.ct 页正常渲染、四 tab 带 built 计数徽章、切 tab 正常、草稿条正确、无横向溢出(手机 .ct 零改动红线守住——种骨架经 newCardOf 只在桌面画板路径触发)。console 全程零报错;台账还原。
- **坑**:无新坑。
- **收官**:P0/P1a/P1b/P2a/P2b/P2c/P3/回归 全部完成,PR #170(stacked on #169)待主理人审;演出卡改名与 P4(结局条件/节拍前置接引擎、摆设字段转正)留主理人拍板。loop 删除。

## R1 · 观感优化第一轮(复用已移植 react-bits 件,2026-07-14)

- **做了什么**:①ClickSpark 加 `ais:spark` 定向爆发入口(逐火花 color/radius/size,色值字面量——canvas 解析不了 CSS var),收进本台/收入卡库/发布成功三处 `burstDone()` 朱砂+鎏金完成拍(发布=大爆发),与长按溅墨同语言收口;②空板标题 StaggeredText 逐字浮现(respectReducedMotion);③条目/节拍机制说明行换 BlurHighlight(「触发词」朱砂淡底高亮);④条目/节拍 + 模板/导入选择器列表 entryIn 阶梯入场(reduced-motion 全守)。**取舍**:AnimatedList 是带滑动删除/自动追加的 feed 组件,语义和编辑面/选择器冲突——列表入场用同气质 CSS stagger 实现,组件不硬套。
- **验收**(5199,清台测→还原):空板标题 11 个分段 span;ais:spark 派发后画布 1→1920(监听+扩容通);机制行 blur-highlight-container 挂上、文本无损;.create-entry computed animation=entryIn、第 2 条 delay 45ms;build 过;console 零报错。
- **坑**:BlurHighlight(motion 驱动)没有 reduced-motion 守卫——幅度小(0.5s 模糊淡入)暂记不改;headless rAF 冻结时 ais:spark 画布扩容后不会自动缩回(releaseCanvas 在 rAF 尾),真浏览器正常。
- **下一片**:R2 移植 CountUp(完整度数字)+ ShinyText(鎏金扫光,模板应用 toast)。

## R2 · 观感优化第二轮(新移植两件,2026-07-14)

- **做了什么**:移植 react-bits **CountUp**(verbatim,motion spring 数字滚动;`to` 变化从当前值续滚——完整度 40→64 是「涨」不是「换」)接进桌面构思火候线「完整度 <CountUp/>」;移植 **ShinyText**(verbatim,金属扫光,CSS 一行并入组件)只上 toast 转瞬场合——模板应用成功的模板名鎏金扫光(color=var(--accent-3));flash() 传 JSX(渲染处本来就是 {toast},天然支持)。两件都吃已有 motion 依赖,零新增。
- **验收**(5199,清台测→还原):应用「现代都市」模板 → toast 文案完整、.shiny-text 挂载、computed background-clip:text + 文字填充透明;build 过;console 零报错。CountUp 所在火候线需真聊构思才渲染(P1b 后直接新建走 drafting 不经过它),组件 verbatim+单行集成,留真机实测。
- **坑**:无新坑。
- **下一片**:R3 试样件(ClickStack 模板卡叠/Stepper 阶段条)demo 给主理人拍板;R4 动效口径统一待 R3 定型后一并。

## R3 · 试样件落地(主理人 demo 拍板「都完成」,2026-07-14)

- **做了什么**:①**模板卡叠**——「从模板起手」弹窗从按钮列表换成点击翻卡:每套模板一张卡(名+字段数徽章+hint+字段/条目 chips 印在卡面),点卡面或「换一套」=顶卡下坠微转退场 240ms 转叠底,「应用这套」=走原 applyTemplate(替换确认不变);开弹窗/切卡种重置叠序。②**阶段条**——聚焦卡 kind 行下「构思→落笔→收尾」,由真实门控驱动(phase!=drafting=构思;drafting=落笔;comp≥60=收尾),骨架路径直通落笔=构思打勾,如实不装饰。**取舍**:仓库现成 Stepper 是带内容槽+上一步/下一步的向导组件,与被动指示不匹配——按拍板的 demo 视觉手写迷你版(同 AnimatedList 口径)。
- **验收**(5199,清台测→还原):新建演出卡→阶段条 done/on/off=构思✓落笔●收尾○;模板弹窗卡叠 2 张、顶卡「轻装上阵」chips 身份/目标/开局第一幕、换一套翻到「演出卡·标准」、应用这套=tpl 落库+弹窗关+toast 鎏金名;build 过;console 零报错。
- **坑**:tplOrder 重置 effect 的 deps 引用 kind——kind 在组件体后段才声明,effect 放前面会 TDZ 白屏(aiPos 旧坑同款),已挪到 applyTemplate 旁并留注释。
- **收官**:R1-R3 全部完成;R4(动效口径统一)并入本轮已顺手做(新动效全走 --dur/--ease token 与 reduced-motion 守卫)。ParallaxPills 依主理人默认毙。
