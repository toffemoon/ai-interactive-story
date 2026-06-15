---
type: decisions-index
project: ai-interactive-story
updated: 2026-06-10
---

# decisions/ — 本 repo 工程决策

这里放 **ai-interactive-story 引擎自己的工程决策**（架构 / 技术选型 / 模块边界）。一个决策一个文件，`YYYY-MM-DD-<slug>.md`，只增不改，推翻要 supersede。

## 两层决策

| 类型 | 放哪 |
|---|---|
| 引擎工程决策（记忆用啥 / 流式协议 / prompt 结构 / 模块拆分） | **本目录** |
| YoRHa-A2 战略决策（这引擎跟项目的关系 / 要不要成为 conversion-site 实现 / 要不要拍短视频） | **父 repo** `~/Desktop/yorha-a2-team/decisions/` |

判断不准 → 写父 repo（团队可见优先）。

## 格式

frontmatter `date` / `updated` / `status`（默认 `active`）。正文：决策本身 + Why + 影响。推翻旧决策 → 新建文件 + 旧的 `status: superseded` + `superseded-by`。

## 跟父项目的关系

本 repo 是 YoRHa-A2 卫星项目。挂载关系的权威定义在父 repo `~/Desktop/yorha-a2-team/decisions/2026-05-31-mount-ai-interactive-story.md`。本目录只管引擎自己的工程决策。
