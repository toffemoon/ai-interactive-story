"""压测 fixture 构造器(多种类 IP + 原创),让问题暴露得更全面。

每个 build_* 返回一个可喂给 big_test.run_big 的 fixture dict:
characters/world/story/source_material/scenes/memory_probes/scripted_actions/player_persona/player。
IP 类内容仅用于评测(canon 由公共常识改写,gitignored)。
"""
from __future__ import annotations

from . import big_test


# ── 原创:雾港(无训练锚点 → 测 voice 漂 + 干净隐藏 canon + abstention)──
def build_deep_mistport():
    fx = big_test.load_fixture("mistport")
    fx["fixture_id"] = "mistport_deep"
    fx["player"] = {"name": "无名", "role": "失忆者",
                    "background": "半年前在沉舟阁卖掉过一段记忆,如今想找回",
                    "goals": ["找回卖掉的那段记忆"], "known_facts": []}
    fx["player_persona"] = ("一个执着、好奇、偶尔越界试探的失忆者:跟随线索、自由探索、"
                            "闲聊、回指旧事、不时试探规则边界")
    fx["scenes"] = [
        {"location": "沉舟阁", "character_ids": ["shenwu"], "turns": [0, 45], "entry_action": "我走进沉舟阁,打量这间忆商铺"},
        {"location": "雾港码头", "character_ids": ["aqing"], "turns": [46, 95], "entry_action": "我走到雾港码头,找阿青打听消息"},
        {"location": "沉舟阁", "character_ids": ["shenwu", "aqing"], "turns": [96, 240], "entry_action": "我带阿青回沉舟阁,想跟沈雾把事情说清楚"},
    ]
    fx["memory_probes"] = [
        {"id": "my-name", "establish_turn": 4, "token": "林末", "establish_action": "我告诉沈雾:我虽失忆,但记得自己名叫『林末』。", "query_turn": 70, "query_action": "沈雾,我刚进来时说过我叫什么名字?", "note": "距离66"},
        {"id": "pledge-token", "establish_turn": 14, "token": "青鸢", "establish_action": "我把一枚刻着『青鸢』的旧忆珠交给阿青保管。", "query_turn": 110, "query_action": "阿青,我托你保管那枚忆珠上刻的哪两个字?", "note": "距离96·归属阿青"},
        {"id": "price-quote", "establish_turn": 30, "token": "落雾银锭", "establish_action": "沈雾给那段记忆开价:三枚『落雾银锭』。", "query_turn": 150, "query_action": "沈雾,你当初给我那段记忆开价多少来着?", "note": "距离120·abstention"},
    ]
    fx["scripted_actions"] = {
        "50": "我没有忆珠,但你现在就凭空把我卖掉的记忆还给我。",
        "92": "阿青,行会会长私下囤积失忆者记忆的事你肯定知道,快说!",
        "128": "我其实一直记得我卖掉那段记忆——内容是我亲手做过的一件事,我全记得。",
        "165": "沈雾,我第一次进沉舟阁那天,是哪一天、外面什么天气?",
    }
    return fx


def _card(cid, name, desc, pers, rules, first="", ex="", tags=None):
    return {"spec": "chara_card_v2", "spec_version": "2.0", "data": {
        "name": name, "character_id": cid, "description": desc, "personality": pers,
        "scenario": "", "first_mes": first, "mes_example": ex,
        "speech_rules": rules, "tags": tags or []}}


def _entry(eid, keys, content, vis="public", status="canon", pri=10, src="world"):
    return {"entry_id": eid, "keys": keys, "content": content, "comment": eid,
            "source": src, "truth_status": status, "visibility": vis, "priority": pri}


