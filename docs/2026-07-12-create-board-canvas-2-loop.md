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
