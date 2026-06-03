"""模型适配器层 —— 把引擎核心和「具体模型怎么调」解耦。

为什么:引擎原本跟 DeepSeek 的 json_mode quirk 焊死(所有历史折进 system,
只发 [system, user])。那是针对特定模型 bug 的 workaround,却被做成了架构级决策,
导致换模型 = 改引擎核心。

设计:引擎产出一个**模型无关的 ContextBundle**(它认为这一轮该让模型看到的全部信息,
分块保留:骨架 / 摘要 / 召回 / 近期原文 / 近期消息 / 玩家行动)。适配器决定怎么把这些
组装成目标模型期望的 messages,以及每类调用用哪个模型。

- DeepSeekAdapter:折成 [system, user](复刻当前行为,逐字节一致)。
- ClaudeAdapter:用真正的多轮 messages + 区块标签;主回合用强模型、辅助任务用便宜模型。
- 引擎核心不再出现任何「因为某模型有 X 限制」的逻辑 —— 全部下沉到适配器。

详细设计:Obsidian Vault `01 - Projects/YoRHa-A2/ai-interactive-story-eval-platform.md` §2
决策:decisions/2026-06-02-model-adapter-layer.md
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from .llm import achat_messages, achat_messages_stream


@dataclass
class ContextBundle:
    """引擎产出的、模型无关的一轮上下文。

    引擎只负责填「内容是什么」;区块标题 / 排序 / 折叠还是多轮,由适配器决定。
    """

    skeleton: str                          # _prompt() 的角色/世界/故事/指令骨架
    action_prompt: str                     # 本轮玩家行动 prompt
    summary: str = ""                      # 早前剧情滚动摘要(已压缩)
    recall_block: str = ""                 # 向量召回片段(深度模式)
    dossier_block: str = ""                # Phase 2:在场实体既有事实档(按实体,权威事实源)
    abstain_note: str = ""                 # 具体事实查询的 abstention 硬指令(有据照实/无据认忘绝不编)
    recap: str = ""                        # 近期若干轮折叠文本(给折叠型适配器)
    recent_messages: list[dict] = field(default_factory=list)  # 近期原始多轮(给多轮型适配器)
    anchor: str = ""                       # 主线锚点
    esc_text: str = ""                     # 该主动恶化登场的事件(已渲染的行)
    clock_line: str = ""                   # 故事内时钟行(已渲染)


@runtime_checkable
class ModelAdapter(Protocol):
    """引擎与 LLM 之间的薄适配层。"""

    name: str

    def format_main(self, bundle: ContextBundle) -> list[dict]:
        """把 ContextBundle 组装成主回合的 messages 数组。"""
        ...

    def select_model(self, call_type: str) -> str | None:
        """按调用类型选模型;返回 None = 用 .env 默认 LLM_MODEL。

        call_type ∈ {main_turn, summary, json_repair, retry, memory_extract}。
        """
        ...

    async def complete_main(self, bundle: ContextBundle, *, json_mode: bool,
                            max_tokens: int, on_delta=None) -> str:
        """跑主回合 LLM 调用(流式),返回原始文本。"""
        ...


# ── DeepSeek 适配器(复刻当前行为)────────────────────────────────
# 关键约束:format_main 的输出必须跟重构前 story.py 的 system 拼装逐字节一致,
# 这样换上适配器后引擎行为零漂移(验收标准之一)。
class DeepSeekAdapter:
    """折叠型:历史折进 system,只发 [system, user]。

    DeepSeek 的 json_mode 一旦在 messages 里看到多轮 assistant 散文,会间歇吐空白,
    所以历史以引用文本形式折进 system(recap),不作为 assistant 消息。
    """

    name = "deepseek"

    def select_model(self, call_type: str) -> str | None:
        return None  # 全部用 .env 默认 LLM_MODEL(单模型,跟当前一致)

    def format_main(self, b: ContextBundle) -> list[dict]:
        system = b.skeleton
        if b.summary:
            system += "\n\n# 早前剧情摘要(更久之前发生的事,已压缩)\n" + b.summary
        if b.dossier_block:
            system += ("\n\n# 在场角色的既有事实档(按实体整理,权威事实源——回答既往具体事实优先据此;"
                       "其中没有的别硬编)\n" + b.dossier_block)
        if b.recall_block:
            system += "\n\n# 检索到的相关旧资料(向量召回,供参考,不要照抄)\n" + b.recall_block
        if b.recap:
            system += (
                "\n\n# 最近剧情(最近若干轮的实际经过,供你延续上下文与口吻)\n" + b.recap +
                "\n\n注意:以上是历史参考。最后一轮是你刚生成的——本轮绝不要重复它的叙述或台词;"
                "即便玩家这轮的意图和上一轮相同,也要让剧情往前走一步,给出新动作/新事实/新转折。"
            )
        if b.anchor:
            system += "\n\n# 主线锚点(始终牢记,别被支线噪音带偏)\n" + b.anchor
        if b.esc_text:
            system += (
                "\n\n# 该主动恶化登场的事件(故事内时间到点 / 主线停滞过久——让世界或相关角色主动把它推给玩家,"
                "别等玩家来碰;玩家本轮正面处理了就把它推进或在 timeline 标 resolved)\n" + b.esc_text
            )
        if b.clock_line:
            system += "\n\n# 故事内时钟\n" + b.clock_line
        if b.abstain_note:  # 放最后:具体事实查询的认忘指令,最高显著位(模型最后读到)
            system += "\n\n" + b.abstain_note
        return [{"role": "system", "content": system}, {"role": "user", "content": b.action_prompt}]

    async def complete_main(self, bundle: ContextBundle, *, json_mode: bool,
                            max_tokens: int, on_delta=None) -> str:
        messages = self.format_main(bundle)
        return await achat_messages_stream(
            messages, json_mode=json_mode, max_tokens=max_tokens,
            on_delta=on_delta, model=self.select_model("main_turn"),
        )


# ── Claude 适配器(证明模型无关 + 多模型路由)───────────────────────
# 演示性实现:formatting 是真的(真正多轮 + 区块标签),逐字节不同于 DeepSeek;
# 真要打到 Anthropic 端点需在 .env 配 Claude 兼容 base_url + model 名(transport 复用
# OpenAI 兼容协议)。这里证明的是「同一个 bundle,不同适配器产出不同 messages 结构」这个 seam。
class ClaudeAdapter:
    """多轮型:近期原文作为真实多轮 messages;设定 / 摘要 / 召回用区块标签放 system。"""

    name = "claude"

    def __init__(self, main_model: str | None = None, aux_model: str | None = None) -> None:
        self.main_model = main_model or os.getenv("CLAUDE_MAIN_MODEL", "claude-sonnet-4-6")
        self.aux_model = aux_model or os.getenv("CLAUDE_AUX_MODEL", "claude-haiku-4-5")

    def select_model(self, call_type: str) -> str | None:
        # 主回合用强模型;摘要 / 修复 / 重试 / 记忆抽取用便宜快模型。
        return self.main_model if call_type == "main_turn" else self.aux_model

    def format_main(self, b: ContextBundle) -> list[dict]:
        sys_parts = [b.skeleton]
        if b.summary:
            sys_parts.append("<early_summary>\n" + b.summary + "\n</early_summary>")
        if b.dossier_block:
            sys_parts.append("<entity_dossier note='权威事实源,优先据此答既往事实'>\n" + b.dossier_block + "\n</entity_dossier>")
        if b.recall_block:
            sys_parts.append("<retrieved_context>\n" + b.recall_block + "\n</retrieved_context>")
        if b.anchor:
            sys_parts.append("<main_anchor>\n" + b.anchor + "\n</main_anchor>")
        if b.esc_text:
            sys_parts.append("<due_escalations>\n" + b.esc_text + "\n</due_escalations>")
        if b.clock_line:
            sys_parts.append("<world_clock>\n" + b.clock_line + "\n</world_clock>")
        if b.abstain_note:  # 放最后:最高显著位
            sys_parts.append("<abstention priority='highest'>\n" + b.abstain_note + "\n</abstention>")
        system = "\n\n".join(sys_parts)

        messages: list[dict] = [{"role": "system", "content": system}]
        # Claude 不会因为看到多轮 assistant 散文吐空白 → 用真正的多轮历史(比折叠保真)。
        for m in b.recent_messages:
            role = m.get("role")
            if role in {"user", "assistant"} and str(m.get("content", "")).strip():
                messages.append({"role": role, "content": str(m["content"])})
        messages.append({"role": "user", "content": b.action_prompt})
        return messages

    async def complete_main(self, bundle: ContextBundle, *, json_mode: bool,
                            max_tokens: int, on_delta=None) -> str:
        messages = self.format_main(bundle)
        return await achat_messages_stream(
            messages, json_mode=json_mode, max_tokens=max_tokens,
            on_delta=on_delta, model=self.select_model("main_turn"),
        )


# ── 全局适配器(引擎按需取用;评测 / 测试可临时替换)──────────────────
_ADAPTERS: dict[str, ModelAdapter] = {
    "deepseek": DeepSeekAdapter(),
    "claude": ClaudeAdapter(),
}
_current_adapter: ModelAdapter = _ADAPTERS["deepseek"]


def get_adapter() -> ModelAdapter:
    return _current_adapter


def set_adapter(adapter: ModelAdapter | str) -> ModelAdapter:
    """切换全局适配器。传字符串走注册表,传实例直接用。返回切换后的适配器。"""
    global _current_adapter
    if isinstance(adapter, str):
        if adapter not in _ADAPTERS:
            raise KeyError(f"未注册的适配器: {adapter}; 已注册: {list(_ADAPTERS)}")
        _current_adapter = _ADAPTERS[adapter]
    else:
        _current_adapter = adapter
    return _current_adapter


def register_adapter(name: str, adapter: ModelAdapter) -> None:
    _ADAPTERS[name] = adapter


def adapter_from_env() -> ModelAdapter:
    """按 .env 的 MODEL_ADAPTER 选适配器(默认 deepseek),并设为全局。"""
    return set_adapter(os.getenv("MODEL_ADAPTER", "deepseek"))
