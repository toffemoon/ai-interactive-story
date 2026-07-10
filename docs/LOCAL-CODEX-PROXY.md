# Codex 本机反代模式

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

反代必须实现 `POST /chat/completions`,返回 OpenAI-compatible 的 `choices[0].message.content`。JSON 模式调用还会携带 `response_format: {"type":"json_object"}`。

连接助手会自动复用电脑上已有的 Codex 和 Node.js;缺失时自动安装官方 Codex CLI 和便携 Node.js。它还会注册当前用户的开机启动和 `aistory-codex://` 唤醒协议。OAuth token 由 Codex 自己保存和刷新,不会进入网页或 Render。

当前一键安装器面向 Windows 11。开发者手动启动和高级配置见 `tools/codex-local-proxy/README.md`。

## 浏览器要求

线上 HTTPS 页面请求本机 HTTP 服务时,本机反代必须正确处理 CORS 和浏览器 Private Network Access 预检:

- 允许线上 app 的 Origin。
- 允许 `POST`、`OPTIONS`、`Content-Type` 和可选的 `Authorization`。
- 浏览器预检带 `Access-Control-Request-Private-Network: true` 时,返回 `Access-Control-Allow-Private-Network: true`。
- 前端只接受 `localhost`、`127.0.0.1` 或 `::1`；反代不要暴露到局域网或公网。

## 安全边界

这个模式会把本轮完整模型上下文发到获授权用户的浏览器,包括角色隐藏信息、故事隐藏设定和 operator 注入。获授权用户也可以修改本机模型返回值。后端会校验回答所属步骤、结构化输出和会话归属,但无法阻止玩家查看自己浏览器收到的 prompt。

因此该能力只适合小范围可信用户,不应默认开放。
