import { L } from "./i18n";

// 引用体系(F2 · AI 触点可控):把一张卡的核心字段拼成模型可读的紧凑文本。
// refs 通道单条 3000 字预算(后端 identify.py 截断),这里主动收敛到 2800 留余量。
// 字段名对齐 src/models.py(CharacterData / PlayerCard / WorldBook / StoryBook)。

const LIMIT = 2800;

function line(label, v) {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.filter(Boolean).join(L(", ", "、")) : String(v).trim();
  return s ? L(`${label}: ${s}\n`, `${label}:${s}\n`) : "";
}

export function cardToRefText(kind, data) {
  const d = data || {};
  let out = "";
  if (kind === "characters") {
    out =
      line(L("Name", "名字"), d.name) +
      line(L("Description", "设定"), d.description) +
      line(L("Personality", "性格"), d.personality) +
      line(L("Scenario", "情境"), d.scenario) +
      line(L("Opening line", "开场白"), d.first_mes) +
      line(L("Example dialogue", "对话范例"), d.mes_example) +
      line(L("Speech rules", "说话规则"), d.speech_rules) +
      line(L("Tags", "标签"), d.tags);
  } else if (kind === "players") {
    out =
      line(L("Name", "名字"), d.name) +
      line(L("Role", "身份"), d.role) +
      line(L("Background", "背景"), d.background) +
      line(L("Goals", "目标"), d.goals) +
      line(L("Abilities", "能力"), d.abilities) +
      line(L("Constraints", "限制"), d.constraints) +
      line(L("Known facts", "已知"), d.known_facts) +
      line(L("Opening", "开局"), d.opening);
  } else if (kind === "worlds") {
    out = line(L("World Book", "世界书"), d.name);
    for (const e of d.entries || []) {
      const keys = (e.keys || []).filter(Boolean).join("/");
      const c = String(e.content || "").trim();
      if (c) out += `- ${keys ? keys + L(": ", ":") : ""}${c}\n`;
      if (out.length > LIMIT) break;
    }
  } else if (kind === "stories") {
    out =
      line(L("Title", "标题"), d.title) +
      line(L("Premise", "前提"), d.premise) +
      line(L("Timeline", "时间线"), d.timeline) +
      line(L("Main plot", "主线"), d.main_plot) +
      line(L("Freedom rules", "自由度规则"), d.freedom_rules);
  }
  // 兜底:未识别的形状(或字段全空)直接给 JSON 片段,宁可粗也别丢
  if (!out.trim()) {
    try {
      out = JSON.stringify(d, null, 0);
    } catch {
      out = "";
    }
  }
  return out.trim().slice(0, LIMIT);
}

/** 卡/提示词 → 引用纸签对象(desk.refs 元素;后端 refs 通道形状 {label, text})。 */
export function makeRef(type, label, text) {
  return {
    type, // 'card' | 'prompt' | 'text'
    label: String(label || "").trim().slice(0, 60) || L("Reference", "参考"),
    text: String(text || "").trim().slice(0, 3000),
  };
}
