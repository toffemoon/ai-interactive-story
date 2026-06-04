# -*- coding: utf-8 -*-
"""src/parsers.py 单元测试:vault 卡片模板格式 → 确定性解析 → 结构化 model。

零 LLM / 零 DB / 零 API。两种跑法:
  .venv/Scripts/python.exe tests/test_parsers.py     # 独立跑(对齐 repo 的 _validate_*.py 习惯),全过 exit 0
  pytest tests/test_parsers.py                        # 有 pytest 也能直接收
fixture 是「填好的卡」(非模板占位),覆盖每个解析器的关键字段 + 路由 + 向后兼容。
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import parsers as P  # noqa: E402

# ---------------- fixtures(填好的卡)----------------

CHARACTER = """---
type: 角色卡
ip: 测试世界
类别: 主要NPC
档位: 满配
召回关键词: [阿岩, 石心, 锻炉]
tags: [AI互动故事, 测试世界, 角色卡, 阿岩]
作者: 太妃月 / Toffeemoon
---

# 阿岩 角色卡

> 给 AI 扮演这个角色用。占位填完删。

## 0. 引擎摘要
- **一句话锚点**:把毕生执念当唯一标尺的孤高匠人
- **核心矛盾**(可选):想护住所有人,却越来越功利
- **外貌锚点**:满手老茧,左眼一道炉火烫的疤

| speech_rules | 内容 |
|---|---|
| 自称 | 老夫 |
| 称呼玩家 | 小娃娃 / 禁:亲昵称呼 |
| 口头禅 | 火候不到 |
| 禁用 | 不说软话 |

- **召回关键词**:阿岩, 石心, 锻炉

## 轻量档(默认)

### 身份(description)
石心十人之一,坐镇锻炉三十年。

### 性格(personality)
固执,认死理,刀子嘴豆腐心。

### 开场白(first_mes)
哼,又来一个嫌火候慢的。

### 知识边界(必填 · 防剧透防全知)
- **public(可知)**:锻炉的规矩, 石心十人的明面身份
- **hidden(藏 · 默认不注入)**:他亲手封印了炉底的东西

## 满配可展开

### 版本人格 / 状态轴(可选 · versioned)
- v1 平日:冷脸老匠
- v2 真相揭穿后:卸下伪装
"""

PLAYER = """---
type: 玩家卡
ip: 测试世界
可玩: 是
类别: 可玩角色
配套角色卡: 阿岩 角色卡
作者: 太妃月 / Toffeemoon
---

# 学徒（玩家卡）

> 玩家扮演学徒时的主角卡。

## 身份（role）
锻炉新来的学徒。

## 背景（background）
背井离乡来学锻造,身上没几个钱。

## 目标（goals）
- 学会锻一把像样的刀
- 弄清锻炉底下的怪声

## 能力 / 资源（abilities）
- 力气大
- 一把旧锤

## 限制 / 禁忌（constraints）
- 没拜师不能碰主炉

## 开局已知（known_facts）
- 阿岩是石心十人之一

## 开局不知道（unknown）
- 炉底封着东西
- 阿岩的真实身份

## 开局场景 / 时间锚点（opening,可选）
- 入门第一天清晨,锻炉门口
"""

WORLDBOOK = """---
type: 世界书
ip: 测试世界
母本: "测试世界 设定集"
作者: 太妃月 / Toffeemoon
---

# 测试世界 世界书

> 教学版 vs 上传版说明。

## 1. 单条目格式

```
## <条目标题>
- 关键词: <词1>, <词2>
- 来源: world
- 内容: <示例,不该被解析成真条目>
```

## 2. 条目（按来源分组）

### 世界与规则（world / rule）

## 测试世界
- 关键词: 测试世界, 这个世界
- 来源: world
- 可见性: public
- 内容: 一个靠锻炉之火维系的小世界。

## 炉火代价
- 关键词: 炉火, 代价
- 来源: rule
- 可见性: public
- 触发: 常驻
- 优先级: 9
- 硬canon: 是
- 内容: 动用炉火必付等价的身体灼伤,无人例外。

## 炉底真相
- 关键词: 炉底
- 来源: rule
- 可见性: hidden
- 内容: 炉底封着上一任守炉人的魂。
"""

SETTINGCARD = """---
type: 设定卡
ip: 测试世界
类别: 组织
母本: "测试世界 设定集"
档位: 轻量
召回关键词: [石心十人, 石心, 锻炉公会]
作者: 太妃月 / Toffeemoon
---

# 石心十人（设定卡 · 组织）

> 组织口径:石心十人,锻炉公会的十位掌炉。

## 0. 引擎摘要

- **一句话锚点**:把守世界炉火的十位匠人,既是守护也是枷锁
- **召回关键词**:石心十人, 石心, 锻炉公会
- **知识分层**:public:十人的明面身份;hidden:十人之一实为忆灵假冒
- **口吻 / 禁区**:庄重克制;不要写成轻松帮派

## 1. 概览

掌控世界炉火命脉的匠人组织。

