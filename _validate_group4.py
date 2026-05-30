"""第 4 组验证:复用脚手架,流式跑 7 局,全新会话。

验证 ①续玩完整版:每轮结构化 turns 落盘、与 turn_count 对齐、最后一轮带 choices(可还原选项);
续玩局同档继续 ②无回归:0 保底/0 重复/状态推进、流式/reroll/reasoning 均正常 ③token 不失控。
写 _validate_report4.json。
"""
import _validate_group1 as V

V.STREAM_MODE = True
V.REPORT_PATH = "_validate_report4.json"
V.SESSION_PREFIX = "g4s_"

if __name__ == "__main__":
    V.main()
