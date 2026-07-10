# Codex 本机桥接器

这个桥接器把当前电脑登录的 Codex 转成 app 可调用的 OpenAI-compatible 接口。它只监听 `127.0.0.1`,不会暴露到局域网或公网。

## 玩家安装

获授权用户直接在 app 的“我的 > 模型来源”点击“一键安装并连接”。下载的 `AIStory-Codex-Setup.cmd` 会自动:

1. 检测并复用现有 Node.js 与 Codex。
2. 缺失时校验并安装便携 Node.js 和官方 OpenAI Codex CLI。
3. 安装连接助手、注册开机启动并拉起 ChatGPT OAuth。
4. 登录完成后自动返回 app。

浏览器 OAuth 不经过 app 后端。账号 token 由 Codex app-server 自己保存和刷新。

## 接口与流式输出

`POST /v1/chat/completions` 同时支持 OpenAI-compatible 的非流式 JSON 和 `stream: true` SSE。SSE 正文使用 `choices[0].delta.content`,可通过 `stream_options: {"include_usage": true}` 在结束帧取得 usage,最后以 `data: [DONE]` 收尾。

连接助手从 Codex app-server 的 `item/agentMessage/delta` 读取最终回答,不转发 commentary。若当前 Codex 只给最终事件,会自动用 `item/completed` 的完整文本兜底。浏览器断开后会中断对应 Codex turn。`GET /health` 返回 `chat_completions_stream: true` 时表示这些能力可用。

## 开发者手动使用

先确认 Codex 桌面端已经登录,然后在项目根目录运行:

```powershell
.\tools\codex-local-proxy\manage.ps1 start
```

app 的高级设置默认值:

- API Base URL: `http://127.0.0.1:8765/v1`
- Model: `codex`
- API Key: 默认留空

管理命令:

```powershell
.\tools\codex-local-proxy\manage.ps1 status
.\tools\codex-local-proxy\manage.ps1 restart
.\tools\codex-local-proxy\manage.ps1 stop
```

日志位于 `data/codex-local-proxy/`,不会进入 git。

## 配置

配置统一放在项目根 `.env`:

```dotenv
CODEX_LOCAL_PROXY_PORT=8765
CODEX_LOCAL_PROXY_MODEL=
CODEX_LOCAL_PROXY_TOKEN=
CODEX_LOCAL_PROXY_ALLOWED_ORIGINS=https://ai-interactive-story.onrender.com
CODEX_LOCAL_PROXY_CODEX_BIN=
CODEX_LOCAL_PROXY_WORKSPACE=
```

模型留空时自动读取 `~/.codex/config.toml`。设置 token 后,app 的 API Key 必须填写同一值。

桥接器为每次请求创建临时只读线程,禁用插件、MCP、命令执行、浏览器、计算机控制和多 agent,并使用隔离工作目录。Codex 子进程只继承运行所需的系统变量,不会继承项目中的 DeepSeek、Supabase 等凭证。
