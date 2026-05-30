"""第 2 组验证:复用第 1 组脚手架,但每轮走流式端点(SSE),用全新会话。

跑法:.venv/Scripts/python.exe _validate_group2.py
验证 ①async 端点+流式生效(每轮有 delta 流)②0 保底/0 重复/状态推进 ③token 不失控,
并复测 reroll 在 async 下仍正确。结果写 _validate_report2.json。
"""
import _validate_group1 as V

V.STREAM_MODE = True
V.REPORT_PATH = "_validate_report2.json"
V.SESSION_PREFIX = "g2s_"  # 全新会话,不接第 1 组旧档

if __name__ == "__main__":
    V.main()
