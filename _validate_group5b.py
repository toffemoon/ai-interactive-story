"""第 5b 组验证:复用脚手架流式跑 8 局(原 7 + 新增「世界时钟探针」),全新会话。

验证 ①世界时钟生效:每轮 clock 单调不减、玩家跳时间大跳、时间到点/停滞事件被推上来(探针局)
②无回归:0 保底/0 重复/状态推进、结构化/reroll/续玩/流式/reasoning 均正常 ③token 不失控。
写 _validate_report5b.json。clamp/恶化登场逻辑由 _smoke_group5b.py 单测。
"""
import _validate_group1 as V

V.STREAM_MODE = True
V.REPORT_PATH = "_validate_report5b.json"
V.SESSION_PREFIX = "g5bs_"

if __name__ == "__main__":
    V.main()