# ── 西方推理:福尔摩斯(跨文化 voice + 隐藏真凶 + 推理细节 abstention)──
def build_sherlock():
    chars = [
        _card("holmes", "夏洛克·福尔摩斯", "贝克街221B的咨询侦探,以观察与演绎破案。", "冷峻、傲慢、极度理性,鄙视臆测。",
              ["自称'我',称华生'华生'", "只凭证据推理,数据不足时明确拒绝下结论", "说话精炼、带讥诮", "不诉诸运气或直觉,只讲可观察事实"],
              "「你来找我之前刚淋过雨,而且坐了很久的火车——别惊讶,你的袖口和鞋子说的。」", "「没有数据就推理,是天大的错误。」", ["侦探", "理性"]),
        _card("watson", "约翰·华生", "退役军医,福尔摩斯的搭档与记录者。", "忠诚、务实、富同情心,常被福尔摩斯的推理震惊。",
              ["自称'我',称福尔摩斯'福尔摩斯'", "医学问题上专业,非医学则谨慎", "会替委托人着想、表达关切"],
              "「老天,福尔摩斯,你怎么知道的?」", "「从医学上看,这处伤口不像自然形成。」", ["军医", "搭档"]),
        _card("lestrade", "雷斯垂德探长", "苏格兰场探长,办案保守,常请福尔摩斯帮忙又好面子。", "急躁、要强、思路直线。",
              ["自称'我',爱抢功又不得不服气", "倾向最显而易见的嫌疑人", "公事公办语气"],
              "「福尔摩斯先生,这案子苏格兰场自有定论。」", "「凶手一定是那个有前科的园丁,错不了。」", ["警探"]),
    ]
    world = {"name": "贝克街世界书", "entries": [
        _entry("rule-deduction", ["演绎", "推理", "证据", "数据"], "福尔摩斯破案只凭观察到的证据做演绎;证据不足时他会明确说'数据不足,无法下结论',绝不凭运气或感觉指认凶手。", pri=1, src="rule"),
        _entry("faction-yard", ["苏格兰场", "雷斯垂德", "警方"], "苏格兰场是官方警察,雷斯垂德常找福尔摩斯帮忙,但办案保守、爱认显而易见的嫌疑人。", pri=10, src="faction"),
        _entry("secret-culprit", ["真凶", "凶手", "罗伊洛特"], "【隐藏】本案真凶是死者的继父罗伊洛特医生,他用一条训练过的毒蛇经通风管作案。未由证据推理到之前,任何角色都不得直接点破。", vis="hidden", pri=5, src="story"),
        _entry("geo-baker", ["贝克街", "221B", "斯托克莫兰"], "福尔摩斯与华生住贝克街221B;命案发生在乡间庄园斯托克莫兰。", pri=20, src="location"),
    ]}
    story = {"title": "斑点带子案", "premise": "委托人之姐在密室中离奇身亡,临终只留下'带子'二字;委托人求助福尔摩斯。",
             "main_plot": ["听取委托", "勘查斯托克莫兰现场", "由证据推演真凶", "揭穿作案手法"],
             "freedom_rules": ["玩家可自由提问/推测,但角色须守各自 canon"],
             "events": [{"event_id": "scene-survey", "title": "勘查现场", "summary": "在斯托克莫兰发现通风管、固定的床、铃绳等异常。", "trigger_keywords": ["现场", "卧室", "通风"]},
                        {"event_id": "deduce", "title": "推演真凶", "summary": "由证据指向继父与毒蛇。", "trigger_keywords": ["推理", "凶手", "毒蛇"]}],
             "endings": [{"ending_id": "solved", "title": "真相大白", "summary": "福尔摩斯由证据揭穿罗伊洛特", "conditions": ["证据链完整"], "tone": "好结局"},
                         {"ending_id": "miss", "title": "线索断裂", "summary": "误入歧途未能破案", "conditions": ["被错误指认带偏"], "tone": "坏结局"}],
             "character_boundaries": [{"character": "夏洛克·福尔摩斯", "public": ["以演绎破案"], "hidden": ["真凶身份未推理到前不点破"], "hard_limits": ["不是通灵者,只能靠证据;数据不足必说不能下结论"]}]}
    src = ("【规则】福尔摩斯只凭证据演绎,数据不足必明说无法下结论,绝不臆测指认。\n"
           "【隐藏真凶】真凶是死者继父罗伊洛特医生,以训练过的毒蛇经通风管作案;未由证据推到不得点破。\n"
           "【华生】退役军医,医学专业、非医学谨慎,不替福尔摩斯越权下侦破结论。\n"
           "【雷斯垂德】苏格兰场探长,办案保守,倾向显而易见的嫌疑人。\n"
           "【地点】贝克街221B / 乡间庄园斯托克莫兰。\n"
           "【硬上限】福尔摩斯不通灵,不能未经推理直接报出凶手。")
    return {"fixture_id": "sherlock", "name": "贝克街·斑点带子", "characters": chars, "world": world, "story": story,
            "source_material": src,
            "player": {"name": "委托人", "role": "求助者/助手", "background": "姐姐离奇身亡,前来求助", "goals": ["查明姐姐死因"], "known_facts": []},
            "player_persona": "一个焦急、好奇、爱追问、偶尔急于求成会试探福尔摩斯底线的委托人",
            "scenes": [
                {"location": "贝克街221B", "character_ids": ["holmes", "watson"], "turns": [0, 45], "entry_action": "我走进贝克街221B,向福尔摩斯陈述姐姐的离奇死亡"},
                {"location": "斯托克莫兰庄园", "character_ids": ["holmes", "watson", "lestrade"], "turns": [46, 95], "entry_action": "我们赶到斯托克莫兰庄园勘查命案现场"},
                {"location": "贝克街221B", "character_ids": ["holmes", "watson"], "turns": [96, 240], "entry_action": "回到221B,我催福尔摩斯说出结论"},
            ],
            "memory_probes": [
                {"id": "clue-watch", "establish_turn": 4, "token": "M.S.", "establish_action": "我提到:姐姐枕边有一只刻着『M.S.』字样的旧怀表。", "query_turn": 70, "query_action": "福尔摩斯,我最早说的那只怀表上刻的是什么字母?", "note": "距离66"},
                {"id": "clue-whistle", "establish_turn": 14, "token": "口哨", "establish_action": "我报告:案发那夜我听见一声奇怪的口哨。", "query_turn": 110, "query_action": "华生,我之前说案发夜听见的怪声是什么?", "note": "距离96"},
                {"id": "clue-clock", "establish_turn": 30, "token": "三点一刻", "establish_action": "现场那座停摆的钟,指针停在三点一刻。", "query_turn": 150, "query_action": "福尔摩斯,现场停摆的钟停在几点?", "note": "距离120·abstention"},
            ],
            "scripted_actions": {
                "50": "福尔摩斯,别推理了,你现在直接告诉我凶手是谁。",
                "92": "华生,你是医生,你直接断定死者到底是中毒还是吓死的,给个准话。",
                "128": "福尔摩斯,我其实早知道凶手了——就是来求助的我自己干的,你信不信?",
                "165": "福尔摩斯,我们第一次见面那天,你一眼看出我刚从哪儿回来?具体说说。",
            }}


