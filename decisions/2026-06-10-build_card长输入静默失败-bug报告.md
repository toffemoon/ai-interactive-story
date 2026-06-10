---
date: 2026-06-10
updated: 2026-06-10
status: reported
owner: gengyue(引擎/build_card)
author: yufei(E2E 实测发现)
---

# Bug:build_card 长输入静默失败(空 reply + 骨架 draft + HTTP 200)

## 现象

`/api/build_card` 在**单条用户消息约 300 字以上**时:

- 返回 `reply=""`、`next_question=""`(前端渲染成一个空气泡)
- `draft` 是近乎空的骨架(stories 时 `title` 落成默认值「故事书」,premise/main_plot/endings 全空)
- **HTTP 200,无任何报错** —— 用户/前端完全无感,空壳卡能一路「完成」入库

## 复现(2026-06-10 Chrome E2E 建《灵魂摆渡人》时,稳定复现 3 次)

1. 创作 → 故事框架步,发一条 ~400 字的完整故事设定(前提+主线+三结局) → 空 reply + 骨架 draft
2. 换一条 ~300 字精简版 → 同样空 reply + 骨架
3. 直接 `fetch /api/build_card`(kind=stories,~100 字短消息)→ **完全正常**:reply/next_question 有内容,draft 带 title/premise/3 endings
4. 角色步也出现过一次(沈眠 ~250 字首轮空回复,draft 未填 name;第二条短消息后恢复)

绕法(当场验证可行):把长设定拆成 2~3 条短消息分轮喂,每轮 ~100 字。

## 推测

stories 的 draft schema 大,长输入 → 模型要回写「完整 draft + reply」→ 输出超 `max_tokens` 被截断 → `_loads_tolerant` 从残 JSON 里捞出部分字段(或全捞不出走默认),**没有触发重试也没有抛错**,静默回了骨架。

## 建议(引擎域,怎么修你定)

- 解析后做最小有效性检查:`reply` 与 `next_question` 同时为空、或 draft 关键字段(name/title/premise)全空 → 视为失败,走既有重试;重试耗尽返回 4xx/5xx 而不是 200
- 或:调大 build_card 的 `max_tokens` / 让模型只回 delta 不回全量 draft

## 关联(前端侧配套,yufei 域、另行处理,不在本报告范围)

- 空 reply 渲染空气泡 → 加兜底文案
- stories `canFinish` 只查 `title` 非空(默认「故事书」也放行)→ 拟加 premise 检查
