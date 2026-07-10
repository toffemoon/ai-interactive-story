---
date: 2026-07-10
updated: 2026-07-10
status: accepted
---

# 受控开放浏览器本机 Codex 反代

## 背景

线上玩家默认使用 Render 后端的 DeepSeek。主理人决定增加一种可选模式:特定用户可以使用自己电脑上的 Codex/OpenAI-compatible 反代,玩家不需要另行部署整套 app 或 Render。

## 决定

采用浏览器本机调用方案:

- operator 以账户白名单控制能力,默认关闭;仅 `SUPERADMIN_EMAIL=gengyue081@gmail.com` 对应账户可授权或撤销。该账户固定拥有能力且不可撤销,数据库角色不能产生第二个 superadmin。
- endpoint、model 存在玩家浏览器;可选 API Key 只存在 sessionStorage,不上传中央后端。
- 中央后端继续负责 prompt 编排、记忆、状态、校验和存档。
- 一次故事回合拆成可续跑的多步流程。后端遇到 LLM 调用时返回结构化请求,浏览器调用本机反代后回传回答,后端从同一会话快照重放并继续。
- 每步回答绑定请求哈希;会话快照或输入变化后,旧回答不能继续使用。
- 本机模式下所有 LLM 调用都走玩家反代,不静默回落 DeepSeek。
- 重生成使用同一流程;撤回仍是零 LLM 的服务端操作。

## 影响

- 玩家只需运行本机 OpenAI-compatible 反代,中央 Render 服务保持不变。
- 浏览器会看到完整模型上下文,包括隐藏卡内容和 operator 注入;因此能力只给可信用户。
- 本机反代必须支持 CORS、Private Network Access 预检和 `/chat/completions`。
- 玩家可控制模型输出,所以该模式不适用于有对抗性或排名价值的公开玩法。
