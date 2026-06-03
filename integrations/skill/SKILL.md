---
name: ai-interactive-story
description: Drive the AI 互动故事引擎 (a pure-backend FastAPI engine) to play, test, or build content for AI interactive stories — multi-character / world / story / player cards turned into playable turns (narration + character lines + player choices + state). Use when the user wants to start/continue a story session, build or identify cards, manage presets, or smoke-test the engine. Prefers the `ai-interactive-story` MCP tools; falls back to HTTP curl against the backend.
---

# 驱动 AI 互动故事引擎

这个 skill 让你(Claude / agent)驱动一个纯后端互动故事引擎:把角色/世界/故事/玩家卡变成可玩的回合(叙事 + 角色发言 + 玩家选项 + 状态)。

## 何时用

用户想:玩一局 / 续玩、建卡或识别设定、配预设、或冒烟测引擎时。

## 前置

后端要在跑(默认 `http://127.0.0.1:8000`)。判活力:`GET /openapi.json` 返回 200。没在跑就提示用户启动:`uv run uvicorn src.api:app --port 8000`。

## 两条调用路径

- **有 `ai-interactive-story` MCP**(优先):直接用工具 `identify` / `library_list` / `preset_list` / `story_start` / `story_act` / `reroll` …。MCP 会替你缓存卡组、自动续玩。
- **没 MCP**:`curl` 打 `/api/*`(完整参考见 `docs/AI-API.md`)。

## 标准流程

### A. 直接玩(库里/预设里已有卡)
1. `preset_list()` 看有没有现成预设;有就 `story_start_from_preset(session_id, preset_name)`。
2. 没预设就 `library_list("characters")` 选角色卡,`story_start(session_id, [card, ...])`(可带 world/story/player)。
3. **回合循环**:读上一回合的 `narration` + `messages` + `choices` 讲给用户;用户决定后:
   - 选了某个选项 → `story_act(session_id, selected_choice="<choice.id>")`
   - 自由行动 → `story_act(session_id, user="<玩家这句话>")`
4. 不满意上一回合 → `reroll(session_id)`。看状态/续玩 → `session_get(session_id)`。

> `session_id` 你自己生成一个唯一串(如 `sess-<时间戳>` 或 UUID),整局复用。

### B. 先建卡再玩
- 用户贴了设定散文 → `identify(text, kind="auto")`(自动判类型并入库)。
- 想慢慢聊出来 → 多轮 `build_card(kind, messages, draft)`,`done=true` 后 `library_save`。
- 建够卡(至少 1 张角色)→ 走流程 A。可选 `preset_save` 打包成预设方便复用。

## 读一个回合

- `narration`:旁白,先展示。
- `messages[]`:角色发言 `{name, text}`。
- `choices[]`:候选行动 `{id, label, intent, description}`——把 label 列给用户;用户选哪个,就用那个 `id` 调 `story_act(selected_choice=id)`。
- `state`:运行状态(场景/玩家/关系分/事件时间线/故事内时钟)。要展示状态面板时读它。
- `mode`:长局想要更强的早期细节召回,开局时用 `mode="deep"`。

## 注意

- 回合走 LLM,几十秒正常,别急着重试。
- 用原始 HTTP 时**每回合都要带完整卡组**;用 MCP 的 `story_start`/`story_act` 则免传(已缓存)。
- 引擎异常时回合端点仍返回一个「保底回合」(HTTP 200),游戏不中断——照常往下走即可。
- 完整端点/数据形态:`docs/AI-API.md`。
