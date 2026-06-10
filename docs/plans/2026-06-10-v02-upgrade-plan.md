# ai-interactive-story v0.1 → v0.2 升级计划

> 范围:本计划只覆盖本次全栈审计中确认/记录的发现。critical/high 均已对抗复核;medium/low 中带「✅复核」标记的经过复核(部分由 critical/high 降级而来),标「⚠未复核」的未经对抗复核,落地前需先自行核实证据。已被复核推翻的发现不在本计划内。

---

## 一、总表(P0 必改 → P3 可改)

### P0 — 必改(安全 / 数据风险)

| # | 问题 | 文件 | 一句话改法 |
|---|------|------|-----------|
| P0-1 | 全部 8 张表 RLS 关闭,anon key 经 Data API 可直读写 users.password_hash / auth_tokens / 全量存档 | migrations/2026-06-09-phase1-accounts.sql:12-46 | 8 表 `ENABLE ROW LEVEL SECURITY`(不加 policy = 对 anon 全拒),应用走 owner 直连不受影响 |
| P0-2 | 烧 LLM 的端点(/api/chat、/api/build_card、/api/identify*)整类绕过 costguard;build_card 连鉴权都没有、chat 匿名放行 → 匿名无上限烧 DeepSeek key | src/api.py:348-467; src/auth.py:227-231 | 抽统一「guarded LLM」依赖:preflight/record 套到全部 LLM 端点;build_card 加登录依赖;AUTH 开时 chat 拒匿名 |
| P0-3 | story_turn 对同一 session 的 load-modify-save 无并发控制,并发回合互相覆盖;resync 路径整段删 messages 重写,历史可被截断 | src/story.py:1609,1503; src/storage.py:90-122 | `pg_advisory_xact_lock` 包住 load→save;同 session 并发请求返回 409 |
| P0-4 | /oc-assets 无鉴权静态挂载整个 OC_DIR,泄露 index.json(用户邮箱 PII)与私有 card.md/profile.md/world.md ✅复核 | src/api.py:1060-1061 | 只把 art/anim 移入 OC_DIR/public 单独挂载,index.json 与 .md 移出静态根 |

### P1 — 近期必改

| # | 问题 | 文件 | 一句话改法 |
|---|------|------|-----------|
| P1-1 | 6 个同步 def 路由阻塞调 LLM 最长 60s(identify 重试最坏 180s),约 40 并发即占满 AnyIO 线程池,login/library 全站卡死 | src/api.py:348-359,457-467; src/llm.py:15-19 | 端点改 async,LLM 走 achat_messages 或 asyncio.to_thread 过渡 |
| P1-2 | story_turn 异常被吞成 200 保底回合,不写任何日志,全仓无 logging 配置,prod 排障为零 | src/api.py:518-520,563-564 | 两处 except 加 log.exception + 启动配 logging.basicConfig,memory.py 的 print 换 logger |
| P1-3 | costguard.client_ip 信任 X-Forwarded-For 首段,客户端伪造即绕过全部 per-IP 限流,可单人烧穿日上限打出全服 503 ✅复核 | src/costguard.py:75-83 | 改取「从右往左跳过可信代理后的第一段」(Render 单层取末段),并加 user/session 维度二级限流 |
| P1-4 | 登录端点无速率限制,可对单账号(含 superadmin)高速撞库 ✅复核 | src/api.py:177-184; src/auth.py:137-154 | 按 IP + 按 identifier 加失败计数与指数退避/锁定,复用 rate_limits 表 |
| P1-5 | /api/chat 会话历史只存进程内 dict:每次部署全丢、无淘汰,且 chat 路径记忆 add_turn 实为 no-op ✅复核 | src/chat.py:15-21,86,91-122 | 历史/摘要落 sessions/messages 表(加 kind 区分),dict 降级为读穿透缓存 |
| P1-6 | _reroll.snapshot 深拷贝全量 messages/turns/long_memory 嵌回 sessions.data,每回合整 blob 重写,O(n²) 写放大 ✅复核 | src/story.py:1611-1650; src/storage.py:75-88 | 快照只存 message_count + 轻量字段,回滚改为按 seq 截断 messages 表 |
| P1-7 | healthCheckPath 指向静态首页,/api/health 无论 DB 死活都返回 ok,故障实例不被摘流 ⚠未复核 | render.yaml:20; src/api.py:319-342 | healthCheckPath 改 /api/health,db_ok=False 时返回 503 |

### P2 — 应改

