// 提示词库(F1 · AI 触点可控):用户自存的 prompt 片段,本机 localStorage。
// 引用面板「提示词」tab 的数据源;任何 AI 触点可 refer。跨设备同步不在本期(如实)。

const KEY = "ais_prompt_lib_v1";
const CAP = 50;

export function loadPrompts() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((p) => p && p.id && typeof p.text === "string" && p.text.trim()) : [];
  } catch {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
  } catch {
    /* 存储满/隐私模式:静默,内存态仍可用 */
  }
  return list.slice(0, CAP);
}

export function addPrompt(name, text) {
  const t = String(text || "").trim();
  if (!t) return loadPrompts();
  const item = {
    id: "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(name || "").trim() || t.slice(0, 16),
    text: t.slice(0, 3000),
    ts: Date.now(),
  };
  return persist([item, ...loadPrompts()]);
}

export function removePrompt(id) {
  return persist(loadPrompts().filter((p) => p.id !== id));
}

export function renamePrompt(id, name) {
  const n = String(name || "").trim();
  return persist(loadPrompts().map((p) => (p.id === id && n ? { ...p, name: n.slice(0, 40) } : p)));
}
