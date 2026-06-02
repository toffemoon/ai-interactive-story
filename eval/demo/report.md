# 评测报告 · judge-demo

- fixture: `mistport` · mode: `judge-demo` · persona: `authored` · adapter: `deepseek(模拟)+claude-judge`
- 回合数: 8
- **加权总分: 4.397** / 5

## 各维度

| 维度 | 类型 | 粒度 | 权重 | 均分 | 最低 | n | 通过率 | 问题数 |
|------|------|------|------|------|------|---|--------|--------|
| output_structure (输出结构完整性) | structural | turn | 1.0 | 5 | 5 | 8 | 1.0 | 0 |
| state_consistency (状态内部一致性) | structural | turn | 0.8 | 5 | 5 | 8 | 1.0 | 0 |
| time_progression (世界时钟推进合理性) | structural | turn | 0.6 | 5 | 5 | 8 | 1.0 | 0 |
| repetition_detection (反重复(原地打转检测)) | structural | session | 0.8 | 5 | 5 | 1 | 1.0 | 0 |
| canon_fidelity (Canon 忠实度) | judge | turn | 1.0 | 3.625 | 1 | 8 | — | 4 |
| character_voice (角色口吻一致性) | judge | turn | 0.9 | 4.125 | 2 | 8 | — | 3 |
| player_agency (玩家主体性) | judge | turn | 0.8 | 5 | 5 | 8 | — | 0 |
| narrative_progression (叙事推进度) | judge | session | 1.0 | 3 | 3 | 1 | — | 2 |

## 引擎用量(生成侧)
- 总 token: **38685** · LLM 调用: 8 · 回合: 8

## 回归检测
- judge 演示(手写对局,非真实 DeepSeek 生成)

## 抽样问题

**canon_fidelity** (4 条):
- 无忆珠凭空唤回玩家记忆,违背 RULE-2 + 沈雾硬上限
- 隐藏设定被提前说破
- 阿青说出其按 canon 不该知道的高层机密
- 引擎认可玩家'记得已卖出记忆',违背 RULE-1

**character_voice** (3 条):
- 沈雾认忆珠不认人情的人设被'免费施恩'破坏
- 阿青知识越过其 canon 边界
- 叙事旁白默认玩家记得为真

**narrative_progression** (2 条):
- 第3轮免费归还记忆后,核心追寻已实质完成,但故事仍按未完成推进——主线自相矛盾
- 第6轮玩家'记得'与开局失忆前提冲突,削弱整体因果