## 2. 宗旨与信仰

对外称守护炉火,实则垄断锻造。

## 7. 剧情钩子

- 玩家被卷入十人之一的死亡疑云
- 锻炉公会强征学徒
"""

EVENT = """---
type: 事件卡
ip: 测试世界
配套故事书: 锻炉疑云
默认触发: 否
触发条件: 玩家三次提到炉底怪声
触发性: 一次性 once
影响结局: 是
密级: L4
召回关键词: [炉底, 怪声]
作者: 太妃月 / Toffeemoon
---

# 炉底显魂（事件卡 · 隐藏事件）

> 一句话口径:炉底的魂在特定条件下现身。

## 0. 引擎摘要

- **一句话锚点**:炉底封着的魂短暂现身,逼出真相
- **触发门控**:注入给 AI 但默认不触发
- **召回关键词**:炉底, 怪声

## 1. 触发 / 解锁（核心 · 控触发时机）

- **默认状态**:注入给 AI 但不触发
- **触发条件**:玩家三次提到炉底怪声 且 阿岩在场
- **触发性**:一次性(once)
- **触发后置位**:flag_魂现, fact_炉底真相已露

## 2. 事件本体

- **event_id**:EH01
- **摘要**:炉火骤暗,一缕魂影自炉底升起。
- **相关地点**:主锻炉
- **相关角色**:阿岩, 炉底魂
- **玩家可玩的**:追问, 后退, 护住阿岩
- **可能后果**:阿岩坦白 / 玩家被灼伤
- **severity**:4
"""

STORYBOOK = """---
type: 故事书
ip: 测试世界
母本: 测试世界 设定集
档位: 轻量
作者: 太妃月 / Toffeemoon
---

# 锻炉疑云

> 轻悬疑。

## 1. 故事前提

- **标题**:锻炉疑云
- **类型**:轻悬疑
- **基本前提**:学徒入门第一天,发现锻炉底下有怪声。
- **核心冲突**:守炉的秘密与学徒的好奇心
- **开局时钟 / 节奏**:30,慢热

## 3. 故事时间线

- T+0 学徒入门
- T+3 怪声渐密
- T+7 真相揭开

## 4. 主线阶段

### 阶段一·入门
- 核心目标:站稳脚跟
- 表面问题:学锻造

### 阶段二·探秘
- 核心目标:查清怪声

## 5. 事件节点

### E01 · 锻炉异响
- **摘要**:夜里锻炉传出沉闷声响。
- **触发关键词**:怪声, 夜里
- **前置 / 披露条件**:无
- **相关地点**:主锻炉
- **相关角色**:阿岩
- **行动选项提示**:查看, 询问阿岩
- **可能后果**:阿岩警觉 / 置 flag_起疑
- **due_clock**:120
- **severity**:3

## 6. 结局模块

### 结局 A·守秘（id: keep_secret）
- 达成条件:未揭开炉底真相
- 结局内容:学徒离开,秘密长埋。

### 结局 B·真相（id: truth）
- 达成条件:揭开炉底真相 且 护住阿岩
- 结局内容:学徒成为新的守炉人。

## 7. 自由度规则

- 玩家可选好奇 / 安分两种站位
- 信任值随言行增减

## 8. 角色信息边界

### 阿岩
- **public**:锻炉的规矩
- **hidden**:他封印了炉底的魂
- **hard_limits**:绝不主动点破炉底真相

## E. 待确认项（needs_confirm）

