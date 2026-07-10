# Codex 本机桥接器

这个桥接器把当前电脑已登录的 Codex 转成 app 可调用的 OpenAI-compatible 接口。它只监听 `127.0.0.1`,不会暴露到局域网或公网。

## 使用

先确认 Codex 桌面端已经登录,然后在项目根目录运行:

```powershell
.\tools\codex-local-proxy\manage.ps1 start
```

app 中填写:

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
