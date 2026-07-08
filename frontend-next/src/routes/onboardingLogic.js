const NAME_PREFIX_RE =
  /^(?:我(?:的)?名字(?:就)?(?:叫|是)|我(?:就)?叫|叫我|称呼我(?:为)?|可以叫我|你可以叫我|我是)\s*[：:，,、-]?\s*(.+)$/;

function chars(s) {
  return Array.from(String(s || "").trim());
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[“”"'\s。？！?！,，、.·~～…—\-_:：；;（）()【】\[\]《》<>]/g, "");
}

function cleanNameCandidate(s) {
  let out = String(s || "")
    .trim()
    .replace(/^[“”"'「『《<【\s]+|[“”"'」』》>】\s]+$/g, "")
    .replace(/^(?:就叫|叫做|叫)\s*/, "")
    .trim();
  out = out.split(/[，,。.!！?？；;]/)[0].trim();
  return out.replace(/[~～…]+$/g, "").trim();
}

function hasUsableNameShape(name) {
  const n = normalizeText(name);
  if (!n) return false;
  if (/^(你|我|他|她|它|谁|啥|什么)$/.test(n)) return false;
  if (/^(你叫|叫什么|你叫什么|糖沐叫什么)/.test(n)) return false;
  return /[\p{Script=Han}a-z0-9]/iu.test(n);
}

function looksOddName(name) {
  const n = normalizeText(name);
  const len = chars(n).length;
  if (!n) return false;
  if (len > 8) return true;
  if (/^\d+$/.test(n)) return true;
  if (/^(.)\1{2,}$/.test(n)) return true;
  if (/[!！?？~～…]{2,}/.test(name)) return true;
  if (/(炒股|暴富|发财|韭菜|爸爸|爸妈|妈妈|你爹|爹|老公|老婆|主人|全世界|最帅|最美|傻|笨|屎|尿|屁|滚|杀|死|sb|傻逼)/i.test(n)) {
    return true;
  }
  if (n.includes("的") && len >= 5) return true;
  return false;
}

export function analyzeNameInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return { value: "", needsConfirm: false, reason: null };
  const compact = normalizeText(text);
  if (/你.*叫.*(什么|啥|吗|呀|啊)?$/.test(compact) || /糖沐.*叫/.test(compact)) {
    return { value: "", needsConfirm: false, reason: null };
  }

  const prefixed = text.match(NAME_PREFIX_RE);
  if (!prefixed && /(这|那|店|好看|谢谢|你好|嗨|哈|什么|怎么|为啥|可以|能不能|呀|呢|吗|啊)/.test(compact)) {
    return { value: "", needsConfirm: false, reason: null };
  }
  const candidate = cleanNameCandidate(prefixed ? prefixed[1] : text);
  if (!hasUsableNameShape(candidate)) return { value: "", needsConfirm: false, reason: null };
  const needsConfirm = looksOddName(candidate);
  return { value: candidate, needsConfirm, reason: needsConfirm ? "odd" : null };
}

const CHIP_SYNONYMS = [
  { key: "带我认认这儿", words: ["带我认认", "认认这儿", "介绍一下", "逛逛", "看看这里", "认识这里"] },
  { key: "然后呢", words: ["然后", "然后呢", "接着", "继续说", "说下去", "往下", "下一步", "下一个", "还有呢"] },
  { key: "还有吗", words: ["还有", "还有吗", "接着", "继续", "下一步", "下一个"] },
  { key: "继续", words: ["继续", "继续说", "接着", "下一步", "下一个", "往下"] },
  { key: "最后一个", words: ["最后", "最后一个", "下一步", "下一个", "继续"] },
  { key: "还没看什么", words: ["还没看", "没看什么", "没有", "暂时没有", "想不起来", "不知道", "没想好"] },
  { key: "用名字字头就好", words: ["字头", "用名字", "不用头像", "不传头像", "跳过头像", "先不传", "好了继续", "好了", "继续"] },
  { key: "带我进第一本书", words: ["进第一本", "第一本书", "开始看", "开始故事", "去探索", "带我进"] },
  { key: "我自己逛逛", words: ["自己逛", "自己看看", "我自己", "随便逛", "先不用"] },
];

function wordsForChip(label) {
  const normalizedLabel = normalizeText(label);
  const base = [label, normalizedLabel];
  for (const item of CHIP_SYNONYMS) {
    if (normalizeText(item.key) === normalizedLabel) return [...base, ...item.words];
  }
  return base;
}

export function matchChipIntent(raw, chips) {
  const text = normalizeText(raw);
  if (!text || !Array.isArray(chips)) return null;
  for (const chip of chips) {
    const words = wordsForChip(chip && chip.label);
    for (const word of words) {
      const w = normalizeText(word);
      if (w && (text.includes(w) || w.includes(text))) return chip;
    }
  }
  return null;
}
