const NAME_PREFIX_RE =
  /^(?:我(?:的)?名字(?:就)?(?:叫|是|写)|名字(?:就)?(?:叫|是|写)|我(?:就)?叫|叫我|称呼我(?:为)?|可以叫我|你可以叫我|我是|my name is|call me|i am|i'm)\s*[：:，,、-]?\s*(.+)$/i;

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
    .replace(/^(?:就叫|叫做|叫|就写|写成|改成|换成)\s*/, "")
    .trim();
  out = out.split(/[，,。.!！?？；;]/)[0].trim();
  return out
    .replace(/[~～…]+$/g, "")
    .replace(/\s*(?:吧|啦|呀|啊|哦|呢|哈)$/g, "")
    .trim();
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
  if (/你.*叫.*(什么|啥|吗|呀|啊)$/.test(compact) || /糖沐.*叫/.test(compact)) {
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

export function analyzeNameCorrectionInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return { value: "", needsConfirm: false, reason: null };
  const rest = text.replace(/^(?:不是|不是的|不对|换|重来|重新|别写|不要|算了|逗你|开玩笑)\s*[，,。.!！?？、-]?\s*/, "").trim();
  if (!rest || rest === text || /^(吧|啦|呀|啊|哦|呢|哈)$/.test(normalizeText(rest))) {
    return { value: "", needsConfirm: false, reason: null };
  }
  return analyzeNameInput(rest);
}

const CHIP_SYNONYMS = [
  { key: "带我认认这儿", words: ["带我认认", "认认这儿", "介绍一下", "逛逛", "看看这里", "认识这里", "带我看看", "带我逛", "带路", "show me around", "take me around"] },
  { key: "然后呢", words: ["然后", "然后呢", "接着", "继续说", "说下去", "往下", "下一步", "下一个", "还有呢", "next", "go on", "continue"] },
  { key: "还有吗", words: ["还有", "还有吗", "接着", "继续", "下一步", "下一个", "next", "go on", "continue"] },
  { key: "继续", words: ["继续", "继续说", "继续讲", "接着", "下一步", "下一个", "往下", "next", "go on", "continue"] },
  { key: "最后一个", words: ["最后", "最后一个", "最后吧", "下一步", "下一个", "继续", "last one", "last"] },
  { key: "还没看什么", words: ["还没看", "没看什么", "没有", "暂时没有", "想不起来", "不知道", "没想好"] },
  { key: "用名字字头就好", words: ["字头", "用名字", "不用头像", "不传头像", "跳过头像", "头像跳过", "先不传", "好了继续", "好了", "继续", "no avatar", "skip avatar", "without avatar"] },
  { key: "带我进第一本书", words: ["进第一本", "第一本书", "开始看", "开始故事", "去探索", "带我进", "start the first story", "first story"] },
  { key: "我自己逛逛", words: ["自己逛", "自己看看", "我自己", "随便逛", "先不用"] },
];

const PROGRESS_CHIP_KEYS = new Set(["带我认认这儿", "然后呢", "还有吗", "继续", "最后一个", "用名字字头就好", "带我进第一本书"].map(normalizeText));
const AFFIRM_CONTINUE_EXACT = new Set(["ok", "okay", "yes", "yep", "sure", "好", "好的", "好呀", "好啊", "嗯", "嗯嗯", "可以", "行", "了解", "知道了", "明白", "收到"].map(normalizeText));
const AFFIRM_CONTINUE_WORDS = ["继续", "接着", "下一步", "下一个", "往下", "说下去", "继续说", "继续讲", "继续介绍", "带我看看", "带我逛", "带路", "show me around", "take me around", "next", "go on", "continue"];

function wordsForChip(label) {
  const normalizedLabel = normalizeText(label);
  const base = [label, normalizedLabel];
  for (const item of CHIP_SYNONYMS) {
    if (normalizeText(item.key) === normalizedLabel) return [...base, ...item.words];
  }
  return base;
}

function isProgressChip(chip) {
  return chip && PROGRESS_CHIP_KEYS.has(normalizeText(chip.label));
}

function isAffirmingContinue(raw) {
  const text = normalizeText(raw);
  if (!text) return false;
  if (AFFIRM_CONTINUE_EXACT.has(text)) return true;
  return AFFIRM_CONTINUE_WORDS.some((word) => {
    const w = normalizeText(word);
    return w && text.includes(w);
  });
}

function contextualProgressChip(raw, chips) {
  if (!isAffirmingContinue(raw)) return null;
  const progress = (chips || []).filter((chip) => isProgressChip(chip) && (chip.next || chip.to || chip.done));
  return progress.length === 1 ? progress[0] : null;
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
  return contextualProgressChip(raw, chips);
}

export function parseChipIntentReply(raw, chips) {
  const text = String(raw || "").trim();
  if (!text) return { chip: null, chat: null };
  const chipMatch = text.match(/^\s*\[(?:CHIP|ACTION)\s*:?\s*(\d+)\]\s*/i);
  if (chipMatch) {
    const index = Number(chipMatch[1]);
    const chip = Array.isArray(chips) && Number.isInteger(index) ? chips[index] : null;
    return { chip: chip || null, chat: null };
  }
  const chatMatch = text.match(/^\s*\[CHAT\]\s*/i);
  if (chatMatch) return { chip: null, chat: text.slice(chatMatch[0].length).trim() || null };
  return { chip: null, chat: text };
}
