"""第 3 组验证:复用脚手架,流式跑 7 局(含「硬约束探针」),全新会话。

验证 ①reasoning 自检每轮生效 + 硬 canon 违背触发世界内反制(探针局 hv_turns>0)
②async/流式无回归:0 保底/0 重复/状态推进 ③token 不失控。写 _validate_report3.json。
"""
import _validate_group1 as V

V.STREAM_MODE = True
V.REPORT_PATH = "_validate_report3.json"
V.SESSION_PREFIX = "g3s_"

if __name__ == "__main__":
    V.main()
