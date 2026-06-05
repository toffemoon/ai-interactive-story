# -*- coding: utf-8 -*-
"""
新手教学局《渡口》—— 可跑草稿(yufei 授权代笔,内容随便改)。
跑法:python _seed_tutorial.py  → POST 到本地 /api/presets,存成一个预设故事。
之后探索页就能看到「新手教学 · 渡口」,点开始即玩。改内容:直接改本文件重跑,或在前端「故事库 / 我的故事」里改。

设计意图(对照 vault 设计文档 §4 第二层 / §9 结局卡):
- 极短:3-4 轮到一个结局,别让新手陷进长局。
- 一局重点教两个「啊哈」:① 选择有后果(诚实/敷衍/硬闯 → 肉眼可见不同的下一步)
  ② 角色会记得你(你怎么对渡叔,决定他怎么对你、能不能过河)。轻带 ③ 隐藏会触发
  (渡叔藏着一桩等人的旧事,只有真心相待才露)。
- 教学藏进剧情,不让 NPC 念说明书。题材中性通用,不绑 IP。
- mode=standard:避开 deep 模式 ~90s 冷启动(设计文档 §16.1),新手第一屏不能等。
"""
import json
import urllib.request

API = "http://127.0.0.1:8000/api/presets"

# ── 角色卡:渡叔(唯一 NPC)─────────────────────────────────────────
FERRYMAN = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "渡叔",
        "character_id": "ferryman",
        "description": (
            "黄昏渡口唯一的摆渡人,守着一条旧木船和一条不算宽的河。"
            "脸上沟壑是常年风吹的痕迹,话不多,规矩却清楚:上船的人,"
            "得先说清自己要去哪、为什么去。腰间挂着一只褪色的旧布囊,从不解开。"
        ),
        "personality": (
            "粗粝但公道,不爱寒暄,敬重把话说实的人,烦敷衍和硬闯。"
            "心里揣着一桩没说出口的等待,越被真心问起越沉默,被尊重时会松一点。"
        ),
        "scenario": "黄昏,渡口。你来到河边,渡叔正坐在船头收拾缆绳。",
        "first_mes": (
            "天快黑了,最后一趟船。要过河?先说说,你往哪儿去,又为了什么。"
            "空着手、空着话,我这船不开。"
        ),
        "mes_example": "(慢慢卷起缆绳)实话我爱听。糊弄我的,留在这岸上慢慢等下一个黄昏吧。",
        "speech_rules": [
            "自称「我」,称玩家为「你」或「客人」。",
            "话短句沉,像水边人说话,不绕弯;敬重实话,烦敷衍与硬闯。",
            "被真心问起自己 / 那只旧布囊时会沉默、岔开话,不主动说破心事。",
            "玩家越尊重、越诚实,他越松动;越敷衍、越想硬闯,他越冷。",
            "不喊口号、不感叹,情绪压在短句里。",
        ],
        "tags": ["渡口", "摆渡人", "教学"],
    },
}