- 炉底魂的来历尚未拍板
"""


# ---------------- 测试 ----------------


def test_character():
    d = P.parse_character(CHARACTER).data
    assert d.name == "阿岩", d.name
    assert d.anchor.startswith("把毕生执念")
    assert "想护住" in d.tension
    assert "老茧" in d.look
    assert d.keys == ["阿岩", "石心", "锻炉"]
    assert any(r.startswith("自称:老夫") for r in d.speech_rules), d.speech_rules
    assert any("禁用:不说软话" == r for r in d.speech_rules), d.speech_rules
    assert "石心十人之一" in d.description
    assert "固执" in d.personality
    assert "火候慢" in d.first_mes
    assert d.known_public == ["锻炉的规矩", "石心十人的明面身份"], d.known_public
    assert d.known_hidden == ["他亲手封印了炉底的东西"], d.known_hidden
    assert len(d.versions) == 2, d.versions


def test_player():
    p = P.parse_player(PLAYER)
    assert p.name == "学徒", p.name
    assert "学徒" in p.role
    assert "背井离乡" in p.background
    assert p.goals == ["学会锻一把像样的刀", "弄清锻炉底下的怪声"], p.goals
    assert p.abilities == ["力气大", "一把旧锤"], p.abilities
    assert p.constraints == ["没拜师不能碰主炉"]
    assert p.known_facts == ["阿岩是石心十人之一"]
    assert p.unknown == ["炉底封着东西", "阿岩的真实身份"], p.unknown
    assert "入门第一天" in p.opening, p.opening


def test_worldbook():
    wb = P.parse_worldbook(WORLDBOOK)
    assert wb.name == "测试世界 世界书", wb.name
    # 教学围栏(§1)里的示例不能被当成真条目
    assert len(wb.entries) == 3, [e.comment for e in wb.entries]
    by_comment = {e.comment: e for e in wb.entries}
    assert "测试世界" in by_comment
    assert by_comment["测试世界"].keys == ["测试世界", "这个世界"]
    assert by_comment["测试世界"].content.startswith("一个靠锻炉之火")
    assert by_comment["炉火代价"].source == "rule"
    assert by_comment["炉火代价"].priority == 9, by_comment["炉火代价"].priority
    assert by_comment["炉底真相"].visibility == "hidden", by_comment["炉底真相"].visibility


def test_settingcard():
    s = P.parse_settingcard(SETTINGCARD)
    assert s.name == "石心十人", s.name
    assert s.category == "组织"
    assert s.parent_world == "测试世界 设定集", s.parent_world
    assert s.tier == "轻量"
    assert "把守世界炉火" in s.anchor
    assert s.keys == ["石心十人", "石心", "锻炉公会"]
    assert s.public == ["十人的明面身份"], s.public
    assert s.hidden == ["十人之一实为忆灵假冒"], s.hidden
    assert "庄重克制" in s.tone
    assert "炉火命脉" in s.overview
    assert "宗旨与信仰" in s.sections, list(s.sections)
    assert len(s.hooks) == 2, s.hooks


def test_event():
    e = P.parse_event(EVENT)
    assert e.title == "炉底显魂", e.title
    assert e.hidden is True
    assert e.once is True
    assert e.affects_ending is True
    assert e.event_id == "EH01", e.event_id
    assert "炉火骤暗" in e.summary
    assert e.location == "主锻炉"
    assert e.characters == ["阿岩", "炉底魂"], e.characters
    assert e.set_flags == ["flag_魂现", "fact_炉底真相已露"], e.set_flags
    assert e.severity == 4
    assert any("三次提到炉底怪声" in c for c in e.unlock_conditions), e.unlock_conditions
    assert e.trigger_keywords == ["炉底", "怪声"]


def test_storybook():
    b = P.parse_storybook(STORYBOOK)
    assert b.title == "锻炉疑云", b.title
    assert "怪声" in b.premise
    assert b.clock_start == 30, b.clock_start
    assert b.timeline == ["T+0 学徒入门", "T+3 怪声渐密", "T+7 真相揭开"], b.timeline
    assert len(b.main_plot) == 2, b.main_plot
    assert b.main_plot[0].startswith("阶段一·入门") and "站稳脚跟" in b.main_plot[0], b.main_plot
    assert len(b.events) == 1, b.events
    ev = b.events[0]
    assert ev.event_id == "E01", ev.event_id
    assert ev.title == "锻炉异响"
    assert ev.trigger_keywords == ["怪声", "夜里"]
    assert ev.reveal_after == [], ev.reveal_after  # 「无」不入 reveal_after
    assert ev.due_clock == 120, ev.due_clock
    assert ev.severity == 3
    assert len(b.endings) == 2, b.endings
    assert b.endings[0].ending_id == "keep_secret", b.endings[0].ending_id
    assert b.endings[1].ending_id == "truth"
    assert "学徒成为新的守炉人" in b.endings[1].summary
    assert len(b.freedom_rules) == 2, b.freedom_rules
    assert len(b.character_boundaries) == 1, b.character_boundaries
    cb = b.character_boundaries[0]
    assert cb.character == "阿岩"
    assert cb.public == ["锻炉的规矩"]
    assert cb.hidden == ["他封印了炉底的魂"]
    assert cb.hard_limits == ["绝不主动点破炉底真相"]
    assert b.needs_confirm == ["炉底魂的来历尚未拍板"], b.needs_confirm


def test_parse_card_routing():
    assert P.detect_kind(CHARACTER) == "角色卡"
    assert isinstance(P.parse_card(PLAYER), type(P.parse_player(PLAYER)))
    assert P.parse_card(WORLDBOOK).name == "测试世界 世界书"
    try:
        P.parse_card("没有 frontmatter 的纯文本")
        raise AssertionError("应对无法识别卡种抛 ValueError")
    except ValueError:
        pass


def test_backward_compat_empty():
    # 占位符 / 空字段不该崩,且回落空值
    minimal = "---\ntype: 角色卡\n---\n# 无名 角色卡\n"
    d = P.parse_character(minimal).data
    assert d.name == "无名"
    assert d.anchor == "" and d.keys == [] and d.known_hidden == []


TESTS = [
    test_character,
    test_player,
    test_worldbook,
    test_settingcard,
    test_event,
    test_storybook,
    test_parse_card_routing,
    test_backward_compat_empty,
]


def main() -> int:
    passed, failed = 0, 0
    for t in TESTS:
        try:
            t()
            passed += 1
            print("PASS", t.__name__)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", t.__name__, "->", repr(e))
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
