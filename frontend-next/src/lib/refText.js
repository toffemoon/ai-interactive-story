// 引用体系(F2 · AI 触点可控):把一张卡的核心字段拼成模型可读的紧凑文本。
// refs 通道单条 3000 字预算(后端 identify.py 截断),这里主动收敛到 2800 留余量。
// 字段名对齐 src/models.py(CharacterData / PlayerCard / WorldBook / StoryBook)。

const LIMIT = 2800;

function line(label, v) {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v).trim();
  return s ? `${label}: ${s}\n` : "";
}

export function cardToRefText(kind, data) {
  const d = data || {};
  let out = "";
  if (kind === "characters") {
    out =
      line("Name", d.name) +
      line("Description", d.description) +
      line("Personality", d.personality) +
      line("Scenario", d.scenario) +
      line("Opening line", d.first_mes) +
      line("Example dialogue", d.mes_example) +
      line("Speech rules", d.speech_rules) +
      line("Tags", d.tags);
  } else if (kind === "players") {
    out =
      line("Name", d.name) +
      line("Role", d.role) +
      line("Background", d.background) +
      line("Goals", d.goals) +
      line("Abilities", d.abilities) +
      line("Constraints", d.constraints) +
      line("Known facts", d.known_facts) +
      line("Opening", d.opening);
  } else if (kind === "worlds") {
    out = line("World Book", d.name);
    for (const e of d.entries || []) {
      const keys = (e.keys || []).filter(Boolean).join("/");
      const c = String(e.content || "").trim();
      if (c) out += `- ${keys ? keys + ": " : ""}${c}\n`;
      if (out.length > LIMIT) break;
    }
  } else if (kind === "stories") {
    out =
      line("Title", d.title) +
      line("Premise", d.premise) +
      line("Timeline", d.timeline) +
      line("Main plot", d.main_plot) +
      line("Freedom rules", d.freedom_rules);
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
    label: String(label || "").trim().slice(0, 60) || "Reference",
    text: String(text || "").trim().slice(0, 3000),
  };
}
