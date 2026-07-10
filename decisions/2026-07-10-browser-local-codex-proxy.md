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

### 自动连接补充

玩家侧采用 Windows 一键连接助手,不再要求普通用户手填 URL、模型名或启动命令:

- app 下载经过 SHA-256 清单校验的安装器。安装器优先复用现有 Node.js 和 Codex,缺失时从 Node.js 官网与 OpenAI 官方 npm 包安装便携版本。
- 连接助手仅监听 `127.0.0.1`,注册当前用户的开机启动与 `aistory-codex://` 唤醒协议。
- ChatGPT 登录由 Codex app-server 官方 OAuth 流程完成。token 由 Codex 保存和刷新,不进入浏览器存储、项目后端或 Render。
- app 只读取脱敏状态:是否已登录、认证模式、套餐类型和是否存在邮箱;不返回邮箱正文或任何 token。
- 前端统一请求模型别名 `codex`;未指定具体模型时使用用户 Codex 当前默认模型。
- 浏览器安全策略不允许网页直接执行下载文件,因此玩家仍需手动打开一次 `.cmd` 并确认一次 ChatGPT OAuth。这是当前最小人工步骤。

### SSE 补充

- 本机连接助手订阅 Codex app-server 的 `item/agentMessage/delta`,只转发最终回答阶段并过滤 commentary。
- `/v1/chat/completions` 支持 OpenAI-compatible SSE,包括增量正文、结束原因、可选 usage 和 `[DONE]`。
- 前端默认请求 SSE,但只把后端标记为 `kind=stream` 的主故事步骤显示给玩家;规划、记忆和修复步骤继续静默执行。
- 旧版连接助手明确返回 `stream_not_supported` 时,前端自动退回非流式请求,避免已安装用户因前端升级而中断。
- 客户端断开时连接助手中断对应 Codex turn;Codex 不提供 delta 时以 `item/completed` 完整文本兜底。

## 影响

- 玩家只需在 app 选择“Codex 本机”、运行一次安装器并确认 OAuth,不需要自行部署 Render 或配置反代参数。
- 浏览器会看到完整模型上下文,包括隐藏卡内容和 operator 注入;因此能力只给可信用户。
- 本机反代必须支持 CORS、Private Network Access 预检和 `/chat/completions`。
- 更新后的官方连接助手支持真实 SSE;已有安装继续兼容,重新运行安装器即可升级。
- 玩家可控制模型输出,所以该模式不适用于有对抗性或排名价值的公开玩法。

## 上线记录

- SSE 增强任务:[YOR-208](https://linear.app/yorha/issue/YOR-208/功能-为-codex-本机模式增加真实-sse-流式输出)。
- 受控本机反代主流程:PR #150、#151。
- OAuth 与一键安装:PR #152,merge commit `e5b102a23676e6840db95a6c024752a94a018795`。
- SSE 流式输出:PR #154,merge commit `8019f8b74973576a7559ab4735fab09b9d256a47`;Render deploy `dep-d98bm4e7r5hc73cr6qh0` 已为 `live`。
- 生产地址:`https://ai-interactive-story.onrender.com`,Render deploy `dep-d985n5favr4c738uq3i0` 已为 `live`。
- 验证:Python 18 tests、Node bridge 6 tests、Vite production build、线上 4 个安装文件哈希、真实生产安装、协议停止后重启、真实 Codex completion `PROD_INSTALL_OK`。
- SSE 实测:模型 `gpt-5.6-sol`,最终文本 `STREAM_LIVE_OK`,4 个内容分片,首字约 3.68 秒、总耗时约 3.83 秒。
- SSE 生产安装复验:Node bridge 9 tests、Python 18 tests、Vite production build;4 个线上安装文件哈希匹配,最终文本 `PROD_SSE_OK`,5 个内容分片,首字约 2.25 秒、总耗时约 2.43 秒。
