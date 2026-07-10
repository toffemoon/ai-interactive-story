# 数据库连接池防僵死硬化

> 日期:2026-07-11
> 范围:`src/db.py`、`src/api.py`、`.env.example`、`requirements*.txt`、`tests/test_db_health.py`。
> Linear:待建 issue(本批与 [YOR-211](https://linear.app/yorha/issue/YOR-211) 同 PR 合入,见 2026-06-19 合批放宽)。

## 先看结论

现场曾出现 **10/10 连接全部长期 idle in transaction** 的故障:池被占满后所有请求排队直至超时,服务表现为整体僵死,只能重启。本批给连接池加了四层护栏,让同类故障从"整站僵死"降级为"单请求快速失败 + 可观测 + 自愈"。不改 Supabase 全局设置,不动业务 SQL。

## 四层护栏

**1. session 级超时(只作用于本服务的连接,不碰 Supabase role/global)。** 每个新连接经 `_configure` 设置 `idle_in_transaction_session_timeout=60s`、`statement_timeout=30s`、`lock_timeout=5s`、`application_name`。任何事务挂住 60 秒会被 Postgres 主动杀掉,连接回收,池不再被无限占用。SET 后立即 commit,保证连接以 IDLE 状态入池。

**2. 池参数全部 env 化 + 借出探活。** `min/max`、借出超时(`DB_POOL_TIMEOUT_SECONDS=5`)、排队上限(`DB_POOL_MAX_WAITING=20`)、连接最长寿命(30 分钟)与最大空闲(120 秒)、后台重连窗口(30 秒)全部可配,非法值(非数字/越界/min>max)启动即报错。每次借出先跑 `check_connection` 探活,坏连接不会发给业务代码。

**3. TCP 层兜底(针对 Windows 睡眠/网络切换后的半开连接)。** `connect_timeout=5s` + keepalive(idle 30s/interval 10s/count 3)+ `tcp_user_timeout=30s`,半开 TCP 在秒级被识别丢弃,而不是挂到内核默认的十几分钟。

**4. API 层统一降级。** `PoolTimeout` / `TooManyRequests` / `OperationalError` / `IdleInTransactionSessionTimeout` 四类异常统一转成 **503 + Retry-After: 1**,正文不含 DSN 或驱动原文;日志只记异常类型 + 非敏感池指标。`/api/health` 不再裸借连接:改用 `db.ping(timeout=1.0)`(池满 1 秒内返回 degraded 而不是挂 5 秒),并新增 `db_pool` 字段暴露 `pool_size/available/waiting` 等非敏感指标,Render 健康检查与人工排查都能直接看到池水位。

## 生命周期修复

- 启动 `pool.wait()` 超时会先把半开的池关掉再抛错,全局 `_pool` 保持 `None`,同进程修复环境后可重试初始化(此前会留下坏池)。
- `close_pool()` 带超时,且 `finally` 置 `None`——即使驱动关闭异常,坏池也不会继续暴露给后续请求。
- 后台重连持续失败时经 `reconnect_failed` 回调打 CRITICAL 日志(带池指标),不再静默。

## 依赖与配置

- `psycopg-pool` 固定 `>=3.2.8,<4`(依赖其 `check_connection` 与重连回调行为,防 4.x 破坏性升级)。
- `.env.example` 新增 `DB_POOL_*` / `DB_IDLE_TX_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` / `DB_LOCK_TIMEOUT_MS` / `DB_CONNECT_TIMEOUT_SECONDS` / `DB_KEEPALIVE_*` / `DB_TCP_USER_TIMEOUT_MS` / `DB_APPLICATION_NAME` 全套注释。**全部有代码内默认值,Render 无需新增任何 env 即可生效**;要调优再加。

## 验证

- 新增 `tests/test_db_health.py`:env 校验(非法值报错)、ping 快速失败、503 转换、池指标脱敏。`pytest -q` 全套 **25 passed**。
- 回退方式:所有行为由 env 默认值驱动,如某超时误伤长任务,调大对应 `DB_*` 值即可,无需回滚代码;整批回滚也不涉及数据库结构(零 DDL)。

## 部署注意

- merge 后 Render 需**手动触发部署**(该服务 Auto-Deploy 已关,service `srv-d8fq43p9rddc73ap5gh0`)。
- 上线后看 `/api/health` 的 `db_pool` 字段确认池水位正常(`pool_available` > 0、`requests_waiting` = 0)。
