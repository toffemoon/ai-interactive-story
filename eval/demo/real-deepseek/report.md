# 评测报告 · real-deepseek

- fixture: `mistport` · mode: `real` · persona: `authored` · adapter: `deepseek`
- 回合数: 8
- **加权总分: 4.902** / 5

## 各维度

| 维度 | 类型 | 粒度 | 权重 | 均分 | 最低 | n | 通过率 | 问题数 |
|------|------|------|------|------|------|---|--------|--------|
| output_structure (输出结构完整性) | structural | turn | 1.0 | 5 | 5 | 8 | 1.0 | 0 |
| state_consistency (状态内部一致性) | structural | turn | 0.8 | 5 | 5 | 8 | 1.0 | 0 |
| time_progression (世界时钟推进合理性) | structural | turn | 0.6 | 5 | 5 | 8 | 1.0 | 0 |
| repetition_detection (反重复(原地打转检测)) | structural | session | 0.8 | 5 | 5 | 1 | 1.0 | 0 |
| canon_fidelity (Canon 忠实度) | judge | turn | 1.0 | 5 | 5 | 8 | — | 0 |
| character_voice (角色口吻一致性) | judge | turn | 0.9 | 4.25 | 4 | 8 | — | 6 |
| player_agency (玩家主体性) | judge | turn | 0.8 | 5 | 5 | 8 | — | 0 |
| narrative_progression (叙事推进度) | judge | session | 1.0 | 5 | 5 | 1 | — | 0 |

## 引擎用量(生成侧)
- 总 token: **49535** · LLM 调用: 8 · 回合: 8

## 回归检测
- 基线 run: `real-deepseek-001`
- 无显著变化(所有维度 |Δ| < 0.5)

## 抽样问题

**character_voice** (6 条):
- 沈雾台词偏长,违'话短'硬规则
- 沈雾台词偏长
- 沈雾台词偏长
- 沈雾台词偏长
- 沈雾台词偏长
- 沈雾台词偏长