| # | 问题 | 文件 | 一句话改法 |
|---|------|------|-----------|
| P2-1 | sessions.data 大 blob 每回合整行重写(实测 max 827KB),turns 仍在 blob 内 ✅复核 | src/storage.py:79-88,148 | turns 拆 append-only 行表,expand-contract 双写迁移 |
| P2-2 | /tail 3.5s + operator 4s 轮询每 tick 全量 load_session(全部 messages 行+双倍 blob),且不分页面可见性 ✅复核(可见性部分⚠未复核) | src/api.py:652-663,850-860; frontend/app.jsx:976,989 | tail 走专用 jsonb 切片 SQL 不碰 messages;前端 visibilitychange 暂停/退避 |
| P2-3 | 60 天 token 存 localStorage + 全站零 CSP,纵深防御为零 ✅复核 | frontend/app.jsx:6-25; frontend/vercel.json | vercel.json 下发 CSP(先 Report-Only),token 缩期+可吊销,中期 cookie 化 |
| P2-4 | React/Babel 三连全走 unpkg、无 SRI:供应链面 + 大陆访问可用性单点 ✅复核 | frontend/index.html:11-13 | vendor 进 frontend/vendor/ 自托管(改三行 src),或至少补 integrity+fallback |
| P2-5 | 10 个 window.* 视图脚本任一失败 → 全站白屏,无 ErrorBoundary ✅复核 | frontend/index.html:63-73; frontend/app.jsx 渲染处 | 渲染前判空守卫 + App 外包 ErrorBoundary |
| P2-6 | 隐藏真相(known_hidden/隐藏事件)全量下发玩家,每回合整包 deck 回传可篡改 ✅复核 | frontend/app.jsx:1038,2394; src/api.py:729-733 | story_turn/chat 支持只传 session_id、deck 用服务端 artifacts 快照;presets 列表裁隐藏字段 |
| P2-7 | sessionId 在 auth 解析前按游客作用域初始化,共用电脑可串无主遗留局 ✅复核 | frontend/app.jsx:2341,2409-2412,2637-2665 | auth.ready 后按当前 scope 重算 sessionId,restore effect 等 auth.ready |
| P2-8 | /api/upload 无鉴权、body 无大小上限,内存型 DoS ⚠未复核 | src/api.py:444-454 | 校验 Content-Length/流式截断 + 视情况要求登录 |
| P2-9 | 11 处 500 响应把原始异常字符串回显客户端 ⚠未复核 | src/api.py:359,373,387,401,413,428,453,466,606,625,781 | 对外中性文案,详情进服务端日志 |
| P2-10 | authorize_session「过渡期放行」:匿名可读写所有无主存档(prod 130 局中 73 局无主)⚠核心证据✅复核,收口策略未复核 | src/auth.py:221-237 | 先批量补 owner(assign_session),再翻开关关闭过渡期放行 |
| P2-11 | send_code 仅按邮箱 60s 限流,缺按 IP 总量限制,可邮件轰炸 ⚠未复核 | src/auth.py:302-334 | 加每 IP 窗口限流 + 单邮箱每日上限 |
| P2-12 | 滚动摘要与长期记忆抽取 LLM 串行在回合关键路径,周期性回合延迟翻倍 ⚠未复核【引擎核心】 | src/story.py:1681,1473,1340-1374,656-708 | 摘要 stale-while-revalidate 后台重算;_flush_short_memory 响应后异步补写 |
| P2-13 | long_memory 无上限增长(其余日志都有 cap)⚠未复核【引擎核心】 | src/story.py:1389-1405,1416 | superseded 物理清理 + 按 (entity,kind) 保留 N 条 + 总量封顶 |
| P2-14 | 向量层一次瞬时 DB 异常即整进程永久降级,无恢复无告警 ⚠未复核【引擎核心】 | src/memory.py:34-37,81-86,137-139 | DB 异常改限时降级(_disabled_until 指数退避),health 加 vector_available |
| P2-15 | 进聊天页即自动新建会话并烧一次 LLM,切 tab 来回成倍计费 ⚠未复核 | frontend/app.jsx:2156-2186,2204 | 开场延迟到首次输入;chat 会话 state 提升到 App 层复用 |
| P2-16 | /api/auth/me 失败被吞成「AUTH 未开」,网络抖动让用户进入全 401 假界面 ⚠未复核 | frontend/app.jsx:2399-2407 | 区分失败类型,网络/5xx 显示重试页;patchFetch 加全局 401 → 回登录 |
| P2-17 | 本地存档与 server sessions 双源漂移:孤儿残留、删除失败仍删本地、还原失败静默空局 ⚠未复核 | frontend/app.jsx:2487-2496,2609-2616,1017-1022 | 登录态以服务端为唯一权威;删除以后端结果为准;还原失败显式报错 |
| P2-18 | migrations/ 无法重建 prod schema,无基线无台账,已发生漂移 ⚠未复核 | migrations/ 全目录 | pg_dump --schema-only 入库为 0000-baseline,此后 DDL 一律走 apply_migration |
| P2-19 | cards/presets 无主键,update-then-insert 并发首存撞唯一索引 500 ⚠未复核 | src/storage.py:180-190,258-268 | 加 identity PK;改 on conflict do update 或捕获重试 |
| P2-20 | delete_session 不清 memory_vec,prod 已有 59 行孤儿向量 ⚠未复核【引擎核心】 | src/storage.py:125-130 | 同事务补删 + 一次性孤儿清理,可选 FK cascade |
| P2-21 | sessions/cards/presets/memory_vec 的 user_id 无外键,删用户留悬挂归属 ⚠未复核 | migrations/2026-06-09-phase1-accounts.sql:50-53 | 补 FK `on delete set null`(NOT VALID → VALIDATE 两步) |
| P2-22 | resolve_token 每个认证请求拖 17KB avatar + 每请求写一次 last_used_at ⚠未复核 | src/auth.py:182-191 | SELECT 去掉 avatar;last_used_at 节流更新(>5min 才写) |
| P2-23 | render.yaml 环境变量清单不全,重建服务时 pepper/SUPERADMIN/COST_GUARD 静默回不安全默认 ✅复核 | render.yaml:21-36 | blueprint 补齐全部生产必需键(敏感标 sync:false)+ 启动校验缺失报错 |
| P2-24 | 零构建到顶:每次访问主线程现编译 ~380KB JSX,app.jsx 拖 ~1300 行死代码照编译 ⚠未复核 | frontend/index.html:13,63-73; app.jsx:272-2009 | 先删死代码;构建期 esbuild/babel 预编译产物,babel-standalone 下线 |
| P2-25 | 无优雅停机:SIGTERM 截断在途回合,costguard 预扣不对账(按日自愈但当日偏高)⚠未复核 | src/api.py:506; src/costguard.py:154 | uvicorn graceful timeout + 孤儿预扣对账清理 |
| P2-26 | DB 池 max 10 与 ~40 线程池失配,扩容时 N×10 撞 pooler 上限 ⚠未复核 | src/db.py:49-56 | DB_POOL_MAX 写进 render.yaml,与线程池/实例数核算匹配 |
| P2-27 | library/presets 列表无分页、整 data 全量返回,data-URI 封面直接进列表 ⚠未复核 | src/storage.py:194-209,272-286; src/api.py:669-675 | limit/offset + 摘要投影,详情另开单卡端点 |

### P3 — 可改

