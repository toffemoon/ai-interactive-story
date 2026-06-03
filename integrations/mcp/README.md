# ai-interactive-story MCP server

把引擎的纯后端 HTTP API 包装成 MCP 工具,任何 MCP 客户端都能直接驱动引擎(识别 / 建卡 / 卡库 / 预设 / 开局 / 回合 / 续玩 / 重 roll)。

## 前置

1. **后端在跑**:`uv run uvicorn src.api:app --port 8000`(或 `.venv/Scripts/python -m uvicorn src.api:app --app-dir . --port 8000`)。
2. **装 MCP 依赖**(进同一个 venv):
   ```bash
   .venv/Scripts/python -m pip install -r integrations/mcp/requirements.txt
   ```

## 自测

后端跑着时:
```bash
.venv/Scripts/python integrations/mcp/_test_mcp.py
```
会验证:工具注册数 + 识别 + 卡库 + 开局 + 推进回合 + 从 artifacts 恢复续玩。

## 注册到 MCP 客户端

server 走 **stdio**,客户端以子进程方式启动它。把下面加进客户端的 MCP 配置(路径换成你机器的绝对路径;`STORY_API_BASE` 默认 `http://127.0.0.1:8000`):

```json
{
  "mcpServers": {
    "ai-interactive-story": {
      "command": "C:/Users/Administrator/Desktop/ai-interactive-story/.venv/Scripts/python.exe",
      "args": ["C:/Users/Administrator/Desktop/ai-interactive-story/integrations/mcp/server.py"],
      "env": { "STORY_API_BASE": "http://127.0.0.1:8000" }
    }
  }
}
```

- **Claude Code(CLI)**:`claude mcp add ai-interactive-story -- <python> <server.py>`,或写进项目 `.mcp.json`。
- **Claude Desktop / Cowork**:加进各自的 MCP 配置文件(同上 JSON 结构)。

## 工具一览

| 工具 | 用途 |
|---|---|
| `identify(text, kind="auto")` | 散文 → 卡(auto/character/world/story/player),入库 |
| `build_card(kind, messages, draft?, seed?)` | 多轮对话式建卡 |
| `library_list/save/delete` | 卡库 CRUD |
| `preset_list/save` | 预设 |
| `story_start(session_id, characters, world?, story?, player?, mode?)` | 开局 + 缓存卡组 |
| `story_start_from_preset(session_id, preset_name, mode?)` | 用预设一键开局 |
| `story_act(session_id, user?, selected_choice?)` | 推进一回合(免传卡) |
| `story_turn_raw(...)` | 忠实原始回合(每次自带全卡组) |
| `reroll(session_id)` | 重 roll 上一回合 |
| `session_get/delete(session_id)` | 看档 / 删档 |
| `chat(card, session_id, user, world?)` | 单角色直聊 |

## 设计要点

- 本 server 只是后端 API 的**薄代理**,不复制业务逻辑,后端是唯一真相源。
- 额外做**会话卡组缓存**:HTTP API 每回合要重传整套卡,对 AI 很笨重;`story_start` 传一次,之后 `story_act` 只发输入。MCP 进程重启后会从后端已落盘的 `artifacts` 自动恢复卡组,续玩不断。