# ── 故事书 ──────────────────────────────────────────────────────
STORY = {
    "title": "渡口",
    "premise": (
        "黄昏的渡口,一条不宽的河,一个守船的摆渡人。要过河,先把自己交代清楚。"
        "怎么对他,决定你怎么过河——也决定你能不能看见他藏着的那点东西。"
    ),
    "clock_start": 0,
    "timeline": [
        "黄昏,你抵达渡口,渡叔要你说清去向与缘由。",
        "你如何回应(诚实 / 敷衍 / 硬闯)决定渡叔的态度。",
        "若以真心相待,渡叔会松口,露出他在等人的旧事。",
        "上船过河,或留在岸上。",
    ],
    "main_plot": [
        "阶段一·相遇:渡叔要你说清『去哪、为什么』。你的回应方式(诚实交代 / 敷衍带过 / 想硬闯上船)是第一个分叉。",
        "阶段二·态度:渡叔依你的态度变冷或变软。诚实尊重 → 他松动、信任上升;敷衍硬闯 → 他冷脸、不开船。",
        "阶段三·过河:态度好 → 他载你过河,临别或许提一句他在等的人;态度差 → 他让你留在岸上等下一个黄昏。",
    ],
    "freedom_rules": [
        "玩家可自由说任何话,不限于选项;渡叔按『诚实 / 尊重』还是『敷衍 / 硬闯』来回应。",
        "渡叔记得玩家之前的态度:前面敷衍过,后面就算客气他也半信半疑。",
        "硬闯 / 抢船 = 渡叔有世界内的办法拦下(撑开船、收缆),不会被秒过河。",
    ],
    "pacing": [
        "教学短局:3-4 轮内收尾,不要拖到第 5 轮以后,不要软收尾(别写『先休整』式)。",
        "玩家一旦过河靠岸,或被明确拒载,就立即用对应结局收尾:state_update 标 main_resolved:true 并给 reached_ending——"
        "交心后过河=du_warm;公事公办过河=du_plain;敷衍/硬闯被拒=du_stuck。",
    ],
    "needs_confirm": [],
    "persona_shifts": [],
    "character_boundaries": [
        {
            "character": "渡叔",
            "public": [
                "黄昏渡口唯一的摆渡人",
                "规矩:上船先说清去向与缘由",
                "公道、敬重实话,烦敷衍硬闯",
            ],
            "hidden": [
                "旧布囊里是多年前一个没等到的人留下的东西",
                "他其实自己渡不过这条河——他在等那个人回来",
            ],
            "hard_limits": [
                "不被玩家三言两语逼问就说破心事;只有玩家真心相待(尊重 + 问起他本人)才松口",
                "不开局就自曝身世",
            ],
        }
    ],
    "events": [
        {
            "event_id": "E1",
            "title": "交代来意",
            "status": "pending",
            "summary": "渡叔要你说清去向与缘由;你的回应定下他对你的第一印象。",
            "location": "渡口·船头",
            "characters": ["渡叔"],
            "trigger_keywords": ["过河", "上船", "去哪", "为什么", "渡", "摆渡", "赶路", "寻人"],
            "reveal_after": [],
            "trigger_flags": [],
            "choices_hint": [
                "如实说出你要去哪、为什么(诚实 → 他认可,信任上升)",
                "随口敷衍、含糊带过(→ 他起疑、变冷)",
                "不答,直接想上船 / 抢船(硬闯 → 他拦下、变冷)",
            ],
            "consequences": ["诚实 → 信任上升", "敷衍 / 硬闯 → 渡叔变冷,趋向『滞留』结局"],
            "severity": 2,
            "due_clock": None,
            "escalate_after_idle": None,
        },
        {
            "event_id": "E2",
            "title": "上船过河",
            "status": "pending",
            "summary": "渡叔愿意(或不愿意)载你。态度好 → 上船过河;若你还问起他本人 / 那只旧布囊,他会松口提起等的人。",
            "location": "河上",
            "characters": ["渡叔"],
            "trigger_keywords": ["谢谢", "你呢", "布囊", "等谁", "你的故事", "开船", "过河", "上船"],
            "reveal_after": ["E1"],
            "trigger_flags": [],
            "choices_hint": [
                "道谢、问问渡叔自己的事(→ 他松口,通向『同舟』结局)",
                "只管过河、不多问(→ 普通『过河』结局)",
            ],
            "consequences": ["问起他本人且态度真诚 → 交心,通向最好结局", "只过河 → 普通结局"],
            "severity": 2,
            "due_clock": None,
            "escalate_after_idle": None,
        },
    ],
    "endings": [
        {
            "ending_id": "du_warm",
            "title": "渡 · 同舟",
            "tone": "好结局",
            "summary": "你以诚实与尊重待渡叔,他松了口,载你过了河;临别提起他等的那个人。你不只过了河,还看见了他藏着的东西。",
            "conditions": ["以诚实 + 尊重待渡叔,他说出旧事并载你过河(交心 + 过河);模型判定收尾。"],
            "required_facts": [],   # 走模型路:heartfelt 过河时由模型给 reached_ending=du_warm(模型路优先于代码兜底)
            "required_events": [],
        },
        {
            "ending_id": "du_plain",
            "title": "过河",
            "tone": "开放",
            "summary": "你照规矩说清去向,渡叔公事公办载你过了河。一趟普通的渡,没多说什么。",
            "conditions": ["如实交代但未深交,渡叔载你过河。"],
            "required_facts": [],
            "required_events": ["E2"],   # 代码兜底:E2(上船过河)被判 resolved 即收尾,保证『过了河一定有结局』
        },
        {
            "ending_id": "du_stuck",
            "title": "滞留",
            "tone": "开放",
            "summary": "你敷衍或想硬闯,渡叔冷下脸,让你留在岸上等下一个黄昏。船没开。",
            "conditions": ["敷衍 / 硬闯,渡叔拒载;模型判定收尾。"],
            "required_facts": [],   # 走模型路:被拒时由模型给 reached_ending=du_stuck
            "required_events": [],
        },
    ],
}

# ── 可扮演主角(选人页用;两个身份演示「换身份体验不同」)──────────────
PLAYABLES = [
    {
        "name": "赶路的旅人",
        "role": "急着在天黑前赶到对岸城镇的旅人",
        "goals": ["天黑前过河,赶到对岸"],
        "abilities": ["脚程快、会看天色", "身上有几枚铜钱"],
        "background": "你为生计奔波,只想快点过河,没工夫多聊。",
        "constraints": ["赶时间,容易不耐烦", "[开局不知道] 不知道渡叔在等什么人"],
        "known_facts": ["这是天黑前最后一趟船", "渡叔要你先说清去向与缘由"],
    },
    {
        "name": "寻人的人",
        "role": "沿河寻找一位多年未见之人的旅人",
        "goals": ["打听、寻找你要找的那个人", "过河继续寻路"],
        "abilities": ["善于倾听、问得出故事", "带着一张旧画像"],
        "background": "你为寻一个人走了很远,见人就想多问一句。",
        "constraints": ["容易动情、心软", "[开局不知道] 不知道渡叔也在等一个没回来的人"],
        "known_facts": ["这是天黑前最后一趟船", "渡叔要你先说清去向与缘由"],
    },
]

PRESET = {
    "name": "新手教学 · 渡口",
    "characters": [FERRYMAN],
    "playables": PLAYABLES,
    "world": None,
    "story": STORY,
    "player": None,
    "mode": "standard",
    "cover": "",
    "synopsis": "5 分钟教学局:在一个黄昏渡口,边玩边学——自由行动、选项推进,你的选择和态度会真的改变结局。",
    "author": "教学",
    "tags": ["教学", "新手", "渡口", "短局"],
}


def main():
    body = json.dumps(PRESET, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        print("HTTP", r.status, r.read().decode("utf-8"))


if __name__ == "__main__":
    main()