| # | 问题 | 文件 | 一句话改法 |
|---|------|------|-----------|
| P3-1 | authenticate 用户不存在时跳过 pbkdf2,计时差异可枚举用户 ⚠未复核 | src/auth.py:137-154 | 不存在时也对假 hash 跑一次等价哈希 |
| P3-2 | auth_tokens/email_otp/rate_limits 无过期清理,只增不减 ⚠未复核 | src/auth.py:169-175; src/costguard.py:129 | pg_cron / 启动批量 delete 过期行 |
| P3-3 | memory_vec_hnsw 全局索引零使用,纯写放大 ⚠未复核【引擎核心】 | src/memory.py:182-187 | 确认无全局检索规划后 drop index |
| P3-4 | sessions 缺 (user_id, updated_at desc) 复合索引(**须先于数据增长**)⚠未复核 | src/storage.py:144-155 | `create index concurrently`,顺手 drop 被覆盖单列索引 |
| P3-5 | 静态资产无 Cache-Control,首页 976KB PNG 拖 LCP ⚠未复核 | src/api.py:1060-1064; frontend/assets | 中间件加 max-age;hero/封面出 WebP 旁路 |
| P3-6 | save_session resync 与向量 upsert 逐行 execute,数百次串行往返 ⚠未复核【引擎核心(向量部分)】 | src/storage.py:108-122; src/memory.py:92-107 | executemany / 多 VALUES 批量;resync 改差异尾段重写 |
| P3-7 | costguard 用天级全局 advisory lock 串行化所有回合开闸 ⚠未复核 | src/costguard.py:113,178 | 改单条原子 UPDATE…RETURNING 预扣,去全局锁 |
| P3-8 | 每回合客户端全量重传整套卡组,服务端已有 artifacts 快照 ⚠未复核(与 P2-6 合并实施) | src/api.py:77-85; src/story.py:1638-1644 | cards_hash 命中即用服务端快照的轻量协议 |
| P3-9 | deep 模型落易失盘,每次重启重下 130MB,与 Web 进程同生死 ⚠未复核【引擎核心】 | render.yaml:7-19; src/memory.py:41-73 | buildCommand 预下载进镜像;中期 embedding 拆服务 |
| P3-10 | oc/index.json 文件态与 DB 割裂,归属靠昵称字符串匹配 ⚠未复核 | src/api.py:40,258-316,863-915 | OC 元数据迁 cards 表(user_id 外键),静态资产留文件 |
| P3-11 | api.py 1064 行上帝文件 ⚠未复核 | src/api.py 整体 | 按域拆 APIRouter + 统一异常处理器(与 P2-9 合并) |
| P3-12 | 无代码级备份,全押 Supabase 托管备份且未验证 ⚠未复核 | — | 确认 PITR/每日备份,补定期 pg_dump 离线副本 |

---

## 二、逐条展开

### P0-1 全部 8 张表 RLS 关闭(critical,✅复核)

