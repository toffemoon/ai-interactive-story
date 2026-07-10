# Codex 本机反代模式

> 状态:已于 2026-07-10 上线生产。当前自动安装面向 Windows 11。

## 这是什么

玩家继续使用线上 app 和中央后端,不需要自己部署 Render。被 operator 授权后,玩家可以把故事生成从官方 DeepSeek 切到自己电脑上的 OpenAI-compatible 反代。

故事状态、记忆、存档和输出校验仍由中央后端负责;所有 LLM 调用(主回合、摘要、JSON 修复、记忆抽取、重生成)都由玩家浏览器请求本机反代,不会回落到 Render 的 DeepSeek。

## Operator

1. 先应用迁移 `migrations/2026-07-10-local-proxy-entitlement.sql`。
2. 打开 `/operator`,进入“账户”。
3. 选择用户,点击“授权使用”或“撤销授权”。

除 `gengyue081@gmail.com` 固定开通且不可撤销外,其他账户默认关闭。只有这个由 `SUPERADMIN_EMAIL` 指定的账户能授权或撤销其他用户;数据库中的 `role=superadmin` 不产生该管理权限。

## 玩家

1. 在“我的 > 档案 > 模型来源”选择“Codex 本机”。
2. 点击“一键安装并连接”,打开浏览器下载的安装器。
3. 在打开的 ChatGPT 页面确认一次登录。完成后会自动回到 app 并启用 Codex。

正常情况下不需要填写 API Base URL、Model、API Key,也不需要打开终端。浏览器不能自动执行下载文件,所以首次仍需手动打开一次 `AIStory-Codex-Setup.cmd`。

反代必须实现 `POST /chat/completions`,返回 OpenAI-compatible 的 `choices[0].message.content`。JSON 模式调用还会携带 `response_format: {"type":"json_object"}`。

连接助手会自动复用电脑上已有的 Codex 和 Node.js;缺失时自动安装官方 Codex CLI 和便携 Node.js。它还会注册当前用户的开机启动和 `aistory-codex://` 唤醒协议。OAuth token 由 Codex 自己保存和刷新,不会进入网页或 Render。

当前一键安装器面向 Windows 11。开发者手动启动和高级配置见 `tools/codex-local-proxy/README.md`。

## 自动安装做了什么

1. 从生产站读取安装清单并校验 SHA-256。
2. 检测 Node.js 18+ 和 Codex;缺失时校验并安装官方版本。
3. 安装到 `%LOCALAPPDATA%\AIStoryCodexBridge`,启动只监听 `127.0.0.1:8765` 的桥接器。
4. 注册当前 Windows 用户的开机启动和 `aistory-codex://connect`。
5. 通过 Codex app-server 打开 ChatGPT OAuth;浏览器回调失败时自动退到设备码登录。
6. 登录成功后回到 app,模型来源自动切换为“Codex 本机”。

生产下载接口:

- `/downloads/codex-bridge/AIStory-Codex-Setup.cmd`
- `/downloads/codex-bridge/manifest.json`

本机状态接口只返回脱敏信息:

- `GET http://127.0.0.1:8765/health`
- `GET http://127.0.0.1:8765/auth/status`

不会返回邮箱正文、access token 或 refresh token。

## 浏览器要求

线上 HTTPS 页面请求本机 HTTP 服务时,本机反代必须正确处理 CORS 和浏览器 Private Network Access 预检:

- 允许线上 app 的 Origin。
- 允许 `POST`、`OPTIONS`、`Content-Type` 和可选的 `Authorization`。
- 浏览器预检带 `Access-Control-Request-Private-Network: true` 时,返回 `Access-Control-Allow-Private-Network: true`。
- 前端只接受 `localhost`、`127.0.0.1` 或 `::1`；反代不要暴露到局域网或公网。

## 安全边界

这个模式会把本轮完整模型上下文发到获授权用户的浏览器,包括角色隐藏信息、故事隐藏设定和 operator 注入。获授权用户也可以修改本机模型返回值。后端会校验回答所属步骤、结构化输出和会话归属,但无法阻止玩家查看自己浏览器收到的 prompt。

因此该能力只适合小范围可信用户,不应默认开放。

## 故障处理

- 页面显示“尚未连接”:先点击“启动已安装助手”,再点“重新检测”。
- 页面显示“等待 ChatGPT 登录”:点击“连接 ChatGPT”;浏览器回调不可用时改用设备码。
- 需要重新安装:再次运行一键安装器即可,已有 `bridge.env` 高级配置会保留。
- 日志目录:`%LOCALAPPDATA%\AIStoryCodexBridge\data`。

## 官方参考

- [Codex authentication](https://developers.openai.com/codex/auth/)
- [Codex app-server OAuth API](https://developers.openai.com/codex/app-server/)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
