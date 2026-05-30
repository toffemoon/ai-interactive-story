"""第 5a 组验证:复用脚手架流式跑 7 局,全新会话。崩铁局用已带 endings 的新故事书。

验证 ①故事书结构化无回归(endings/角色边界注入进 prompt 后,生成仍 0 保底/0 重复/状态推进)
②结构化 turns 仍对齐、reroll/续玩/流式正常 ③token 不失控。写 _validate_report5a.json。
identify 本身的升级由 _smoke_group5a.py 单测(endings/时间字段/角色边界/待确认 + 完整故事&离散点子两轨)。
"""
import _validate_group1 as V

V.STREAM_MODE = True
V.REPORT_PATH = "_validate_report5a.json"
V.SESSION_PREFIX = "g5as_"

if __name__ == "__main__":
    V.main()
