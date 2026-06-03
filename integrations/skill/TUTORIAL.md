# Skill 使用教程 —— 用 AI 驱动互动故事引擎

这份教程教你怎么让一个 AI / agent(Claude Code、Cowork、Claude Desktop,或你自己的程序)直接玩、测、或建内容给这个互动故事引擎。配套文件:`SKILL.md`(给 agent 看的行为指南)、`../mcp/`(MCP server)、`../../docs/AI-API.md`(完整 API 参考)。

整条链路是这样的:AI 不直接碰数据库或 LLM,它调一层工具(MCP)或 HTTP,那层再去打后端 API,后端才连 DeepSeek + Supabase。所以你只要把后端跑起来 + 让 AI 拿到工具,就能玩。

## 前置:把后端跑起来

引擎是纯后端 FastAPI,默认在 `http://127.0.0.1:8000`。

```bash
.venv/Scripts/python -m uvicorn src.api:app --app-dir . --host 127.0.0.1 --port 8000
```

判活力:浏览器或 curl 打 `http://127.0.0.1:8000/openapi.json`,返回一坨 JSON(200)就是活着。`/docs` 是给人点的 Swagger。

## 一、装 + 注册 MCP(推荐给 agent 的方式)

先把 MCP 依赖装进同一个 venv:

```bash
.venv/Scripts/python -m pip install -r integrations/mcp/requirements.txt
```

自测一遍(后端要跑着):

```bash
.venv/Scripts/python integrations/mcp/_test_mcp.py
```

看到 `OK ✅ MCP 工具层端到端跑通` 就对了。

然后注册给 MCP 客户端。server 走 stdio,客户端会以子进程方式启动它。

- **Claude Code(CLI)**:
  ```bash
  claude mcp add ai-interactive-story -- \
    C:/Users/Administrator/Desktop/ai-interactive-story/.venv/Scripts/python.exe \
    C:/Users/Administrator/Desktop/ai-interactive-story/integrations/mcp/server.py
  ```
- **Claude Desktop / Cowork**:把下面塞进它的 MCP 配置(路径换成你机器的):
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

重启客户端,就能看到 `identify` / `library_list` / `story_start` / `story_act` 等工具。

## 二、装 Skill

Skill 是给 agent 的"怎么用引擎"的指南(何时用、走哪条流程、怎么读一个回合)。

- **Claude Code**:把 `integrations/skill/SKILL.md` 放到 `~/.claude/skills/ai-interactive-story/SKILL.md`(或项目 `.claude/skills/` 下),Claude 会按它的 `description` 在合适时机自动调用。
- 没装 skill 也能用——直接让 AI 读 `docs/AI-API.md` 也行。skill 只是让它在"用户想玩故事"时自动知道该怎么做。

## 三、跑通第一局(用 MCP 工具)

下面是一个 agent 该走的典型流程,括号里是它实际调的工具。

**1. 看有没有现成预设**:`preset_list()` → 返回 `[{name, data}]`。有就跳到一键开局;没有就用库里的卡。

**2a. 用预设一键开局**:
```
story_start_from_preset(session_id="sess-1", preset_name="翁法罗斯的黄昏")
```
**2b. 或用库里的卡开局**:先 `library_list("characters")` 挑一张,拿它的 `data`(完整卡),再:
```
story_start(session_id="sess-1", characters=[<那张卡的 data>])
```
> `session_id` 你自己生成一个唯一串,整局复用。`story_start` 会把卡组缓存起来,之后不用再传。

**3. 读开场回合**。返回的结构:`narration`(旁白)、`messages`(角色发言 `{name,text}`)、`choices`(候选行动 `{id,label,...}`)、`state`(场景/关系/时钟等)。把 narration + 角色话 + 选项 label 讲给用户。

**4. 推进**。用户选了某个选项,或自由说一句:
```
story_act(session_id="sess-1", selected_choice="c2")     # 选项
story_act(session_id="sess-1", user="我走上前,问她冥河之水的来历")   # 自由输入
```
每次回新回合,回到第 3 步,循环。

**5. 不满意上一回合** → `reroll(session_id="sess-1")`。**看状态/续玩** → `session_get(session_id="sess-1")`。**玩完删档** → `session_delete(...)`。

一回合走 LLM,几十秒正常,别急着重试。

## 四、从一段设定散文建卡再玩

用户贴了一段人物/世界设定:

```
identify(text="姓名:遐蝶。冥河的女儿,死亡的侍女,沉静克制……", kind="auto")
```
`kind="auto"` 让 AI 判类型并自动入库,返回 `{kind, confidence, data}`。想慢慢聊出来用 `build_card(...)` 多轮。建够卡(至少 1 张角色)后,走第三节开局。可选 `preset_save(...)` 打包成预设方便复用。

## 五、完全不用 MCP,纯 curl

最小三步:

```bash
# 1. 散文 → 角色卡(已入库)
curl -s -X POST http://127.0.0.1:8000/api/identify \
  -H "Content-Type: application/json" -d '{"text":"一个冷静的剑客,门派被灭后下山复仇"}'

# 2. 开场(characters 填上一步返回的完整卡对象;user 留空)
curl -s -X POST http://127.0.0.1:8000/api/story_turn \
  -H "Content-Type: application/json" \
  -d '{"session_id":"sess-1","characters":[<完整卡>],"user":"","selected_choice":""}'

# 3. 推进(注意:不用 MCP 时,每回合都要再带一遍 characters)
curl -s -X POST http://127.0.0.1:8000/api/story_turn \
  -H "Content-Type: application/json" \
  -d '{"session_id":"sess-1","characters":[<完整卡>],"user":"我走上前打招呼"}'
```

完整端点 + 数据形态见 `docs/AI-API.md`。

## 常见问题

- **连不上 / curl 报错**:后端没起,跑前置那条 uvicorn。
- **开局或识别卡住几十秒后报错**:多半是 Supabase 免费实例闲置被 pause,去 dashboard 唤醒一下。
- **回合很慢**:正常,走 LLM。客户端超时给到 ≥120s(MCP 默认 180s)。
- **MCP 重启后 story_act 还认得这局吗**:认得。它会从后端已落盘的 artifacts 自动恢复卡组,接着玩。
- **中文/emoji 在 Windows 控制台乱码**:那是终端 GBK 编码问题,数据本身没事;脚本里 `PYTHONUTF8=1` 或 `sys.stdout.reconfigure(encoding="utf-8")` 即可。

## 参考

- `SKILL.md` —— 给 agent 的行为指南
- `../mcp/README.md` —— MCP server 细节 + 工具一览
- `../../docs/AI-API.md` —— 完整 API 参考(端点 / 数据形态 / 流程)
