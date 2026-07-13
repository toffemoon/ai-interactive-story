const NAME_PREFIX_RE =
  /^(?:我(?:的)?名字(?:就)?(?:叫|是|写)|名字(?:就)?(?:叫|是|写)|我(?:就)?叫|(?:就)?叫我|称呼我(?:为)?|可以叫我|你可以叫我|我是|my name is|call me|i am|i'm)\s*[：:，,、-]?\s*(.+)$/i;
const NAME_AS_NAME_RE = /^(?:我(?:就)?用\s*)?(.+?)\s*作为(?:我(?:的)?)?名字(?:吧|啦|了|啊|呀|呢)?[。！？!?，,；;]*$/i;
const NAME_POSITIVE_USE_RE = /^我(?:就)?用\s*/;
const NAME_REJECTION_RE = /^(?:请\s*)?(?:我\s*)?(?:(?:不要|不想|不愿|不能|不准|不应该)(?:再)?\s*(?:用|把|叫|写|拿|将|让)?|别(?:再)?\s*(?:用|把|叫|写|拿|将|让))/;
const NAME_REJECTED_CANDIDATE_START_RE = /^(?:请)?(?:我)?(?:可)?(?:不是要|不要|不想|不愿|不能|不准|不应该|别(?:再|把)?)/;
const NAME_REJECTED_CANDIDATE_END_RE = /不(?:是|应(?:该)?|想|愿|能|准)?$/;

function chars(s) {
  return Array.from(String(s || "").trim());
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[“”"'\s。？！?！,，、.·~～…—\-_:：；;（）()【】\[\]《》<>]/g, "");
}

function isRejectedNameStatement(text) {
  if (NAME_REJECTION_RE.test(text)) return true;
  const suffix = text.match(NAME_AS_NAME_RE);
  if (!suffix || NAME_POSITIVE_USE_RE.test(text)) return false;
  const candidate = suffix[1].replace(/\s/g, "");
  return NAME_REJECTED_CANDIDATE_START_RE.test(candidate) || NAME_REJECTED_CANDIDATE_END_RE.test(candidate);
}

function explicitNameMatch(raw) {
  const text = String(raw || "").trim();
  if (isRejectedNameStatement(text)) return null;
  return text.match(NAME_PREFIX_RE) || text.match(NAME_AS_NAME_RE);
}

export function isExplicitNameSubmission(raw) {
  return Boolean(explicitNameMatch(raw));
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

function looksLikeNonNameCandidate(name) {
  const n = normalizeText(name);
  if (!n) return true;
  if (/^(来看看|看看|随便看看|逛逛|路过|来逛逛|进来看看|先看看|看一下|来看书|进店|入店)$/.test(n)) return true;
  if (/^(头像|照片|头图|传头像|上传头像|不传头像|跳过头像|用字头|用名字字头|avatar|photo)$/.test(n)) return true;
  if (/^(好|好的|ok|okay|yes|no|不用|不要|跳过|继续|下一步|然后呢|还有吗)$/.test(n)) return true;
  return false;
}

function looksStructurallyOddName(name) {
  const n = normalizeText(name);
  if (!n) return false;
  if (/^\d+$/.test(n)) return true;
  if (/[a-z]/i.test(n) && /\d/.test(n)) return true;
  if (/^(.)\1{2,}$/.test(n)) return true;
  if (/[!！?？~～…]{2,}/.test(name)) return true;
  if (/(炒股|暴富|发财|韭菜|爸爸|爸妈|妈妈|你爹|爹|老公|老婆|主人|全世界|最帅|最美|傻|笨|屎|尿|屁|滚|杀|死|sb|傻逼)/i.test(n)) {
    return true;
  }
  if (n.includes("的") && chars(n).length >= 5) return true;
  return false;
}

function looksOddName(name) {
  return chars(normalizeText(name)).length > 8 || looksStructurallyOddName(name);
}

export function analyzeNameInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return { value: "", needsConfirm: false, reason: null };
  if (isRejectedNameStatement(text)) return { value: "", needsConfirm: false, reason: null };
  const compact = normalizeText(text);
  if (/你.*叫.*(什么|啥|吗|呀|啊)$/.test(compact) || /糖沐.*叫/.test(compact)) {
    return { value: "", needsConfirm: false, reason: null };
  }

  const prefixed = explicitNameMatch(text);
  if (!prefixed && /(这|那|店|好看|谢谢|你好|嗨|哈|什么|怎么|为啥|可以|能不能|呀|呢|吗|啊)/.test(compact)) {
    return { value: "", needsConfirm: false, reason: null };
  }
  const candidate = cleanNameCandidate(prefixed ? prefixed[1] : text);
  if (looksLikeNonNameCandidate(candidate)) return { value: "", needsConfirm: false, reason: null };
  if (!hasUsableNameShape(candidate)) return { value: "", needsConfirm: false, reason: null };
  const needsConfirm = looksOddName(candidate);
  return { value: candidate, needsConfirm, reason: needsConfirm ? "odd" : null };
}

export function shouldAcceptNameLocally(raw) {
  const parsed = analyzeNameInput(raw);
  return Boolean(parsed.value && isExplicitNameSubmission(raw));
}

export function shouldConfirmBareNameLocally(raw) {
  const parsed = analyzeNameInput(raw);
  return Boolean(parsed.value && !isExplicitNameSubmission(raw) && looksStructurallyOddName(parsed.value));
}

export function analyzeNameCorrectionInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return { value: "", needsConfirm: false, reason: null };
  const cueMatches = [...text.matchAll(/(?:叫我|叫|改成|换成|写成|写)\s*([^，,。.!！?？；;、]+)/g)];
  if (cueMatches.length) {
    const last = cueMatches[cueMatches.length - 1];
    const parsed = analyzeNameInput(last[1]);
    if (parsed.value) return parsed;
  }
  const rest = text.replace(/^(?:不是|不是的|不对|换|重来|重新|别写|不要|算了|逗你|开玩笑)\s*[，,。.!！?？、-]?\s*/, "").trim();
  if (!rest || rest === text || /^(吧|啦|呀|啊|哦|呢|哈)$/.test(normalizeText(rest))) {
    return { value: "", needsConfirm: false, reason: null };
  }
  return analyzeNameInput(rest);
}

export function analyzePendingNameInput(raw, pendingValue) {
  const pending = cleanNameCandidate(pendingValue);
  if (!pending) return { intent: "unknown", value: "", needsConfirm: false, reason: null };
  const correction = analyzeNameCorrectionInput(raw);
  if (!correction.value) return { intent: "unknown", value: "", needsConfirm: false, reason: null };
  if (normalizeText(correction.value) === normalizeText(pending)) {
    return { intent: "confirm", value: pending, needsConfirm: false, reason: null };
  }
  return { intent: "change", ...correction };
}

const CHIP_SYNONYMS = [
  { key: "带我认认这儿", words: ["带我认认", "认认这儿", "介绍一下", "逛逛", "看看这里", "认识这里", "带我看看", "带我逛", "带路", "show me around", "take me around"] },
  { key: "然后呢", words: ["然后", "然后呢", "接着", "继续说", "说下去", "往下", "下一步", "下一个", "还有呢", "next", "go on", "continue"] },
  { key: "还有吗", words: ["还有", "还有吗", "接着", "继续", "下一步", "下一个", "next", "go on", "continue"] },
  { key: "继续", words: ["继续", "继续说", "继续讲", "接着", "下一步", "下一个", "往下", "next", "go on", "continue"] },
  { key: "最后一个", words: ["最后", "最后一个", "最后吧", "下一步", "下一个", "继续", "last one", "last"] },
  { key: "还没看什么", words: ["还没看", "没看什么", "没读书", "没看书", "没在读", "没有读", "没有看", "没有", "暂时没有", "想不起来", "不知道", "没想好"] },
  { key: "＋ 传张头像", words: ["传头像", "上传头像", "传张头像", "传图", "上传图片", "上传照片", "照片", "photo", "upload avatar", "upload photo"] },
  { key: "用名字字头就好", words: ["字头", "用名字", "不用头像", "不传头像", "跳过头像", "头像跳过", "先不传", "好了继续", "好了", "继续", "no avatar", "skip avatar", "without avatar"] },
  { key: "拿一本看看", words: ["拿一本", "给我看", "下一本", "看一本", "拿书", "看看书卡", "看书卡"] },
  { key: "继续看角色", words: ["看角色", "继续看角色", "角色卡", "下一个", "继续", "next", "go on", "continue"] },
  { key: "把宣喊出来", words: ["把宣喊出来", "喊宣", "叫宣", "宣出来", "把她喊出来", "叫她出来", "喊出来"] },
  { key: "听糖沐解释", words: ["听糖沐", "解释", "怎么喊出来", "继续", "下一步", "next", "go on", "continue"] },
  { key: "互相介绍", words: ["互相介绍", "介绍一下", "介绍", "继续", "下一步", "next", "go on", "continue"] },
  { key: "和宣打招呼", words: ["打招呼", "和宣打招呼", "跟宣打招呼", "你好", "继续", "下一步", "next", "go on", "continue"] },
  { key: "问她一句", words: ["问一句", "问她", "聊一句", "和宣聊", "说一句"] },
  { key: "叫宣出来看看", words: ["叫宣", "宣出来", "叫角色", "叫她", "叫出来", "把人请出来", "角色聊天", "聊天看看", "叫她出来"] },
  { key: "继续看创作", words: ["继续看创作", "看创作", "创作", "工坊", "继续", "下一步", "下一个", "然后", "next", "go on", "continue"] },
  { key: "收尾吧", words: ["收尾", "结束引导", "最后", "继续", "下一步", "下一个", "next", "go on", "continue"] },
  { key: "去故事广场看看", words: ["故事广场", "去故事广场", "看看故事", "去探索", "探索故事", "explore stories"] },
  { key: "我自己逛逛", words: ["自己逛", "自己看看", "我自己", "随便逛", "先不用"] },
];

const PROGRESS_CHIP_KEYS = new Set(["带我认认这儿", "然后呢", "还有吗", "继续", "最后一个", "用名字字头就好", "拿一本看看", "继续看角色", "把宣喊出来", "听糖沐解释", "互相介绍", "和宣打招呼", "问她一句", "叫宣出来看看", "继续看创作", "收尾吧", "去故事广场看看"].map(normalizeText));
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

export function isExactFillChipSubmission(raw, chip) {
  if (!chip || chip.fill == null) return false;
  if (chip.next || chip.set || chip.to || chip.done || chip.upload || chip.confirmName || chip.retryName) return false;
  return String(raw || "").trim() === String(chip.fill || "").trim();
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

function isTasteSkipChip(chip) {
  return normalizeText(chip && chip.label) === normalizeText("还没看什么");
}

function isUnambiguousTasteSkip(raw) {
  const text = normalizeText(raw);
  if (!text || /不是没有|但|不过|其实|在看|在读|在追|推荐|有没有/.test(text)) return false;
  return /^(?:我)?(?:最近|现在|暂时)?(?:还没|没有|没在|没)(?:看|读|追)?(?:过)?(?:什么|啥)?(?:书|故事|作品|内容|东西)?$/.test(text) ||
    /^(?:想不起来|不知道|没想好)$/.test(text);
}

function hasNegatedAvatarUpload(raw) {
  const text = normalizeText(raw);
  return /(?:不要|不用|不想|不传|别|无需|没必要)(?:上传|传|选|换|用|放)*(?:头像|照片|图片|图)/.test(text) ||
    /(?:no|without|skip)(?:avatar|photo)/i.test(text);
}

export function matchChipIntent(raw, chips) {
  const text = normalizeText(raw);
  if (!text || !Array.isArray(chips)) return null;
  const uploadChip = chips.find((chip) => Boolean(chip && chip.upload));
  const avatarSkipChip = uploadChip
    ? chips.find((chip) => chip && !chip.upload && /字头|跳过头像|不传头像/.test(normalizeText(chip.label)))
    : null;
  if (avatarSkipChip && hasNegatedAvatarUpload(raw)) return avatarSkipChip;
  for (const chip of chips) {
    if (isTasteSkipChip(chip) && !isUnambiguousTasteSkip(raw)) continue;
    const words = wordsForChip(chip && chip.label);
    for (const word of words) {
      const normalizedWord = normalizeText(word);
      if (normalizedWord && text.includes(normalizedWord)) return chip;
    }
  }
  return contextualProgressChip(raw, chips);
}

export function resolveAutoAdvancePlan({
  autoNext = null,
  autoMs = 0,
  nextOverride = null,
  inputFocused = false,
  hasDraft = false,
  menuOpen = false,
  replyBlocked = false,
} = {}) {
  const pauseReasons = [];
  if (inputFocused) pauseReasons.push("focus");
  if (hasDraft) pauseReasons.push("draft");
  if (menuOpen) pauseReasons.push("menu");
  if (replyBlocked) pauseReasons.push("pending-reply");
  return {
    pauseReasons,
    shouldSchedule: Boolean(autoNext) && pauseReasons.length === 0,
    nextId: autoNext ? nextOverride || autoNext : null,
    delay: Number(autoMs) || 0,
  };
}

export function isCurrentOnboardingInteraction({ requestEpoch, currentEpoch, requestBeatId, currentBeatId } = {}) {
  return requestEpoch === currentEpoch && requestBeatId === currentBeatId;
}

export function shouldCommitPortraitPreload({ requestEpoch, currentEpoch, eventType, naturalWidth } = {}) {
  return requestEpoch === currentEpoch && eventType === "load" && Number(naturalWidth) > 0;
}

export function usesFlowOnboardingBubbleLayout({ width, height, demoType } = {}) {
  const isNarrowOrPortrait = width <= 720 || height > width;
  const isCompactCardDemo = ["story", "characterCard"].includes(demoType) && width <= 1100 && height <= 700;
  return isNarrowOrPortrait || isCompactCardDemo;
}

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function overlapsRect(a, b) {
  return !(a.left + a.width <= b.left || a.left >= b.right || a.top + a.height <= b.top || a.top >= b.bottom);
}

function roundPlacement(rect) {
  return {
    ...rect,
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function resolveVisibleImageRect({
  box,
  naturalSize,
  alphaBounds,
  alignX = 0.5,
  alignY = 1,
} = {}) {
  const boxLeft = Number(box && box.left);
  const boxTop = Number(box && box.top);
  const boxWidth = Number(box && box.width);
  const boxHeight = Number(box && box.height);
  const naturalWidth = Number(naturalSize && naturalSize.width);
  const naturalHeight = Number(naturalSize && naturalSize.height);
  const alphaLeft = Number(alphaBounds && alphaBounds.left);
  const alphaTop = Number(alphaBounds && alphaBounds.top);
  const alphaRight = Number(alphaBounds && alphaBounds.right);
  const alphaBottom = Number(alphaBounds && alphaBounds.bottom);
  if (![
    boxLeft,
    boxTop,
    boxWidth,
    boxHeight,
    naturalWidth,
    naturalHeight,
    alphaLeft,
    alphaTop,
    alphaRight,
    alphaBottom,
  ].every(Number.isFinite)) return null;
  if (boxWidth <= 0 || boxHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null;

  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const contentWidth = naturalWidth * scale;
  const contentHeight = naturalHeight * scale;
  const contentLeft = boxLeft + (boxWidth - contentWidth) * clampValue(Number(alignX), 0, 1);
  const contentTop = boxTop + (boxHeight - contentHeight) * clampValue(Number(alignY), 0, 1);
  return {
    left: contentLeft + alphaLeft * scale,
    top: contentTop + alphaTop * scale,
    right: contentLeft + alphaRight * scale,
    bottom: contentTop + alphaBottom * scale,
  };
}

export function resolveChatStageLayout({
  viewportHeight,
  dockTop,
  narrow = false,
  padding = 24,
  gap = 16,
} = {}) {
  const height = Number(viewportHeight);
  const dockBoundary = Number(dockTop);
  const safePadding = Math.max(0, Number(padding) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);
  if (![height, dockBoundary].every(Number.isFinite) || height <= 0 || dockBoundary <= 0) return null;
  const availableHeight = Math.max(0, dockBoundary - safeGap - safePadding);
  return {
    bottom: Math.round(Math.max(0, height - dockBoundary + safeGap)),
    height: Math.round(Math.min(narrow ? 320 : 520, availableHeight)),
  };
}

export function resolveChatBubblePlacement({
  viewport,
  speakerRect,
  avoidRects = [],
  bubbleSize,
  dockTop,
  preferredSide = "right",
  padding = 24,
  gap = 16,
} = {}) {
  const viewportWidth = Number(viewport && viewport.width);
  const viewportHeight = Number(viewport && viewport.height);
  const speaker = {
    left: Number(speakerRect && speakerRect.left),
    top: Number(speakerRect && speakerRect.top),
    right: Number(speakerRect && speakerRect.right),
    bottom: Number(speakerRect && speakerRect.bottom),
  };
  const requestedWidth = Number(bubbleSize && bubbleSize.width);
  const requestedHeight = Number(bubbleSize && bubbleSize.height);
  if (
    ![viewportWidth, viewportHeight, speaker.left, speaker.top, speaker.right, speaker.bottom, requestedWidth, requestedHeight].every(Number.isFinite) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    requestedWidth <= 0 ||
    requestedHeight <= 0
  ) return null;

  const extraObstacles = (Array.isArray(avoidRects) ? avoidRects : [])
    .map((rect) => ({
      left: Number(rect && rect.left),
      top: Number(rect && rect.top),
      right: Number(rect && rect.right),
      bottom: Number(rect && rect.bottom),
    }))
    .filter((rect) => [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite));
  const obstacles = [speaker, ...extraObstacles];
  const overlapsObstacle = (rect) => obstacles.some((obstacle) => overlapsRect(rect, obstacle));

  const safePadding = Math.max(0, Number(padding) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);
  const safeLeft = safePadding;
  const safeRight = Math.max(safeLeft, viewportWidth - safePadding);
  const safeTop = safePadding;
  const dockBoundary = Number.isFinite(Number(dockTop)) ? Number(dockTop) - safeGap : viewportHeight - safePadding;
  const safeBottom = Math.max(safeTop, Math.min(viewportHeight - safePadding, dockBoundary));
  const width = Math.min(requestedWidth, safeRight - safeLeft);
  const height = Math.min(requestedHeight, safeBottom - safeTop);
  if (width <= 0 || height <= 0) return null;

  const top = clampValue((speaker.top + speaker.bottom - height) / 2, safeTop, safeBottom - height);
  const sides = preferredSide === "left" ? ["left", "right"] : ["right", "left"];
  const makeSideRect = (side, candidateWidth, compact) => {
    const left = side === "left" ? speaker.left - safeGap - candidateWidth : speaker.right + safeGap;
    const rect = { left, top, width: candidateWidth, height, compact };
    if (left < safeLeft || left + candidateWidth > safeRight || overlapsObstacle(rect)) return null;
    return rect;
  };

  for (const side of sides) {
    const rect = makeSideRect(side, width, false);
    if (rect) return roundPlacement(rect);
  }

  const sideSpace = {
    left: Math.max(0, speaker.left - safeGap - safeLeft),
    right: Math.max(0, safeRight - speaker.right - safeGap),
  };
  const compactSide = [...sides].sort((a, b) => sideSpace[b] - sideSpace[a])[0];
  const compactWidth = Math.min(width, sideSpace[compactSide]);
  if (compactWidth > 0) {
    const rect = makeSideRect(compactSide, compactWidth, true);
    if (rect) return roundPlacement(rect);
  }

  const centeredLeft = clampValue((speaker.left + speaker.right - width) / 2, safeLeft, safeRight - width);
  for (const candidateTop of [speaker.top - safeGap - height, speaker.bottom + safeGap]) {
    const rect = { left: centeredLeft, top: candidateTop, width, height, compact: true };
    if (candidateTop >= safeTop && candidateTop + height <= safeBottom && !overlapsObstacle(rect)) {
      return roundPlacement(rect);
    }
  }

  const cornerCandidates = [
    { left: safeLeft, top: safeTop },
    { left: safeRight - width, top: safeTop },
    { left: safeLeft, top: safeBottom - height },
    { left: safeRight - width, top: safeBottom - height },
  ];
  for (const candidate of cornerCandidates) {
    const rect = { ...candidate, width, height, compact: true };
    if (!overlapsObstacle(rect)) return roundPlacement(rect);
  }

  const safeHeight = safeBottom - safeTop;
  const minimumStageHeight = Math.min(180, Math.max(72, Math.round(safeHeight * 0.5)));
  const maxBubbleBandHeight = safeHeight - safeGap - minimumStageHeight;
  if (maxBubbleBandHeight <= 0) return null;

  const bubbleBand = roundPlacement({
    left: safeLeft,
    top: safeTop,
    width: safeRight - safeLeft,
    height: Math.min(height, maxBubbleBandHeight),
  });
  const characterStageTop = Math.round(bubbleBand.top + bubbleBand.height + safeGap);
  const characterStage = {
    left: Math.round(safeLeft),
    top: characterStageTop,
    width: Math.round(safeRight - safeLeft),
    height: Math.max(0, Math.floor(safeBottom - characterStageTop)),
  };
  if (bubbleBand.height <= 0 || characterStage.height <= 0) return null;
  return {
    ...bubbleBand,
    compact: true,
    flowFallback: true,
    bubbleBand,
    characterStage,
  };
}

export function hasRestoredHomeConversation(snapshot) {
  return Boolean(snapshot && snapshot.card && Array.isArray(snapshot.msgs) && snapshot.msgs.length > 0);
}

export const INITIAL_ONBOARDING_AUTO_CONTROL = Object.freeze({
  interactionEpoch: 0,
  nextOverride: null,
  replyState: "idle",
});

export function transitionOnboardingAutoControl(control = INITIAL_ONBOARDING_AUTO_CONTROL, event = {}) {
  const current = { ...INITIAL_ONBOARDING_AUTO_CONTROL, ...control };
  if (event.type === "send" || event.type === "retry" || event.type === "request-start") {
    return {
      control: { interactionEpoch: current.interactionEpoch + 1, nextOverride: null, replyState: "pending" },
      blurComposer: event.type !== "request-start",
      applied: true,
    };
  }
  if (event.type === "invalidate") {
    return {
      control: { interactionEpoch: current.interactionEpoch + 1, nextOverride: null, replyState: "idle" },
      blurComposer: false,
      applied: true,
    };
  }
  if (event.type === "reply-success" || event.type === "reply-failure" || event.type === "reply-settled") {
    if (event.interactionEpoch !== current.interactionEpoch) {
      return { control: current, blurComposer: false, applied: false };
    }
    return {
      control: {
        ...current,
        nextOverride: event.type === "reply-success" ? "tryCreate" : null,
        replyState: event.type === "reply-failure" ? "failed" : "idle",
      },
      blurComposer: false,
      applied: true,
    };
  }
  return { control: current, blurComposer: false, applied: false };
}

export function parseFieldIntentReply(raw, { requireTag = false, allowNone = true } = {}) {
  const text = String(raw || "").trim();
  if (!text) return { intent: "retry", text: null };
  const m = text.match(/^\s*\[(OK|NONE|CHAT|MEME)\]\s*/i);
  if (!m) return requireTag ? { intent: "retry", text: null } : { intent: "answer", text };
  const tag = m[1].toUpperCase();
  if (tag === "NONE" && !allowNone) return { intent: "retry", text: null };
  if (tag === "MEME") {
    return { intent: "chat", text: text.slice(m[0].length).trim() || null, meme: true };
  }
  const intent = tag === "CHAT" ? "chat" : tag === "NONE" ? "none" : "answer";
  return { intent, text: text.slice(m[0].length).trim() || null };
}

const ONBOARDING_EMOTIONS = new Set(["smile", "curious", "spark", "whisper", "proud", "offer", "bow", "surprise", "wave", "wry"]);

export function parseOnboardingEmotionReply(reply, { fallbackEmo = "smile" } = {}) {
  const source = String(reply || "").trim();
  const requested = Array.from(source.matchAll(/\[\s*EMO\s*:\s*([^\]\r\n]*)\]/gi))
    .map((marker) => marker[1].trim().toLowerCase())
    .find((candidate) => ONBOARDING_EMOTIONS.has(candidate)) || "";
  const fallback = String(fallbackEmo || "").trim().toLowerCase();
  const emo = ONBOARDING_EMOTIONS.has(requested) ? requested : ONBOARDING_EMOTIONS.has(fallback) ? fallback : "smile";
  const text = source
    .replace(/\s*\[\s*EMO\b[^\]\r\n]*\]\s*/gi, " ")
    .replace(/\s*\[\s*EMO\b[^\]\r\n]*(?=$|\r?\n)/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, emo };
}

export function resolveNextBeatAiLine({ nextBeatId, aiLine } = {}) {
  if (nextBeatId === "avatar" || nextBeatId === "cardDone") return null;
  return String(aiLine || "").trim() || null;
}

export function extractNameFromAiFieldText(raw) {
  const text = String(raw || "").trim();
  if (!text) return { value: "", text: "" };
  const m = text.match(/(?:称呼|名字|name)\s*[=：:]\s*([^\n，,。.!！?？；;]+)/i);
  if (!m) return { value: "", text };
  const parsed = analyzeNameInput(m[1].trim());
  if (!parsed.value) return { value: "", text };
  const cleaned = (text.slice(0, m.index) + text.slice(m.index + m[0].length))
    .replace(/^[\s，,。.!！?？；;：:-]+/, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { value: parsed.value, text: cleaned || text };
}

export function sanitizeCardMessage(raw) {
  let text = String(raw || "").trim();
  const actionCue = /(抬头|低头|回头|看你|望向|眨眼|歪头|点头|摇头|递|凑|轻声|眼角|耳朵|尾巴|手指|(?:^|[，,、\s])(?:微笑|轻笑|笑(?:了笑|着|起来|了一下)?)(?=$|[，,。！？!?\s]))/;
  while (text) {
    const match = text.match(/^(?:[（(]([^（）()\n]{1,48})[）)]|[*＊]([^*＊\n]{1,48})[*＊])\s*/);
    if (!match || !actionCue.test(match[1] || match[2] || "")) break;
    text = text.slice(match[0].length).trim();
  }
  return text;
}

export function extractTasteFromAiFieldText(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^(?:口味|最近在看|taste)\s*[=：:]\s*([^\r\n]+)/i);
  if (!match) return { value: "", text };
  return { value: match[1].trim(), text: text.slice(match[0].length).replace(/^\s+/, "").trim() || text };
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
