# AI 互动故事引擎 — API 参考(给 AI / 调用方)

纯后端服务(FastAPI)。所有能力通过 HTTP / JSON 暴露,任意客户端都能调。本文件是**给 AI / 程序调用方**的完整参考;人读的开局流程见 `docs/游玩流程.md`(若存在)。

- Base URL(本地):`http://127.0.0.1:8000`。生产:`https://ai-interactive-story.onrender.com`。
- 交互式文档:`GET /docs`(Swagger)。机器可读 schema:`GET /openapi.json`。
- 健康检查:`GET /api/health`(返回 db / embeddings 状态,DB 挂时 503;根路径 `/` 由前端静态页占用,别拿它判活)。

## 两种调用方式

1. **MCP(推荐给 agent)**:用 `ai-interactive-story` MCP server 暴露的工具(`identify` / `library_list` / `story_start` / `story_act` …)。它替你缓存卡组、自动续玩,最省事。安装见 `integrations/mcp/README.md`。
2. **原始 HTTP**:直接 `curl` / `httpx` 打下面的端点。MCP 工具就是这些端点的薄代理。

## 认证(生产必读)

生产部署 `AUTH_ENABLED=1`,**下面所有烧 LLM 的端点(identify* / build_card / chat / upload)与卡库/预设的写操作都要求先登录**,匿名调用返回 401。本地 dev 默认 `AUTH_ENABLED=0`,可裸调。

- 拿 token:`POST /api/auth/register`(需邮箱验证码,见下)或 `POST /api/auth/login` body `{"identifier","password"}` → `{"token","user"}`。
- 带 token:每个请求加 header `Authorization: Bearer <token>`(或 `X-Auth-Token: <token>`)。token 有效期 60 天,`POST /api/auth/logout` 使其立即失效。
- 邮箱验证码:`POST /api/auth/email/send_code` body `{"email","purpose":"register|reset"}`。6 位数字、10 分钟有效、单邮箱 60s 重发冷却、单码 5 次尝试上限。生产不回码(走邮件);dev 开 `AUTH_DEV_OTP=1` 才在响应里回 `dev_code`。
- 找回密码:`POST /api/auth/reset_password` body `{"email","code","new_password"}`(purpose=reset 的验证码)。
- 当前用户:`GET /api/auth/me` → `{"user","auth_enabled"}`。
- **story_turn / story_turn_stream / reroll 不套登录闸**,靠会话归属校验;但仍受成本护栏(per-IP 限流 + 全局每日熔断)约束。

> `story_turn` 系走会话归属而非登录墙,是过渡期设计;其余烧钱端点 AUTH 开时一律要 token。凭证只在 `.env`(LLM key / DB 串)服务端读,调用方不接触。

## 核心概念

| 概念 | 说明 |
|---|---|
| 四类卡 | 角色卡 `characters`(NPC)、玩家卡 `players`(主角)、世界书 `worlds`(设定)、故事书 `stories`(剧情) |
| 卡库 library | 建好/上传的卡集中存放,按 kind 分类 |
| 预设 preset | 配好的一组卡(角色+世界+故事+玩家+mode),用于一键开局 |
| 会话 session | 一局游戏。`session_id` 由**调用方生成**(任意唯一串),贯穿整局 |
| 回合 turn | 一次「玩家输入 → 叙事 + 角色发言 + 选项 + 状态更新」 |
| mode | `standard`(近期原文+滚动摘要)/ `deep`(长对话自动向量召回) |

## 端点总览

| 方法 | 路径 | 用途 | 需登录* |
|---|---|---|---|
| GET | `/api/health` | 判活(db/embeddings 状态) | 否 |
| POST | `/api/identify` | 散文 → 角色卡(Card V2),入库 | 是 |
| POST | `/api/identify_world` | 散文 → 世界书,入库 | 是 |
| POST | `/api/identify_story` | 散文 → 故事书(多结局/时间线/事件),入库 | 是 |
| POST | `/api/identify_player` | 散文 → 玩家卡,入库 | 是 |
| POST | `/api/identify_auto` | 自动判类型 → 路由到对应解析 → 入库 | 是 |
| POST | `/api/build_card` | 多轮对话式建卡(无状态,客户端带 messages+draft) | 是 |
| POST | `/api/upload?filename=` | 上传 `.txt/.md/.docx` → 纯文本(≤2MB) | 是 |
| GET | `/api/library/{kind}` | 列出某类卡(characters/worlds/stories/players) | 读否/写是 |
| POST | `/api/library/save` | 存一张卡进库 | 是 |
| DELETE | `/api/library/{kind}/{name}` | 删库中一张卡 | 是 |
| GET | `/api/presets` | 列出预设 | 读否/写是 |
| POST | `/api/presets` | 存预设 | 是 |
| DELETE | `/api/presets/{name}` | 删预设 | 是 |
| POST | `/api/story_turn` | 一回合(非流式) | 会话归属 |
| POST | `/api/story_turn_stream` | 一回合(流式 SSE) | 会话归属 |
| POST | `/api/reroll` | 重新生成上一回合 | 会话归属 |
| POST | `/api/undo_last` | 撤销上一回合(不重跑) | 会话归属 |
| GET | `/api/session/{id}` | 查看/续玩会话 | 会话归属 |
| GET | `/api/session/{id}/tail` | 拉流式回合的实时增量 | 会话归属 |
| DELETE | `/api/session/{id}` | 删存档 | 会话归属 |
| POST | `/api/chat` | 单角色直聊(不走故事引擎) | 是 |
| POST | `/api/auth/*` | 注册/登录/登出/验证码/找回密码/me(见上「认证」节) | — |
| GET | `/api/my/sessions` | 当前用户的存档列表 | 是 |