- **问题与证据**:migrations/2026-06-09-phase1-accounts.sql:12-46 无任何 enable RLS;advisor 对 sessions/messages/cards/presets/memory_vec/users/auth_tokens/email_otp 全部报 EXTERNAL 级 rls_disabled ERROR;复核另查 role_table_grants:anon 对 users/auth_tokens 持全套 SELECT/INSERT/UPDATE/DELETE。
- **为什么**:anon key 本就公开,持 key 者经 PostgREST 绕过 FastAPI 直读 password_hash/token_hash、提权 role、删库。隔离全在应用层,DB 零防护,与 Render 部署形态无关。
- **改法**:对 8 表 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`(不加任何 policy = anon/authenticated 全拒);或 Dashboard 直接把表移出 exposed schema。
- **prod 安全策略**:应用走 DATABASE_URL 直连(src/db.py:41),连接角色是表 owner,未 FORCE 时 owner 天然绕过 RLS,对 FastAPI 零影响;前端不用 supabase-js。**回滚 = DISABLE ROW LEVEL SECURITY,秒级**。注意分清 prod 与 test 两个 Supabase 项目,先在 test 库(yldfnbmpzkzjzjoyvfhb)演练。
- **工作量**:S

### P0-2 LLM 端点整类绕过 costguard + build_card 无鉴权 + chat 匿名放行(critical×2 + high×2 合并,✅复核)

- **问题与证据**:costguard.preflight/record 只在 story_turn(api.py:506)、stream(:539)、reroll(:609)三处;/api/chat(:457)、/api/build_card(:404-413)、identify 全家(:348-441)直调 LLM,grep costguard 零命中。api_build_card 无任何 Depends 鉴权;api_chat 经 auth.py:228-231 对「无主 session + 匿名」直接放行。costguard.py:5 自述目标「堵任何人直接打烧 DeepSeek key」。
- **为什么**:AUTH_ENABLED=1 的 prod 上,匿名脚本即可无上限烧 key;花费不计入 spend_daily,GLOBAL_DAILY_USD_CAP 整类旁路——既是资损面也是 DoS 面,全局熔断形同虚设。
- **改法**:抽一个 guarded-LLM 依赖/装饰器,把 `costguard.preflight(client_ip)/record`(usage 经各自 collect_usage 累入)套到 chat/build_card/identify 全部端点;api_build_card 加 `Depends(current_user_dep)` + `_write_owner` 强制登录;AUTH 开时 api_chat 收紧匿名放行(`if auth.enabled() and user is None: 401`)。
- **prod 安全策略**:完全向后兼容——COST_GUARD_ENABLED=0 时 preflight 返回惰性 reservation、record no-op(costguard.py:99-100,169),AUTH_ENABLED=0 时 owner 校验 no-op;先上代码再翻开关灰度,**回滚 = 翻回开关,不动 schema**。前端已带 token,正常登录用户无感。
- **工作量**:M

### P0-3 story_turn 并发 load-modify-save 无锁,resync 全删重写(high,✅复核)

- **问题与证据**:story.py:1609 load_session → :1503 _save_turn→save_session,全程无锁无版本号;storage.py:117-122 检测尾部不一致即 DELETE 全部 messages 再逐条 INSERT。回合耗时数十秒,operator inject/say(api.py:797-825 同样无锁)与玩家回合并发是设计内场景。
- **为什么**:后写者整份覆盖前写者的 state/long_memory/turns,并发触发 resync 还会物理删除对方刚写的 messages 行,不可恢复——数据一致性主风险点,前端防抖只护单 tab。
- **改法**:回合级 `pg_advisory_xact_lock(hashtext('session:'||id))` 包住 load→save;端点对同 session 并发请求返回 409。中期可加 sessions.version 列做乐观并发。
- **prod 安全策略**:advisory lock 方案**零 schema 变更**,单请求路径行为无差异,可直接灰度(env 开关包裹);version 列走 expand 迁移(加列默认 0 老代码忽略,全量发布后再启用校验)。**回滚 = 摘掉锁调用**。
- **工作量**:M。【引擎核心:动 story.py/storage.py 回合落盘路径,合 main 前需主理人压测】

### P0-4 /oc-assets 泄露邮箱 PII 与私有 OC 文稿(medium 但属 PII 泄露,✅复核)

- **问题与证据**:api.py:1060-1061 `app.mount('/oc-assets', StaticFiles(OC_DIR))` 无鉴权;OC_DIR 下 index.json 实含两个真实邮箱,larus-canus/ 的 card.md/profile.md/world.md 可匿名 GET,绕过 /api/my/oc 与 /api/operator/oc 的全部门控。
- **为什么**:PII + 私有创作内容直接公网可拉,且文件随 git 部署到 Render。暴露面有界(2 邮箱 + 1 OC 文本)但属确定性泄露。
- **改法**:OC_DIR 下新建 public/ 子目录,只放前端 `<img>`/anim 实际引用的 art/anim;挂载点改指 public;index.json 与 .md 留在挂载外,内容仍经鉴权 API 下发。
- **prod 安全策略**:改的是磁盘布局与挂载目录,API 契约不变;前端资源 URL 保持 /oc-assets 前缀(public 内保留原相对路径)即零前端改动。**回滚 = 挂载点改回 OC_DIR**。上线前用匿名 curl 验证 index.json/.md 已 404、art 仍 200。
- **工作量**:S

### P1-1 同步 LLM 端点占满 AnyIO 线程池(high,✅复核)

- **问题与证据**:api_chat/api_identify×4/api_build_card 均为同步 def 路由,内部 chat_messages→`_client.chat.completions.create(timeout=60s)`(llm.py:15-19),identify 重试 3 次最坏 180s,reply() 还可能串行第二次 LLM(chat.py:79-87);默认 40 线程池与 login/me/library 共池。
- **为什么**:约 40 个并发慢 LLM 请求即耗尽线程池,全部同步端点一起卡死;叠加 P0-2(这些端点无限流无鉴权),匿名 40 并发等效全站 DoS。
- **改法**:端点改 async;LLM 走已有 achat_messages(identify/chat 补 async 版),过渡期 `asyncio.to_thread` 一行包裹同步实现。
- **prod 安全策略**:纯实现层替换,接口签名/响应不变;**逐端点灰度**(先改流量最大的 api_chat),出问题逐个回退;to_thread 过渡方案行为完全等价,回滚即还原函数签名。
- **工作量**:M

### P1-2 story_turn 异常吞成 200 且零日志(high,✅复核)

- **问题与证据**:api.py:518-520 `except Exception as e: ... return _fallback_turn_dict(req,e)`,异常只进返回给客户端的 memory_write 文本;流式 runner(:563-564)同样静默;全仓无 logging.basicConfig,memory.py:69/85 用裸 print。
- **为什么**:真实 LLM/DB/解析故障在 prod 表现为「玩家收到保底回合 + HTTP 200」,Render 日志无堆栈无计数,observability = 0。
- **改法**:两处 except 加 `log.exception('story_turn failed session=%s', ...)`;api.py 启动配 logging(级别/格式);memory.py 的 print 换 logger;后续可接 Sentry。
- **prod 安全策略**:纯增量日志,响应契约与玩家体验不变(仍拿保底回合);零迁移,**回滚 = 删日志行**。
- **工作量**:S

### P1-3 X-Forwarded-For 首段可伪造,per-IP 限流全绕(medium,✅复核,原 critical 降级)

- **问题与证据**:costguard.py:75-83 取 `xff.split(',')[0]`;Render 反代把真实 IP 追加在客户端自带 XFF 链之后,首段完全由客户端自报;rate_limits/usage_daily 全按 `ip:` 键。
- **为什么**:每请求随机伪造首段即令 per-IP 闸全失效,只剩全局日上限兜底——单人可数分钟烧穿 GLOBAL_DAILY_USD_CAP,把全服打进 503(对所有玩家 DoS;成本侧有界、次日恢复)。
- **改法**:XFF 从右往左跳过可信代理取第一段(Render 单层反代即取末段),并用 request.client.host 兜底;给限流加 user:<uuid>/session 维度二级 subject。
- **prod 安全策略**:只改 IP 解析函数,合法用户(不带伪造 XFF)走 Render 注入的真实 IP,计数主体更准不更松;COST_GUARD_ENABLED 开关仍在,**异常即关闸回滚**。
- **工作量**:S

### P1-4 登录无速率限制可暴力撞库(medium,✅复核)

- **问题与证据**:api_login(api.py:177-184)直通 auth.authenticate(auth.py:137-154),无失败计数/锁定;costguard 的 rate_limits 只挂 story_turn 系列。密码下限 6 位,superadmin 可定向字典;注册侧已被邮箱 OTP fail-closed 闸住(复核确认「批量注册」半边不成立)。
- **为什么**:pbkdf2 600k 迭代只拖慢不阻断,撞库速度只受服务器吞吐限制;另有 CPU-DoS 面。
- **改法**:对 /api/auth/login 加按 IP + 按 identifier 的失败计数与指数退避/锁定,复用 rate_limits 表,独立计数键(login:ip:* / login:user:*)。
- **prod 安全策略**:阈值放宽到正常用户不可能触发;独立计数键不影响现有 rate_limits 数据;加 env 开关门控,**回滚 = 关开关**。
- **工作量**:M

### P1-5 chat 历史进程内 dict,部署即全丢(medium,✅复核,3 条合并)

- **问题与证据**:chat.py:16-17 模块级 `SESSIONS`/`SUMMARIES` dict,reply()(:91-122)每轮 append 无淘汰无落库;复核加重:chat 路径从不调 ensure_loading,memory.add_turn 因 is_ready() 门控实为 no-op,1:1 历史连 pgvector 都不进,每次部署全灭。多 worker 分裂在当前单实例 render.yaml 下是假设场景。
- **为什么**:玩家面 OC 聊天(app.jsx:2179 实际在用)每次部署清零;dict 随会话数无限涨;重启后 turn 归零还会 upsert 覆盖旧向量。
- **改法**:历史/摘要落已有 sessions/messages 表(storage.save_session 语义现成,加 kind 区分 story/chat);SESSIONS 降级为带 LRU/TTL 的读穿透缓存;摘要后台刷新。
- **prod 安全策略**:**expand-contract 双写过渡**——先写双份(dict + DB),读优先 DB、miss 回退 dict;验证一个发布周期后 contract 删 dict。session_id 不变前端零改动;旧进程内会话本来重启就丢,**迁移无回退风险,回滚 = 停用 DB 读路径**。
- **工作量**:M。【引擎核心:触碰 chat 记忆链路与 memory 写入,需主理人压测】

### P1-6 _reroll 快照全量历史嵌回 blob,O(n²) 写放大(medium,✅复核,2 条合并)

- **问题与证据**:story.py:1612 `pre_snapshot = copy.deepcopy(...)` 含全量 messages(无截断)+ turns(≤300)+ long_memory,:1645 挂入 `data['_reroll']`;storage.py:79 只剥顶层 messages,快照内嵌历史照进 sessions.data,每回合整行 UPSERT(:83-88),把 messages 拆表的 append-only 优化整个抵消。
- **为什么**:回合数 n 时每回合读写 ~2 倍全史 jsonb,长局单行可达数 MB,Supabase 读写/egress 平方级放大;每轮正常游玩必触发。
- **改法**:快照不存 messages 原文,只存 message_count + 受影响小字段(state/summary/long_memory 尾段);reroll 回滚改 `delete from messages where seq >= count`;artifacts 未变时 hash 比对跳过重写。
- **prod 安全策略**:**两版共存一个发布周期**——reroll 读取处先认新字段(message_count),没有再回退旧 snapshot.messages;旧存档下一回合自然被瘦快照覆盖,无需迁移存量,**回滚 = 还原写胖快照的代码**。
- **工作量**:M。【引擎核心:动 story.py reroll/落盘路径,需主理人压测】

### P1-7 健康检查形同虚设(medium,⚠未复核)

- **问题与证据**:render.yaml:20 healthCheckPath:/ 命中静态挂载(api.py:1063);/api/health(:319)查了 DB 但无论 db_ok 都返回 status:'ok'(:342)。
- **为什么**:实例丢 Supabase 连接时 Render 照常认为健康,不重启不摘流,故障实例持续吐保底回合。
- **改法**:healthCheckPath 改 /api/health;db_ok=False 时返回 503。
- **prod 安全策略**:先观察 /api/health 在正常实例稳定 2xx 数日再切探针路径,避免误重启;**回滚 = 路径改回 /**。
- **工作量**:S

### P2 逐条(摘要式展开)

**P2-1 turns 拆出 sessions blob(✅复核)** — storage.py:79-88 每回合整行 upsert,prod 实测 avg 90KB/max 827KB;turns 截断 300 条故 O(n²) 有硬上界,300 回合后恒定 ~800KB/回合写放大。改法:turns 仿 messages 拆 append-only 行表(session_id, turn_no, data),blob 只留 state/artifacts/memory 摘要。**prod 安全:标准 expand-contract——建新表→双写(读仍走 blob)→回填→切读→停写,每步独立回滚,旧数据不动**。工作量 L。【引擎核心:动落盘路径,需压测】

**P2-2 tail/operator 轮询全量拉取(✅复核;可见性退避部分⚠未复核)** — api.py:658 tail 经 load_session 整拉 blob+全部 messages 行(tail 完全不用 messages,纯浪费);前端 3.5s/4s 常驻轮询。改法:tail 走专用 SQL(jsonb_array_length + jsonb_path_query_array 切片,不碰 messages 表);operator 接口加 after 增量参数;前端 visibilitychange 暂停、退避 10-15s;中期 SSE 推送。**prod 安全:纯新增查询路径,响应 shape(turn_count/new_turns/state)不变,旧前端继续可用;先后端再 bump 前端 ?v=;回滚 = tail 内部切回 load_session**。工作量 M。

**P2-3 token localStorage + 零 CSP(✅复核)** — app.jsx:6-25 60 天 token 入 localStorage、patchFetch 全局注入 Bearer;index.html/vercel.json 无任何 CSP。复核注:全前端零 innerHTML,React 默认转义,无已证实 XSS 注入点,属纵深防御缺失。改法:vercel.json 加 CSP 头(script-src 锁 self+unpkg,'unsafe-eval' 暂留);token 缩期 + 滑动续期(logout 吊销已有);中期 Vite 后去 unsafe-eval、token 改 HttpOnly cookie。**prod 安全:CSP 先 Content-Security-Policy-Report-Only 灰度一周再转强制,纯响应头秒级回滚;cookie 化 expand-contract——后端同时接受 Bearer 与 cookie,旧 token 自然到期后收口**。工作量 M。

**P2-4 unpkg 三连无 SRI(✅复核)** — index.html:11-13 react/react-dom/babel-standalone 均无 integrity,投毒即可窃 localStorage token,且大陆访问 unpkg 不稳、缺一白屏。改法:三文件 vendor 进 frontend/vendor/ 自托管(零构建路线只改三行 src);暂留 CDN 则补 integrity + onerror 本地回退。**prod 安全:静态路径替换,运行时逐字节一致;Vercel 部署后验证加载;回滚 = 改回三行 URL**。工作量 S。

**P2-5 window.* 链脆弱无 ErrorBoundary(✅复核)** — index.html:63-73 十个 text/babel 视图挂 window.*,app.jsx 渲染处 `<window.ReconX>` 无一判空,全目录无 ErrorBoundary;任一视图语法错 → React 卸载整树。复核注:「?v= 漏改→404」不成立,「半径 100%」夸大(非首屏视图仅切入时崩)。改法:渲染前守卫 + App 外层 ErrorBoundary(刷新重试提示)。**prod 安全:守卫只在异常路径生效,正常渲染零变化;先只包最外层,随时摘除**。工作量 S。

**P2-6 隐藏真相下发 + deck 可篡改(✅复核)** — app.jsx:1038 每回合整包 deck POST;:2394 拉全量 presets(含 WorldEditor 自述「藏给玩家」的 hidden 字段);api.py:508 服务端信任客户端 deck,story.py:1638 再快照令篡改持久化。影响限于自剧透/作者设定泄露,无跨用户面。改法:story_turn/chat 支持「只传 session_id+输入,deck 用服务端 artifacts 快照」;/api/presets 列表态裁 known_hidden/hidden;详情仅开局由服务端注入。**prod 安全:expand-contract——后端先增无 deck 取快照分支(老客户端带 deck 照旧),前端再灰度停发;presets 瘦身只影响列表字段;逐端点回滚**。工作量 L。【引擎核心:动 story_turn 入参链路,需压测】

**P2-7 sessionId 游客作用域串档(✅复核)** — app.jsx:2341 首渲染按游客 scope 初始化 sessionId,:2409-2412 登录后不重算,:2637 自动还原。复核注:有主局被后端 401/403 挡死,串档限于无主遗留游客局(prod 73/130 局无主),属存量过渡窗口。改法:auth.ready 后按当前 scope 重算 sessionId;restore effect 等 auth.ready。**prod 安全:纯前端时序调整,游客路径行为不变(scope 同为空串),老存档 key 原样保留,无后端改动,整体可回滚**。工作量 S。与 P2-10 配套收尾。

**P2-8 /api/upload 无鉴权无大小上限(⚠未复核)** — api.py:445-447 `await request.body()` 一次性读入,无 Content-Length 校验。改法:加请求体上限(校验/流式截断)+ 视情况要求登录。**prod 安全:上限设宽(覆盖正常 txt/md/docx),只挡异常超大请求;先宽松阈值灰度,回滚 = 去掉校验**。工作量 S。

**P2-9 500 回显原始异常(⚠未复核)** — api.py 11 处 `f"...失败:{e}"`。改法:对外中性文案,e 详情进服务端日志(依赖 P1-2 的 logging 落地)。**prod 安全:仅改对外文案,前端只依赖状态码与通用 detail,无契约变更,纯前向兼容**。工作量 S。

**P2-10 无主存档过渡期放行收口(放行证据✅、收口策略⚠未复核)** — auth.py:228-230 owner=None 且匿名直接放行;claim=False 读路径(api.py:633,657)同样不阻断;session_id 客户端任意指定。改法:先用已有 assign_session/claim_session 工具把 73 个遗留局批量认领,再翻开关关闭过渡期放行;新存档强制服务端生成不可枚举 id。**prod 安全:expand-contract——迁移期保持现行为,归属迁完再翻开关;回退 = 重新放行**。工作量 M。

**P2-11 send_code 缺 IP 限流(⚠未复核)** — auth.py:321-322 仅 email+purpose 60s 闸,换邮箱即绕过,可邮件轰炸/耗 SMTP 配额。改法:加每 IP 窗口限流 + 单邮箱每日上限。**prod 安全:新计数维度与现有 60s 闸并存互不影响,阈值放宽到正常用户不可能触发,门控化可回退**。工作量 S。

**P2-12 摘要/记忆抽取串行在回合关键路径(⚠未复核,【引擎核心】)** — story.py:1681 摘要 LLM 在主回合 LLM 前 await(每 4 条重算),:1473 deep 模式回合尾再串一次抽取 LLM。改法:摘要 stale-while-revalidate(本回合用缓存,create_task 后台重算写回供下回合);_flush_short_memory 响应后 fire-and-forget。**prod 安全:旧摘要兜底路径(:1350-1352)已存在且久经使用,行为只差摘要新鲜度晚一回合;env 开关灰度,关掉即恢复串行**。工作量 M。

**P2-13 long_memory 无上限(⚠未复核,【引擎核心】)** — story.py:1395/1404/1416 只 append,对比 turns/usage_log/reasoning_log 都有 cap。改法:写入时 compaction——superseded 超阈值物理清理,按 (entity,kind) 保留最近 N 条 + importance≥3,总量封顶(如 500)。**prod 安全:只裁最旧/已 superseded 低重要度条目,读路径不变;cap 取远大于现有 prod 任一局的宽松值,对 73 局存量零影响;先只清 superseded 灰度**。工作量 M。

**P2-14 向量层一次异常永久降级(⚠未复核,【引擎核心】)** — memory.py:34-37 `_available` 单向置 False 仅 print,一次 pooler 抖动即整进程关闭召回直到重启,运营无感知。改法:DB 异常改 `_disabled_until` 时间戳 + 指数退避自动恢复,模型加载失败才永久;_mark_unavailable 换 logging.error;/api/health 加 vector_available 字段。**prod 安全:降级语义不变(不可用仍 no-op 纯文本),只是永久变限时;health 字段新增,老前端忽略即可;回滚 = 还原布尔**。工作量 S。

**P2-15 进聊天页自动烧 LLM(⚠未复核)** — app.jsx:2171-2186 挂载即自动开场调 /api/chat,组件卸载状态清零,每次路过 #/chat 都新会话+新调用。改法:开场延迟到首次聚焦输入/发送;会话 state 提升到 App 层或 sessionStorage;同角色复用 session_id。**prod 安全:纯前端触发时机调整,/api/chat 协议不动,可按钮级灰度回滚**。工作量 S。

**P2-16 /api/auth/me 失败吞成「未开」(⚠未复核)** — app.jsx:2399-2407 catch 与非 401 的 !r.ok 都归为 enabled:false,一次超时即进全 401 假界面。改法:网络/5xx 显示「连接失败·重试」页(指数退避);patchFetch 加全局 401 → 清 token 回登录。**prod 安全:只改异常分支,成功路径逐字节不变;重试页特性开关控制,随时关回旧行为**。工作量 S。

**P2-17 双源存档漂移(⚠未复核)** — app.jsx:2487 合并 localOnly+server 孤儿永久残留;:2611 删除 `catch{}` 后无条件删本地;:1022 还原失败静默空局(数据分叉风险)。改法:登录态以 /api/my/sessions 为唯一权威,本地仅游客缓存/乐观 UI;删除以后端结果为准;还原失败显式报错禁止降级空局。**prod 安全:全在前端,游客路径行为不变,后端不动;先改删除与报错(低风险),权威切换按登录态灰度,保留旧合并函数回滚**。工作量 M。

**P2-18 migrations 无基线无台账(⚠未复核)** — migrations/ 仅 4 个增量文件,核心五表建表 SQL 不在 repo,prod 有索引无 migration 记录,schema.sql 双源漂移(记忆中 prod/test schema 已不一致)。改法:`pg_dump --schema-only` prod 导出入库为 0000-baseline.sql;此后 DDL 一律走 supabase MCP apply_migration(自带台账);补 schema_migrations 跟踪。**prod 安全:baseline 导出纯只读零 DDL;runner 先在 test 项目演练;迁移本身 if not exists 幂等**。工作量 S。**此项必须先行于所有后续 DB 改动**。

**P2-19 cards/presets 无 PK(⚠未复核)** — storage.py:180-190 update-then-insert 非原子,并发首存撞 uq_cards_user 直接 500。改法:加 `id bigint generated always as identity primary key`;代码改 on conflict do update 或捕获 UniqueViolation 重试。**prod 安全:加 identity 列 + PK 是 additive DDL,旧行自动编号不改现有查询;可先只上捕获重试(纯代码),回滚 = 还原旧函数**。工作量 S。

**P2-20 delete_session 不清 memory_vec(⚠未复核,两条合并,【引擎核心】)** — storage.py:125-130 只删 sessions;memory_vec 无 FK,prod 实查 4,657 行中 59 行孤儿。改法:delete_session 同事务补 `delete from memory_vec where session_id=%s`;一次性孤儿清理;可选 FK on delete cascade(先清孤儿,NOT VALID→VALIDATE)。**prod 安全:删的是无 session 指向的死数据;清理前先 SELECT 列出并导出备份,脚本幂等分批可中止**。工作量 S。

**P2-21 user_id 四列无 FK(⚠未复核)** — phase1 迁移只 add column 未 references,全库仅 2 个 FK。改法:补 `references users(id) on delete set null`(set null = 回到无主可认领,契合现有语义)。**prod 安全:ADD CONSTRAINT ... NOT VALID 不扫表不锁业务,VALIDATE 仅共享锁;现无悬挂值验证必过;回滚 = DROP CONSTRAINT**。工作量 S。

**P2-22 resolve_token 热路径拖 avatar + 每请求写(⚠未复核)** — auth.py:182-191,prod 实查 avatar max 17,075 字符,每个带 token 请求 = 1 读(含 17KB)+1 写 last_used_at。改法:SELECT 去 avatar(前端经 /api/my 单独取并缓存);last_used_at 节流(为空或早于 now()-5min 才 UPDATE)。**prod 安全:_row_to_user 已兼容无 avatar 行(auth.py:100 的 keys 判断);节流写不改 schema,随时回滚**。工作量 S。

**P2-23 render.yaml env 清单不全(✅复核)** — envVars 只有 LLM_*/DATABASE_URL;AUTH_TOKEN_PEPPER 默认 ''、SUPERADMIN_EMAIL/COST_GUARD_ENABLED 缺失时静默回不安全默认,重建服务即 AUTH 整体静默回关。改法:blueprint 补齐全部生产必需键(敏感标 sync:false,非敏感给显式 value)+ 启动时校验缺失项报错。**prod 安全:把控制台手填值固化进 blueprint,先核对线上现值再写、与现网一致即零行为变化;pepper 绝对维持现值不动(改了已发 token/OTP 全失效)**。工作量 S。

**P2-24 零构建现编译 + 死代码(⚠未复核,两条合并)** — index.html 11 个 text/babel(~380KB 源)每次访问浏览器现编译,babel-standalone 自身 ~3MB;app.jsx 中 SetupPanel/BuildView/VaultView/StepBuilder/COACH(~1300 行)已无调用点照编译。改法:先删死代码(约 -45% app.jsx);Render buildCommand 加 esbuild/babel 预编译产物,index.html 挂产物、babel-standalone 下线,react 本地 vendored(与 P2-4 合并);中期评估迁 Vite。**prod 安全:删死代码先在 preview 域名全页面点检再合入;构建失败保留挂 babel 的原 index.html 作 fallback,秒级回滚;后端零改动**。工作量 M(Vite 迁移另计 L)。

**P2-25 无优雅停机(⚠未复核)** — costguard.py:154 preflight 预扣后若 SIGTERM 杀进程,record 永不执行,当日 spend_daily 偏高可能提前误熔断;在途 SSE 回合被截断。改法:uvicorn graceful timeout 让在途请求收尾;加孤儿预扣对账清理;确认 SSE finally 的 record 在 SIGTERM 下能跑完。**prod 安全:预扣偏差按日自愈(_today 切日)影响有界;超时/清理纯增强不改 schema,可灰度**。工作量 S。

**P2-26 DB 池与线程池失配(⚠未复核)** — db.py:49-56 max 10 vs ~40 线程,扩 N 实例 = N×10 打同一 pooler。改法:DB_POOL_MAX 按实例数与 Supabase 限额核算并写进 render.yaml;限制 threadpool 与池匹配。**prod 安全:仅调连接数/环境变量不改逻辑;先压测定值,过小回调即可**。工作量 S。

**P2-27 library/presets 列表无分页全量返回(⚠未复核)** — storage.py 列表 SQL 无 limit、整 data 返回,preset cover 可为 data-URI 直接进列表;前端启动并发拉 4 kind 全量。改法:limit/offset(缺省值=现行为)+ jsonb 摘要投影(name/title/synopsis/cover 截断),新增 GET /api/library/{kind}/{name} 取详情。**prod 安全:expand-contract——新增轻量字段/端点,旧响应字段保留,前端逐屏迁移;参数缺省即现行为,任意时刻回退**。工作量 M。

### P3 逐条(简要)

| # | 证据要点 | 改法 + prod 安全 | 工作量 |
|---|---------|----------------|--------|
| P3-1 计时枚举 | auth.py:149-151 用户不存在跳过 pbkdf2 | 失败路径对固定假 hash 跑一次等价哈希;成功路径与返回值不变,纯前向兼容 | S |
| P3-2 token/otp/rate_limits 不清理 | auth.py:169-175 只 UPDATE revoked_at;prod 实查死行 | pg_cron/启动批量删过期 30 天+行;resolve_token 本就过滤这些行,行为零变化,任务可随时 unschedule | S |
| P3-3 hnsw 零使用 | advisor 报 never used,查询全按 session 前缀走 pkey | 确认无全局检索规划后 drop;回滚 = 重建(4,657 行秒级)。【引擎核心,需主理人确认召回规划】 | S |
| P3-4 sessions 复合索引(**先行**) | 现仅 idx_sessions_user 单列,130 行无感但行数过千即扫描排序 | `create index concurrently (user_id, updated_at desc)` 不锁写;回滚 = drop index;**排在用户量起来前** | S |
| P3-5 无 Cache-Control + 大图 | api.py:1064 默认仅 ETag;hero 976KB PNG | 中间件对 /assets /covers 加 max-age=604800(?v= 击穿保留);图片旁路出 .webp 用 picture 回退,旧缓存不受影响 | S |
| P3-6 逐行 execute | storage.py:109-122、memory.py:97-107 循环单条 | executemany/多 VALUES,同表同冲突策略同事务,纯驱动层替换可单测回归。【向量部分涉记忆层】 | S |
| P3-7 costguard 全局锁 | costguard.py:113,178 天级 advisory lock 内含多次远程往返 | 改原子 UPDATE…RETURNING 预扣去锁;fail-open 兜底保留,先 test 库压测对账误差,回滚 = 还原一把锁 | M |
| P3-8 每回合全量重传卡组 | api.py:77-85;artifacts 已可还原(reroll/operator 已证明) | cards_hash 命中走服务端快照,可选参数旧请求照旧,回滚 = 前端不发 hash(与 P2-6 合并做) | M |
| P3-9 deep 模型冷启动 | render.yaml:7-19 易失盘每次重启重下 130MB | buildCommand 预下载进镜像(零行为变化只省冷启动);中期 embedding 拆服务,env 切换来源随时切回。【引擎核心】 | S(拆服务 L) |
| P3-10 OC 文件态割裂 | api.py:281-285 归属靠昵称字符串匹配,改 OC 要发版 | 元数据迁 cards 表(kind='oc',user_id 外键);expand-contract:DB 优先文件回退并行一周,index.json 留作种子,可回退纯文件 | M |
| P3-11 api.py 上帝文件 | 1064 行 45+ 端点混装 | 按域拆 APIRouter + 统一异常处理器;纯重构,OpenAPI diff 为零即可发 | M |
| P3-12 备份未验证 | 仓库无备份脚本/说明 | 确认 Supabase PITR/每日备份并记录 RPO/RTO;补定期 pg_dump 离线副本;纯运维只读无副作用 | S |

---

## 三、建议执行顺序(每批可独立上线、独立回滚)

**批次 0 · 止血与地基(本周内,均 S,互相独立)——必须先行**
1. **P2-18 迁移基线先行**:pg_dump baseline 入库 + 之后一切 DDL 走 apply_migration——它是后面所有 DB 批次的前置,且为只读操作零风险。
2. **P0-1 RLS**(test 库演练 → prod,秒级回滚)。
3. **P0-4 /oc-assets 收口**(PII 止血)。
4. **P1-2 日志** + **P1-7 健康检查**:先有观测,后面每一批上线才有眼睛。

**批次 1 · 闸门(资损面,代码 + 开关灰度)**
5. **P0-2 LLM 端点统一过闸 + 鉴权**、**P1-3 XFF 修正**、**P1-4 登录限流**、P2-11 send_code IP 限流。同主题一批,全部 env 开关门控,回滚即翻开关。

**批次 2 · 可用性**
6. **P1-1 同步端点 async 化**(逐端点灰度)、P2-8 upload 上限、P2-9 500 文案、P2-16 me 失败重试页、P2-5 ErrorBoundary、P2-4 vendor 自托管。前后端可并行,各自独立回滚。

**批次 3 · 引擎核心批(⚠ 需主理人压测后合 main,见第四节)**
7. **P0-3 并发锁**(advisory lock,零 schema)→ **P1-6 reroll 瘦快照** → **P1-5 chat 落库**(双写过渡)→ P2-12 摘要异步 / P2-13 long_memory 封顶 / P2-14 向量限时降级。建议按此顺序逐项小批合入,每项独立开关。

**批次 4 · DB 卫生(必须先于数据增长,趁现在 130 局/4,657 向量行时做,成本最低)**
8. **P3-4 复合索引、P2-19 PK、P2-21 FK、P2-20 memory_vec 清理**、P2-22 resolve_token 瘦身、P3-2 过期清理、P2-23 render.yaml 固化、P2-26 池核算。全部 additive/NOT VALID 两步,行数小验证快——拖到数据量大了再做,锁与回填成本都会翻倍。

**批次 5 · 性能与产品面**
9. P2-2 tail 增量化 → P2-1 turns 拆表(expand-contract,周期最长)→ P2-27 列表分页 → P2-6 服务端权威卡组(+P3-8 hash 协议)→ P2-7/P2-10 存档归属收口 → P2-15/P2-17 前端会话治理。

**批次 6 · 前端工程化与扫尾**
10. P2-24 删死代码 + 预编译 → P2-3 CSP(Report-Only 一周)→ 评估 Vite 迁移;P3 其余(P3-5/6/7/9/10/11/12)按闲置带宽排。

---

## 四、附注

### 4.1 未经对抗复核的发现(落地前需先核实证据)

以下 medium/low 条目**未经对抗复核**,本计划照录审计原文,动手前应先自行验证 file:line 证据仍成立:
P1-7(健康检查)、P2-8(upload)、P2-9(500 回显)、P2-10(收口策略部分)、P2-11(send_code)、P2-12(摘要串行)、P2-13(long_memory)、P2-14(向量降级)、P2-15(自动开场)、P2-16(me 吞错)、P2-17(双源漂移)、P2-18(迁移基线)、P2-19(无 PK)、P2-20(memory_vec 孤儿)、P2-21(无 FK)、P2-22(resolve_token)、P2-24(死代码/预编译)、P2-25(优雅停机)、P2-26(DB 池)、P2-27(列表分页),以及 **P3 全部条目**。

另注:带 ✅复核 的 medium 中,P1-3/P1-5/P1-6/P2-1/P2-2 等多条系由原 critical/high **降级**而来,复核结论里对部分子主张(如多实例分裂、半径 100%)已做了收窄,实施时以复核后的口径为准。

### 4.2 触碰引擎核心的改动(记忆/状态机/召回/story 引擎)

按团队规约,以下改动**须主理人(Gengyue)压测通过后方可合 main**:

| 改动 | 触碰面 |
|------|--------|
| P0-3 回合并发锁 | story.py 回合 load→save 状态机主路径 |
| P1-5 chat 历史落库 | chat 记忆链路、memory.add_turn 行为变化 |
| P1-6 reroll 瘦快照 | story.py 回滚机制、落盘格式 |
| P2-1 turns 拆表 | storage/story 落盘路径 |
| P2-6 服务端权威卡组(含 P3-8) | story_turn 入参与 artifacts 还原链路 |
| P2-12 摘要异步化 | 滚动摘要时序(摘要新鲜度晚一回合) |
| P2-13 long_memory compaction | 长期记忆写入/裁剪语义 |
| P2-14 向量降级恢复 | 召回可用性逻辑 |
| P2-20 memory_vec 清理 / P3-3 删 hnsw / P3-6 向量批量写 / P3-9 embedding 拆分 | 召回数据与向量层 |

其余批次(RLS、闸门、async 化、日志、前端、DB 卫生)不触碰引擎核心,可按常规流程合入。