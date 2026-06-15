---
date: 2026-06-07
type: design
status: 实施中
owner: Gengyue
---

# 后台导演控制台 — 完整功能设计

> **⚠️ 更新 2026-06-10:** 鉴权已从单一 `OPERATOR_TOKEN` 令牌闸迁移到基于账户的**角色鉴权**(`require_role`,super/admin;见 `src/api.py` + `docs/2026-06-09-账户系统-给Yufei变更说明.md`)。下文出现的 `OPERATOR_TOKEN` 是当初设计记录,**实际实现以角色鉴权为准**(故本文留作历史,正文不重写)。

运营者(导演)在后台对**正在玩的某一局**实时施加影响。一个 token 闸(`OPERATOR_TOKEN`),无账号系统;玩家拿不到 token、前端无入口,只有开发者能用。

## 一、注入模式(mode)—— 内容是什么 / 怎么呈现给玩家

| 模式 | 干什么 | 走不走 AI | 给玩家看到的 |
|---|---|---|---|
| **导演模式 `director`**(默认) | 幕后**指令**,AI 把意图**织进剧情**,不原样念 | 走 AI 生成 | 一个自然的新回合(体现你的意图) |
| **直接台词 `direct`**(需选角色) | 让**指定角色**一字不差说出你的原文 | **不走 AI**,引擎直接插 | 该角色的台词气泡 = 你的原文 |
| **直接旁白 `narration`** | 把你的原文作为**旁白/环境**直接写进剧情 | **不走 AI**,引擎直接插 | 一行旁白 = 你的原文 |

> `direct` + `narration` 合起来 = 你说的"**直接发送模式**":你的字**原样**出现在剧情里,不经 AI 解释。
> 用例:`director`="让长夜月起疑" / `direct`(长夜月)="你以为你能逃出这栋楼?" / `narration`="天台的灯毫无预兆地全灭了。"

## 二、生效时机(timing)—— 什么时候作用(仅 `director` 模式有意义)

| 时机 | 行为 |
|---|---|
| **立即 `now`** | 马上跑一回合,AI 当场采纳;玩家端 ~3.5s 自动看到 |
| **下回合 `next`**(默认) | 进队列,玩家**下次行动**时 AI 带上 |
| **持续 `sticky`** | **每回合都注入**,直到手动清空(用于"接下来全程让 X 保持警惕") |

> `direct` / `narration` 天生即时(引擎直接插一条),不需要时机选择。

## 三、目标角色(target)—— 给谁(仅 `direct` 台词模式)
选该局一个在场角色;没给 target 的 `direct` 自动退化为 `narration`(当旁白)。

## 四、队列与留痕
- **待生效队列**:看/删/清空(每条显示 模式·时机·目标·内容)。`director`+`next`/`sticky` 的进队列;`now`/`direct`/`narration` 不进队列(即时落地)。
- **留痕审计(operator_applied)**:每次**真正生效**的注入,记进它落地的那一回合记录(`turn.operator_applied=[{mode,target,content}]`),永久留痕。解决"消费即弃、事后查不到原文"。

## 五、控制台 UI(`/operator`)
- 左栏:session 列表(故事·玩家·最后一句·时间,已做)。
- 右栏:对话(玩家蓝气泡 / 角色白气泡 / 旁白),**导演注入用标签标出**:🎬 导演 / 🎤 直接台词(角色名) / 🌧 旁白。4s 自动刷新。
- 底部注入区:**模式下拉** + **目标角色下拉**(选 direct 时出现,从该局在场角色填) + **时机选择**(director 时) + 内容框 + 发送。

## 六、数据与端点
- 队列项:`{content, mode, target, sticky}`;发送附 `now`。
- `POST /api/operator/inject` {session_id, content, mode, target, sticky, now}:
  - `director` → 进队列(sticky 决定是否持续);`now=true` 立即跑一回合。
  - `direct`/`narration` → 引擎直接 append 一条回合(逐字、即时),返回该回合。
  - 两路都写 `operator_applied` 留痕。
- `GET/DELETE /api/operator/inject/{sid}`:看/清队列(已有)。
- `GET /api/operator/sessions` / `session/{id}`:列表/上下文(已有)。
- 玩家端 `GET /api/session/{id}/tail?after=N`:实时拉新回合(已有)→ 所有模式玩家都自动看到。

## 七、安全
全部 `/api/operator/*` 过 `OPERATOR_TOKEN` 闸(没设=503/404);`direct`/`narration` 是引擎直插、不调 LLM(零 token、即时);玩家端 tail 无 token(同 /api/session,只读自己这局)。