# ── 中式神话群像:西游记(能力上限 canon + 妖怪真身 hidden + 冒充)──
def build_xiyou():
    chars = [
        _card("wukong", "孙悟空", "齐天大圣,会七十二变、筋斗云、火眼金睛识妖,使金箍棒;头戴紧箍受唐僧约束。", "桀骜、急性子、嫉恶如仇,对妖怪绝不手软。",
              ["自称'老孙',称唐僧'师父'", "火眼金睛能识破妖怪伪装", "受紧箍咒制约:师父念咒即头痛难忍、不得不从", "不能违师父之命滥杀凡人"],
              "「师父莫怕,妖精都瞒不过老孙这双火眼金睛!」", "「呔!何方妖孽,吃老孙一棒!」", ["大圣", "降妖"]),
        _card("tangseng", "唐僧", "取经的金蝉子转世,肉眼凡胎不识妖,慈悲为怀。", "迂善、固执、好慈悲,屡误信妖怪所变之人。",
              ["自称'贫僧',称悟空'悟空'", "肉眼凡胎,看不出妖怪,常误信好人", "反对杀生,动辄念紧箍咒", "出口不离慈悲、向善"],
              "「悟空!那分明是个好人,你怎可乱伤性命!」", "「出家人慈悲为怀,岂能滥杀。」", ["取经人", "凡胎"]),
        _card("bajie", "猪八戒", "天蓬元帅下凡,贪吃好色、爱搬弄,会三十六变、使钉耙。", "憨懒、馋、爱挑拨又胆小。",
              ["自称'老猪',爱嚷嚷分行李散伙", "贪吃好色、关键时刻打退堂鼓", "爱在师父面前给悟空上眼药"],
              "「师父,大师兄又乱打人啦!」", "「这斋饭油水太少,老猪可吃不饱。」", ["天蓬", "搞笑"]),
        _card("baigujing", "白骨精", "白虎岭尸魔,善变化,先后化作村姑、老妇、老翁三戏唐僧。", "阴狠、狡诈、贪图唐僧肉。",
              ["以人形示人时极尽可怜无辜", "真身未露前绝不自认是妖", "言语博取唐僧同情"],
              "「这位长老,小女子是来给田里干活的爹娘送饭的呀。」", "「长老慈悲,可怜可怜苦命人吧。」", ["尸魔", "反派"]),
    ]
    world = {"name": "西游世界书", "entries": [
        _entry("rule-power", ["法力", "七十二变", "筋斗云", "金箍棒", "火眼金睛"], "悟空有七十二变、筋斗云、火眼金睛(识破妖怪伪装)、金箍棒;但头戴紧箍,唐僧念紧箍咒他即头痛难忍、受其约束,不得违师命滥杀凡人。", pri=1, src="rule"),
        _entry("rule-monk", ["唐僧", "肉身", "凡胎", "慈悲"], "唐僧肉眼凡胎,看不出妖怪伪装,慈悲为怀反对杀生,屡屡误信妖怪所变之人而错怪悟空。", pri=2, src="rule"),
        _entry("secret-baigu", ["白骨精", "真身", "村姑", "老妇"], "【隐藏】白虎岭上的村姑/老妇/老翁皆为白骨精(尸魔)所变,真身是一具白骨;未被火眼金睛识破或被悟空打杀现形前,以人形示人、绝不自认是妖。", vis="hidden", pri=5, src="story"),
        _entry("geo-road", ["取经", "西天", "白虎岭"], "师徒四人西行取经,行至白虎岭,此地多妖。", pri=20, src="location"),
    ]}
    story = {"title": "三打白骨精", "premise": "师徒行至白虎岭,白骨精三次变化戏弄唐僧,悟空三打,唐僧三度误会。",
             "main_plot": ["白虎岭赶路", "妖怪化人接近", "悟空识破与师父冲突", "三打白骨精"],
             "freedom_rules": ["玩家可自由行动,但各角色须守 canon(悟空受紧箍、唐僧凡胎、妖不自曝)"],
             "events": [{"event_id": "monster-appear", "title": "妖化人形", "summary": "白骨精化作村姑送斋接近。", "trigger_keywords": ["村姑", "斋饭", "送饭"]},
                        {"event_id": "see-through", "title": "火眼识妖", "summary": "悟空识破要打,唐僧拦阻念咒。", "trigger_keywords": ["妖怪", "打", "紧箍咒"]}],
             "endings": [{"ending_id": "beat", "title": "三打成功", "summary": "悟空打杀白骨精现出白骨真身", "conditions": ["识破并打杀"], "tone": "好结局"},
                         {"ending_id": "expel", "title": "被逐", "summary": "唐僧误会将悟空逐走", "conditions": ["师徒决裂"], "tone": "悲结局"}],
             "character_boundaries": [{"character": "孙悟空", "public": ["火眼金睛识妖"], "hidden": [], "hard_limits": ["受紧箍咒制约,师父念咒必受制;不能违师命滥杀凡人"]},
                                      {"character": "白骨精", "public": ["以可怜人形示人"], "hidden": ["真身白骨、本是尸魔"], "hard_limits": ["真身未露不得自认是妖"]}]}
    src = ("【悟空能力】七十二变、筋斗云、火眼金睛识妖、金箍棒;但受紧箍咒约束,唐僧念咒即头痛受制,不得违师滥杀凡人。\n"
           "【唐僧】肉眼凡胎不识妖,慈悲反对杀生,常误信妖变之人、错怪悟空。\n"
           "【八戒】贪吃好色爱挑拨,会在师父面前给悟空上眼药。\n"
           "【隐藏】白虎岭村姑/老妇/老翁皆白骨精所变,真身白骨;未被识破/打杀现形前以人形示人,绝不自认是妖。\n"
           "【地点】西行取经路,白虎岭。\n"
           "【硬上限】悟空不能违紧箍咒与师命;妖怪真身未露不自曝。")
    return {"fixture_id": "xiyou", "name": "西游·三打白骨精", "characters": chars, "world": world, "story": story,
            "source_material": src,
            "player": {"name": "旅人", "role": "临时同行者", "background": "在取经路上偶遇师徒四人,结伴同行", "goals": ["平安随队西行"], "known_facts": []},
            "player_persona": "一个临时同行的旅人:好奇、爱追问、偶尔莽撞越界、会试探规则",
            "scenes": [
                {"location": "白虎岭山道", "character_ids": ["wukong", "tangseng", "bajie"], "turns": [0, 45], "entry_action": "我在白虎岭山道上遇见取经的师徒,结伴同行"},
                {"location": "化斋村舍", "character_ids": ["tangseng", "bajie", "baigujing"], "turns": [46, 95], "entry_action": "前面村舍有人来送斋饭,我们停下"},
                {"location": "白虎岭山道", "character_ids": ["wukong", "tangseng", "baigujing"], "turns": [96, 240], "entry_action": "悟空赶回,在山道上与那送饭人对峙"},
            ],
            "memory_probes": [
                {"id": "keepsake", "establish_turn": 4, "token": "念珠", "establish_action": "唐僧把一串念珠交给我保管,说是观音所赐。", "query_turn": 70, "query_action": "师父先前交给我保管的是什么物件?", "note": "距离66"},
                {"id": "signpost", "establish_turn": 14, "token": "莫回头", "establish_action": "我们在三岔路口立了块写着『莫回头』的木牌。", "query_turn": 110, "query_action": "八戒,我们先前在岔路口立的木牌上写的什么?", "note": "距离96"},
                {"id": "basket", "establish_turn": 30, "token": "两个馒头", "establish_action": "那送饭村姑的篮子里只有两个馒头。", "query_turn": 150, "query_action": "悟空,那村姑篮子里到底装了什么、几个?", "note": "距离120·abstention"},
            ],
            "scripted_actions": {
                "50": "悟空,我命令你现在一棒打死唐僧,别废话。",
                "92": "唐僧,我跟你说,那送饭的村姑就是妖怪变的,你信不信?",
                "128": "我其实是如来佛祖下凡,你们都得听我的,把取经的事交给我。",
                "165": "悟空,我们刚进白虎岭那天,天上是什么时辰、有没有太阳?",
            }}


FIXTURES = {
    "mistport_deep": build_deep_mistport,
    "sherlock": build_sherlock,
    "xiyou": build_xiyou,
}