\* `AUTH_ENABLED=1`(生产)时生效;本地 dev 默认关闭全放行。「会话归属」= 不套登录墙、按 session 所有权校验(见「认证」节)。`/api/local_proxy/*`(玩家自带 Codex 本机)需 superadmin 逐账户授权,普通调用方用不到,此处从略。

## 关键请求/响应

### 识别
`POST /api/identify_auto` body `{"text": "...", "kind"?: "character|world|story|player"}`
→ `{"kind","confidence","reason","data": <对应卡对象>}`。`kind` 显式给则强制改判。

四个专用端点 body 是 `{"text": "...", "hint"?: "..."}`(`hint` 可选,给解析一点额外指向),返回对应卡对象本身。

`POST /api/build_card` body `{"messages":[...], "draft"?:{...}, "kind"?, "seed"?, "phase"?, "threshold"?, "refs"?}`(除对话历史 `messages` 与当前草稿 `draft` 外,`kind` 指定卡种、`refs` 带入已有素材卡)。

### 回合(核心)
`POST /api/story_turn` body:
```json
{
  "session_id": "sess-001",
  "characters": [<CharacterCard>, ...],   // 必填,全部参与本轮(上限已解除,支持群像剧)
  "world":  <WorldBook|null>,
  "story":  <StoryBook|null>,
  "player": <PlayerCard|null>,
  "mode": "standard",
  "user": "我走上前问她冥河之水的来历",   // 自由输入
  "selected_choice": ""                    // 或填上一回合某 choice.id;二选一
}
```
开场回合:`user` 和 `selected_choice` 都留空。**响应 `StoryTurn`**:
```json
{
  "narration": "本回合旁白",
  "messages": [{"character_id","name","text"}],
  "choices":  [{"id","label","intent","description"}],   // intent: ask|act|move|observe|custom
  "state_update": { ... },        // 本回合对状态的增量
  "state": { ...RuntimeState... }, // 当前完整运行状态(场景/玩家/关系/时间线/事实边界/时钟)
  "triggered_events": ["event_id"],
  "memory_write": [{"kind","text","importance"}],
  "usage": {"prompt_tokens","completion_tokens","total_tokens","calls"},
  "reasoning": {"hard_violation","world_counter","ooc_risk","note"}
}
```
> 引擎内部异常时,该端点仍返回 HTTP 200 + 一个题材中性的「保底回合」,游戏不中断。

`POST /api/story_turn_stream`:请求体同上,响应 `text/event-stream`,每行 `data: {json}`,事件 `type`:`delta`(叙事 token 块,从累积串里实时抽 narration)/ `done`(权威完整 StoryTurn)/ `error`(保底回合)。

`POST /api/reroll` body `{"session_id": "..."}` → 回滚上一回合后用相同输入重跑,返回新 StoryTurn。

### 历史由后端维护
回合循环里**不用回传历史**,只传当轮输入 + 卡组。`GET /api/session/{id}` 返回 `{session_id, messages, state, turns, usage_total, ...}`,可用于续玩还原或状态面板。

## 数据形态(简表)

- **CharacterCard**:`{spec:"chara_card_v2", spec_version:"2.0", data:{name, character_id, description, personality, scenario, first_mes, mes_example, speech_rules[], tags[]}}`
- **WorldBook**:`{name, entries:[{keys[], content, comment, source, truth_status, visibility, priority}]}`(keys 命中才注入,省 token)
- **StoryBook**:`{title, premise, timeline[], main_plot[], events[], freedom_rules[], endings[], clock_start, pacing[], character_boundaries[], needs_confirm[]}`
- **PlayerCard**:`{name, role, background, goals[], abilities[], constraints[], known_facts[]}`

## 最小可玩序列

```
1. POST /api/identify           设定文字 → 角色卡(已入库)
2. (按需) 再 identify world/story/player
3. 自己生成 session_id
4. POST /api/story_turn  user="" → 开场 + choices
5. POST /api/story_turn  user=玩家行动 或 selected_choice=某 choice.id → 下一回合
6. 重复 5;不满意 POST /api/reroll;查看 GET /api/session/{id}
```

## 注意

- **每回合都要带卡组**:`story_turn` 是无状态拿卡的——历史在后端,但 characters/world/story/player 每回合都要传。用 MCP 的 `story_start`/`story_act` 可免去重传(它替你缓存)。
- **延迟**:回合 + 识别都走 LLM,单次几十秒正常;客户端超时给到 ≥120s。
- **DB**:连 Supabase Postgres,免费实例闲置会被 pause 导致连接卡住;启动/查询卡住先怀疑这个。
- **凭证**:`.env` 有 LLM key + DB 串,服务端读,调用方不接触。
