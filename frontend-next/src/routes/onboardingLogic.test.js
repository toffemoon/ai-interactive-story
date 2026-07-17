import assert from "node:assert/strict";
import test from "node:test";
import { toCardModel } from "../lib/cardModel.js";
import { AUTO_CHAT_INTERRUPT_AI, beatById, buildAutoChatShownContext, CHAT_SCENARIO, consumeTestHomeBypass, setTestHomeBypass } from "./onboardingScript.js";
import { analyzeNameCorrectionInput, analyzeNameInput, analyzePendingNameInput, extractNameFromAiFieldText, extractTasteFromAiFieldText, hasRestoredHomeConversation, INITIAL_ONBOARDING_AUTO_CONTROL, isCurrentOnboardingInteraction, isExactFillChipSubmission, isExplicitNameSubmission, matchChipIntent, parseChipIntentReply, parseFieldIntentReply, parseOnboardingEmotionReply, resolveAutoAdvancePlan, resolveChatBubblePlacement, resolveChatStageLayout, resolveNextBeatAiLine, resolveVisibleImageRect, sanitizeCardMessage, shouldAcceptNameLocally, shouldCommitPortraitPreload, shouldConfirmBareNameLocally, transitionOnboardingAutoControl, usesFlowOnboardingBubbleLayout } from "./onboardingLogic.js";

test("extracts the usable name from a sentence", () => {
  assert.deepEqual(analyzeNameInput("我的名字叫 叶叶"), {
    value: "叶叶",
    needsConfirm: false,
    reason: null,
  });
});

test("extracts names from you-can-call-me phrasing", () => {
  assert.deepEqual(analyzeNameInput("你可以叫我小雨"), {
    value: "小雨",
    needsConfirm: false,
    reason: null,
  });
});

test("extracts names from just-call-me phrasing", () => {
  assert.deepEqual(analyzeNameInput("就叫我 何人初见月"), {
    value: "何人初见月",
    needsConfirm: false,
    reason: null,
  });
});

test("extracts only the name from name-write phrasing", () => {
  assert.deepEqual(analyzeNameInput("名字就写 叶叶 吧"), {
    value: "叶叶",
    needsConfirm: false,
    reason: null,
  });
});

test("extracts a replacement name after rejecting a joke name", () => {
  assert.deepEqual(analyzeNameCorrectionInput("不是，叫阿夜"), {
    value: "阿夜",
    needsConfirm: false,
    reason: null,
  });
});

test("extracts English call-me names without odd-name confirmation", () => {
  assert.deepEqual(analyzeNameInput("call me Ray"), {
    value: "Ray",
    needsConfirm: false,
    reason: null,
  });
});

test("distinguishes bare meme-like text from an explicit name declaration", () => {
  assert.equal(isExplicitNameSubmission("kskbl"), false);
  assert.equal(isExplicitNameSubmission("宫廷玉液酒"), false);
  assert.equal(isExplicitNameSubmission("我就用 kskbl 作为我的名字"), true);
  assert.equal(isExplicitNameSubmission("宫廷玉液酒作为我的名字"), true);
  assert.equal(isExplicitNameSubmission("我就用 kskbl 作为我的名字。"), true);
  assert.equal(isExplicitNameSubmission("宫廷玉液酒作为我的名字吧！"), true);
  assert.equal(analyzeNameInput("我就用 kskbl 作为我的名字").value, "kskbl");
  assert.equal(analyzeNameInput("宫廷玉液酒作为我的名字").value, "宫廷玉液酒");
  assert.equal(analyzeNameInput("宫廷玉液酒作为我的名字吧！").value, "宫廷玉液酒");
});

test("does not treat a rejected name as an explicit declaration", () => {
  assert.equal(isExplicitNameSubmission("不要用张三作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("别把张三作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("我不想用张三作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("请不要用张三作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("我可不想用张三作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("我不是要用张三作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("宫廷玉液酒不作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("张三不应该作为我的名字"), false);
  assert.equal(isExplicitNameSubmission("我就用不想长大作为我的名字"), true);
  assert.equal(analyzeNameInput("不要用张三作为我的名字").value, "");
  assert.equal(analyzeNameInput("宫廷玉液酒不作为我的名字").value, "");
});

test("accepts explicit names locally before odd-name confirmation and defers bare names", () => {
  assert.equal(shouldAcceptNameLocally("kskbl"), false);
  assert.equal(shouldAcceptNameLocally("宫廷玉液酒"), false);
  assert.equal(shouldAcceptNameLocally("月客"), false);
  assert.equal(shouldAcceptNameLocally("我就用 kskbl 作为我的名字"), true);
  assert.equal(shouldAcceptNameLocally("宫廷玉液酒作为我的名字"), true);
  assert.equal(shouldAcceptNameLocally("我就用奇变偶不变符号看象限作为我的名字"), true);
  assert.equal(shouldAcceptNameLocally("Ratman0220"), false);
});

test("keeps structural odd handles local but sends long natural-language memes to AI", () => {
  assert.equal(shouldConfirmBareNameLocally("Ratman0220"), true);
  assert.equal(shouldConfirmBareNameLocally("炒股的爸妈"), true);
  assert.equal(shouldConfirmBareNameLocally("奇变偶不变符号看象限"), false);
  assert.equal(shouldConfirmBareNameLocally("我就用Ratman0220作为我的名字"), false);
});

test("asks for confirmation when the extracted name looks like a joke", () => {
  assert.deepEqual(analyzeNameInput("我的名字就叫 炒股的爸妈"), {
    value: "炒股的爸妈",
    needsConfirm: true,
    reason: "odd",
  });
});

test("does not treat a direct question as a name", () => {
  assert.equal(analyzeNameInput("你叫什么呀").value, "");
});

test("does not treat casual chat as an unprefixed name", () => {
  assert.equal(analyzeNameInput("这店真好看").value, "");
});

test("does not treat broad self-introductions or avatar words as names", () => {
  assert.equal(analyzeNameInput("我是来看看").value, "");
  assert.equal(analyzeNameInput("我是路过").value, "");
  assert.equal(analyzeNameInput("头像").value, "");
});

test("extracts the final corrected name after a rejected joke name", () => {
  assert.deepEqual(analyzeNameCorrectionInput("不是炒股的爸妈，叫阿夜"), {
    value: "阿夜",
    needsConfirm: false,
    reason: null,
  });
});

test("confirms an odd pending name when the user repeats it with affirmation", () => {
  assert.deepEqual(analyzePendingNameInput("对的 我就叫 Ratman0220", "Ratman0220"), {
    intent: "confirm",
    value: "Ratman0220",
    needsConfirm: false,
    reason: null,
  });
});

test("treats a different name in pending confirmation as a change", () => {
  assert.deepEqual(analyzePendingNameInput("不对，我叫阿夜", "Ratman0220"), {
    intent: "change",
    value: "阿夜",
    needsConfirm: false,
    reason: null,
  });
});

test("matches free text that means the next tour chip", () => {
  const chips = [{ label: "然后呢", next: "tourChat" }];
  assert.equal(matchChipIntent("然后呢，继续说", chips), chips[0]);
});

test("matches contextual affirmations to the single next action", () => {
  const chips = [{ label: "带我认认这儿", next: "tourStory" }];
  assert.equal(matchChipIntent("好的", chips), chips[0]);
  assert.equal(matchChipIntent("嗯嗯你带我看看", chips), chips[0]);
  assert.equal(matchChipIntent("下一步吧", chips), chips[0]);
});

test("matches ok to the current tour continuation", () => {
  const chips = [{ label: "然后呢", next: "tourChat" }];
  assert.equal(matchChipIntent("ok", chips), chips[0]);
});

test("matches free text that means skipping taste", () => {
  const chips = [{ label: "还没看什么", set: { taste: "" }, next: "cardDone" }];
  assert.equal(matchChipIntent("我最近还没看什么", chips), chips[0]);
  assert.equal(matchChipIntent("我没读书", chips), chips[0]);
});

test("does not treat ok as skipping the taste answer", () => {
  const chips = [{ label: "还没看什么", set: { taste: "" }, next: "cardDone" }];
  assert.equal(matchChipIntent("ok", chips), null);
});

test("taste skip requires an unambiguous absence", () => {
  const chips = [{ label: "还没看什么", set: { taste: "" }, next: "cardDone" }];
  for (const text of ["不是没有，我在看剑来", "没有看书，但在追三体电视剧", "暂时没有，不过我在看三体", "有没有推荐"]) {
    assert.equal(matchChipIntent(text, chips), null, text);
  }
});

test("distinguishes typed fill text from clicking a suggestion chip", () => {
  const chip = { label: "半夜给自己写信的人", fill: "半夜给自己写信的人" };
  assert.equal(isExactFillChipSubmission("半夜给自己写信的人", chip), true);
  assert.equal(isExactFillChipSubmission("半夜给自己写信的人", { ...chip, next: "tryCreateResult" }), false);
});

test("matches the dynamic avatar continue wording to the original next chip", () => {
  const chips = [
    { label: "＋ 传张头像", upload: true },
    { label: "用名字字头就好", next: "taste" },
  ];
  assert.equal(matchChipIntent("好了继续", chips), chips[1]);
});

test("matches natural and English avatar skip wording", () => {
  const chips = [
    { label: "＋ 传张头像", upload: true },
    { label: "用名字字头就好", next: "taste" },
  ];
  assert.equal(matchChipIntent("头像先跳过好了", chips), chips[1]);
  assert.equal(matchChipIntent("no avatar, continue", chips), chips[1]);
});

test("avatar negation wins over upload words", () => {
  const chips = [
    { label: "＋ 传张头像", upload: true },
    { label: "用名字字头就好", next: "taste" },
  ];
  for (const text of ["我不要上传照片", "不传头像", "不用图片"]) {
    assert.equal(matchChipIntent(text, chips), chips[1], text);
  }
});

test("matches explicit avatar upload wording without broad short-token matches", () => {
  const chips = [
    { label: "＋ 传张头像", upload: true },
    { label: "用名字字头就好", next: "taste" },
  ];
  assert.equal(matchChipIntent("我要传头像", chips), chips[0]);
  assert.equal(matchChipIntent("photo", chips), chips[0]);
  assert.equal(matchChipIntent("avatar", chips), null);
  assert.equal(matchChipIntent("头像", chips), null);
});

test("does not match one-character fragments to action chips", () => {
  const chips = [
    { label: "带我进第一本书", to: "/explore", done: true },
    { label: "我自己逛逛", done: true },
  ];
  assert.equal(matchChipIntent("带", chips), null);
  assert.equal(matchChipIntent("我", chips), null);
  assert.equal(matchChipIntent("一", chips), null);
});

test("parses AI chip intent replies conservatively", () => {
  const chips = [{ label: "带我认认这儿", next: "tourStory" }];
  assert.deepEqual(parseChipIntentReply("[CHIP:0]", chips), { chip: chips[0], chat: null });
  assert.deepEqual(parseChipIntentReply("[CHAT] 我先回答你一句。", chips), { chip: null, chat: "我先回答你一句。" });
  assert.deepEqual(parseChipIntentReply("随便聊聊", chips), { chip: null, chat: "随便聊聊" });
  assert.deepEqual(parseChipIntentReply("[CHIP:9]", chips), { chip: null, chat: null });
});

test("parses field AI failures as retry instead of fabricated answers", () => {
  assert.deepEqual(parseFieldIntentReply(null), { intent: "retry", text: null });
  assert.deepEqual(parseFieldIntentReply(""), { intent: "retry", text: null });
  assert.deepEqual(parseFieldIntentReply("zdjd", { requireTag: true }), { intent: "retry", text: null });
  assert.deepEqual(parseFieldIntentReply("[NONE] 没有名字", { requireTag: true, allowNone: false }), { intent: "retry", text: null });
  assert.deepEqual(parseFieldIntentReply("[CHAT] 先别急。"), { intent: "chat", text: "先别急。" });
  assert.deepEqual(parseFieldIntentReply("[NONE] 最近还没看。"), { intent: "none", text: "最近还没看。" });
  assert.deepEqual(parseFieldIntentReply("[OK] 写好了。"), { intent: "answer", text: "写好了。" });
  assert.deepEqual(parseFieldIntentReply("写好了。"), { intent: "answer", text: "写好了。" });
});

test("extracts a whitelisted onboarding emotion without changing the reply protocol", () => {
  const parsed = parseOnboardingEmotionReply("[OK] 称呼=月客\n记下了。 [EMO:offer]", { fallbackEmo: "smile" });
  assert.deepEqual(parsed, { text: "[OK] 称呼=月客\n记下了。", emo: "offer" });
  assert.deepEqual(parseFieldIntentReply(parsed.text), { intent: "answer", text: "称呼=月客\n记下了。" });
});

test("falls back for missing or invalid onboarding emotion tags and still strips them", () => {
  assert.deepEqual(parseOnboardingEmotionReply("先回答你。", { fallbackEmo: "curious" }), {
    text: "先回答你。",
    emo: "curious",
  });
  assert.deepEqual(parseOnboardingEmotionReply("先回答你。 [EMO:angry]", { fallbackEmo: "wry" }), {
    text: "先回答你。",
    emo: "wry",
  });
  assert.deepEqual(parseOnboardingEmotionReply("[EMO:spark]", { fallbackEmo: "unknown" }), {
    text: "",
    emo: "spark",
  });
});

test("never exposes malformed or repeated onboarding emotion protocol fragments", () => {
  const fallback = { fallbackEmo: "wry" };
  assert.deepEqual(parseOnboardingEmotionReply("Reply [EMO]", fallback), { text: "Reply", emo: "wry" });
  assert.deepEqual(parseOnboardingEmotionReply("Reply [EMO:]", fallback), { text: "Reply", emo: "wry" });
  assert.deepEqual(parseOnboardingEmotionReply("Reply [EMO:spark", fallback), { text: "Reply", emo: "wry" });
  assert.deepEqual(parseOnboardingEmotionReply("Reply [ eMo : SPARK ]", fallback), { text: "Reply", emo: "spark" });
  assert.deepEqual(
    parseOnboardingEmotionReply("One [EMO:angry] two [EMO:SPARK] three [EMO]", fallback),
    { text: "One two three", emo: "spark" },
  );
  assert.deepEqual(
    parseOnboardingEmotionReply("Reply [EMO:spark\nkeep [note] text", fallback),
    { text: "Reply\nkeep [note] text", emo: "wry" },
  );
  assert.deepEqual(
    parseOnboardingEmotionReply("Reply [EMO:\nspark]", fallback),
    { text: "Reply", emo: "wry" },
  );
});

test("does not let an AI acknowledgement replace avatar or completed-card guidance", () => {
  assert.equal(resolveNextBeatAiLine({ nextBeatId: "avatar", aiLine: "这个称呼很特别。" }), null);
  assert.equal(resolveNextBeatAiLine({ nextBeatId: "cardDone", aiLine: "卡办好了。" }), null);
  assert.equal(resolveNextBeatAiLine({ nextBeatId: "tryCreateResult", aiLine: "  这个念头可以继续写。  " }), "这个念头可以继续写。");
  assert.equal(resolveNextBeatAiLine({ nextBeatId: "taste", aiLine: "  " }), null);
});

test("places a chat bubble on the requested free side without crossing the dock", () => {
  const speakerRect = { left: 80, top: 72, right: 230, bottom: 238 };
  const rect = resolveChatBubblePlacement({
    viewport: { width: 800, height: 620 },
    speakerRect,
    bubbleSize: { width: 280, height: 150 },
    dockTop: 540,
    preferredSide: "left",
    padding: 24,
    gap: 16,
  });
  assert.equal(rect.compact, false);
  assert.ok(rect.left >= speakerRect.right + 16, "falls back to the free right side");
  assert.ok(rect.top >= 24);
  assert.ok(rect.left + rect.width <= 776);
  assert.ok(rect.top + rect.height <= 524);
});

test("computes Tangmu placement from her own protected rect and compacts when both full-width sides fail", () => {
  const speakerRect = { left: 150, top: 70, right: 300, bottom: 240 };
  const rect = resolveChatBubblePlacement({
    viewport: { width: 450, height: 710 },
    speakerRect,
    bubbleSize: { width: 210, height: 145 },
    dockTop: 590,
    preferredSide: "left",
    padding: 12,
    gap: 8,
  });
  const overlapsSpeaker = !(
    rect.left + rect.width <= speakerRect.left ||
    rect.left >= speakerRect.right ||
    rect.top + rect.height <= speakerRect.top ||
    rect.top >= speakerRect.bottom
  );
  assert.equal(rect.compact, true);
  assert.equal(overlapsSpeaker, false);
  assert.ok(rect.left >= 12 && rect.left + rect.width <= 438);
  assert.ok(rect.top >= 12 && rect.top + rect.height <= 582);
});

test("keeps a chat bubble away from the other visible character too", () => {
  const xuanFace = { left: 12, top: 140, right: 180, bottom: 270 };
  const tangmuFace = { left: 190, top: 86, right: 430, bottom: 290 };
  const rect = resolveChatBubblePlacement({
    viewport: { width: 652, height: 663 },
    speakerRect: xuanFace,
    avoidRects: [tangmuFace],
    bubbleSize: { width: 210, height: 126 },
    dockTop: 570,
    preferredSide: "right",
    padding: 12,
    gap: 8,
  });
  const overlaps = (a, b) => !(a.left + a.width <= b.left || a.left >= b.right || a.top + a.height <= b.top || a.top >= b.bottom);
  assert.ok(rect);
  assert.equal(overlaps(rect, xuanFace), false);
  assert.equal(overlaps(rect, tangmuFace), false);
});

test("returns an explicit dock-safe flow fallback when compact geometry has no free slot", () => {
  const placement = resolveChatBubblePlacement({
    viewport: { width: 390, height: 500 },
    speakerRect: { left: 8, top: 80, right: 130, bottom: 300 },
    avoidRects: [{ left: 155, top: 60, right: 380, bottom: 300 }],
    bubbleSize: { width: 160, height: 112 },
    dockTop: 320,
    padding: 12,
    gap: 8,
  });

  assert.ok(placement);
  assert.equal(placement.flowFallback, true);
  assert.equal(placement.compact, true);
  assert.deepEqual(placement.bubbleBand, {
    left: placement.left,
    top: placement.top,
    width: placement.width,
    height: placement.height,
  });
  const stage = placement.characterStage;
  assert.ok(stage);
  assert.ok(placement.top + placement.height <= stage.top, "bubble band ends before the character stage");
  assert.ok(stage.top + stage.height <= 312, "character stage stays above the dock-safe boundary");
  assert.ok(placement.top >= 12 && placement.left >= 12);
  assert.ok(placement.left + placement.width <= 378);

  const fractionalDockPlacement = resolveChatBubblePlacement({
    viewport: { width: 390, height: 500 },
    speakerRect: { left: 8, top: 80, right: 130, bottom: 300 },
    avoidRects: [{ left: 155, top: 60, right: 380, bottom: 300 }],
    bubbleSize: { width: 160, height: 112 },
    dockTop: 320.5,
    padding: 12,
    gap: 8,
  });
  assert.ok(fractionalDockPlacement.characterStage.top + fractionalDockPlacement.characterStage.height <= 312.5);
});

test("maps an image alpha silhouette into its contained on-screen box", () => {
  const rect = resolveVisibleImageRect({
    box: { left: 100, top: 50, width: 400, height: 600 },
    naturalSize: { width: 1024, height: 1536 },
    alphaBounds: { left: 236, top: 0, right: 855, bottom: 1493 },
  });
  assert.ok(rect);
  assert.ok(Math.abs(rect.left - 192.1875) < 0.001);
  assert.ok(Math.abs(rect.right - 433.984375) < 0.001);
  assert.ok(Math.abs(rect.top - 50) < 0.001);
  assert.ok(Math.abs(rect.bottom - 633.203125) < 0.001);
});

test("ends the narrow chat character stage above the live composer", () => {
  assert.deepEqual(resolveChatStageLayout({
    viewportHeight: 663,
    dockTop: 482.8,
    narrow: true,
    padding: 12,
    gap: 8,
  }), { bottom: 188, height: 320 });
});

test("keeps an AI-recognized meme in chat mode and exposes its portrait cue", () => {
  assert.deepEqual(parseFieldIntentReply("[MEME] 符号看象限。"), {
    intent: "chat",
    text: "符号看象限。",
    meme: true,
  });
});

test("name intent prompt defaults plausible nicknames to names and only catches known memes", () => {
  const scenario = beatById("name").ai.scenario();
  assert.match(scenario, /短称呼.*默认.*\[OK\]/);
  assert.match(scenario, /明确知道.*接梗.*\[MEME\]/);
  assert.match(scenario, /玩家只说 kskbl 时必须回复 \[MEME\] zdjd/);
  assert.match(scenario, /玩家只说「宫廷玉液酒」时必须回复 \[MEME\] 一百八一杯/);
});

test("onboarding LLM prompts request one whitelisted emotion tag in the same reply", () => {
  const prompts = [
    CHAT_SCENARIO,
    AUTO_CHAT_INTERRUPT_AI.宣.scenario({ name: "雨飞", shownContext: "宣：你好。" }),
    AUTO_CHAT_INTERRUPT_AI.糖沐.scenario({ name: "雨飞", shownContext: "糖沐：别紧张。" }),
    beatById("name").ai.scenario({}),
    beatById("taste").ai.scenario({ name: "雨飞" }),
    beatById("tryChatGreet").ai.scenario({}),
  ];
  for (const prompt of prompts) {
    assert.match(prompt, /\[EMO:<key>\]/);
    assert.match(prompt, /smile\/curious\/spark\/whisper\/proud\/offer\/bow\/surprise\/wave\/wry/);
  }
  assert.match(beatById("name").ai.scenario({}), /\[OK\].*\[MEME\].*\[CHAT\]/s);
});

test("extracts a name value from AI field replies", () => {
  assert.deepEqual(extractNameFromAiFieldText("称呼=何人初见月\n记下了,我会这样叫你。"), {
    value: "何人初见月",
    text: "记下了,我会这样叫你。",
  });
});

test("removes consecutive leading action spans from card messages", () => {
  assert.equal(
    sanitizeCardMessage("（抬头看你）*轻声笑了笑* 月客,愿你总能遇见想读的故事。"),
    "月客,愿你总能遇见想读的故事。",
  );
  assert.equal(sanitizeCardMessage("（抬头看你，眼角弯弯）愿你读得尽兴。"), "愿你读得尽兴。");
  assert.equal(sanitizeCardMessage("（点头）＊轻声笑了笑＊"), "");
});

test("preserves ordinary and internal parentheses in card messages", () => {
  assert.equal(
    sanitizeCardMessage("愿你总能找到那本书（也找到自己）。"),
    "愿你总能找到那本书（也找到自己）。",
  );
  assert.equal(sanitizeCardMessage("（第一版）愿你读得尽兴。"), "（第一版）愿你读得尽兴。");
});

test("preserves a parenthesized book title at the start of a card message", () => {
  assert.equal(sanitizeCardMessage("（笑傲江湖）愿你读得尽兴。"), "（笑傲江湖）愿你读得尽兴。");
});

test("extracts structured taste metadata only from the first line", () => {
  for (const key of ["口味", "最近在看", "taste"]) {
    assert.deepEqual(extractTasteFromAiFieldText(`${key}=灵魂摆渡人\n这部很适合夜里慢慢看。`), {
      value: "灵魂摆渡人",
      text: "这部很适合夜里慢慢看。",
    });
  }
  assert.deepEqual(extractTasteFromAiFieldText("这部很适合夜里慢慢看。\n口味=灵魂摆渡人"), {
    value: "",
    text: "这部很适合夜里慢慢看。\n口味=灵魂摆渡人",
  });
});

test("taste prompt requires structured high-confidence titles and preserves uncertain originals", () => {
  const scenario = beatById("taste").ai.scenario({ name: "何人初见月" });
  assert.match(scenario, /\[OK\].*第一行.*口味=高置信度规范值/s);
  assert.match(scenario, /只.*纠正.*明显.*高置信度.*错/);
  assert.match(scenario, /不确定.*保留.*原文/);
});

test("card message prompt forbids action and emotion stage directions", () => {
  const prompt = beatById("cardDone").msg({ name: "何人初见月", taste: "灵魂摆渡人" });
  assert.match(prompt, /不要.*动作描述/);
  assert.match(prompt, /不要.*情绪描述/);
  assert.match(prompt, /不要.*括号.*动作/);
});

test("card completion closes with the approved tour transition", () => {
  assert.equal(
    beatById("cardDone").line({ name: "何人初见月" }).endsWith("收好,我带你来认识一下这个地方。"),
    true,
  );
});

test("portrait preload commits only the current successful non-empty image", () => {
  assert.equal(shouldCommitPortraitPreload({ requestEpoch: 2, currentEpoch: 2, eventType: "load", naturalWidth: 640 }), true);
  assert.equal(shouldCommitPortraitPreload({ requestEpoch: 2, currentEpoch: 3, eventType: "load", naturalWidth: 640 }), false);
  assert.equal(shouldCommitPortraitPreload({ requestEpoch: 2, currentEpoch: 2, eventType: "error", naturalWidth: 640 }), false);
  assert.equal(shouldCommitPortraitPreload({ requestEpoch: 2, currentEpoch: 2, eventType: "load", naturalWidth: 0 }), false);
  assert.equal(shouldCommitPortraitPreload({ requestEpoch: 2, currentEpoch: 2, eventType: "load", naturalWidth: Number.NaN }), false);
});

test("compact and portrait viewports use the flow onboarding bubble layout", () => {
  assert.equal(usesFlowOnboardingBubbleLayout({ width: 390, height: 844 }), true);
  assert.equal(usesFlowOnboardingBubbleLayout({ width: 450, height: 710 }), true);
  assert.equal(usesFlowOnboardingBubbleLayout({ width: 856, height: 638 }), false);
  assert.equal(usesFlowOnboardingBubbleLayout({ width: 856, height: 638, demoType: "story" }), true);
  assert.equal(usesFlowOnboardingBubbleLayout({ width: 856, height: 638, demoType: "characterCard" }), true);
  assert.equal(usesFlowOnboardingBubbleLayout({ width: 856, height: 638, demoType: "chat" }), false);
  assert.equal(usesFlowOnboardingBubbleLayout({ width: 1280, height: 720 }), false);
});

test("chat demo is fully click-driven (no auto-advance)", () => {
  for (const id of ["tryChatTalk", "tryChatTangmuReply", "tryChatIntro", "tryChatGreet", "tryChatLeave"]) {
    assert.equal(beatById(id).autoNext, undefined, id);
    assert.equal(beatById(id).autoMs, undefined, id);
  }
});

test("story explanation beats use poses that match their distinct meanings", () => {
  assert.deepEqual(
    ["tryStoryCard", "tryStoryEnter", "tryStoryRole", "tryStoryAgency"].map((id) => beatById(id).emo),
    ["offer", "curious", "whisper", "proud"],
  );
});

test("onboarding rehearses story chat and creation without route jumps", () => {
  assert.equal(beatById("cardDone").chips[0].next, "tryStoryIntro");

  const intro = beatById("tryStoryIntro");
  assert.equal(intro.demo, undefined);
  assert.equal(intro.chips[0].next, "tryStoryCard");
  assert.match(intro.line({ taste: "剑来" }), /主页和探索页/);
  assert.doesNotMatch(intro.line({ taste: "" }), /剑来/);
  assert.match(intro.line({ taste: "" }), /还没读|没读|空着/);

  const story = beatById("tryStoryCard");
  assert.equal(story.field, undefined);
  const storyBeats = [
    ["tryStoryCard", "喏,这就是书卡。正面看封面、类型和名字;点一下会翻到背面,能看简介和标签。", "tryStoryEnter"],
    ["tryStoryEnter", "选中后,你就可以亲身体验故事里的内容。", "tryStoryRole"],
    ["tryStoryRole", "你可以在里面扮演你想要的角色。它可以是主角,也可以只是一个 NPC。", "tryStoryAgency"],
    ["tryStoryAgency", "但是,你可以亲手去控制整个故事的走向,撰写独属于你自己的故事线和结局。", "doorIntro"],
  ];
  for (const [id, line, next] of storyBeats) {
    const beat = beatById(id);
    assert.equal(beat.line({}), line);
    assert.equal(beat.demo.type, "story");
    assert.equal(beat.chips[0].next, next);
  }

  const storyModel = toCardModel("story", story.demo.preset);
  assert.equal(storyModel.title, "灵魂摆渡人");
  assert.equal(storyModel.cover, "/onboarding/linghunbaiduren.jpg");
  assert.equal(storyModel.cover.startsWith("/covers/"), false);

  const doorIntro = beatById("doorIntro");
  assert.equal(doorIntro.demo, undefined);
  assert.equal(doorIntro.chips[0].next, "doorGoIn");
  assert.equal(beatById("doorGoIn").chips[0].next, "tryCharacterCard");

  const characterCard = beatById("tryCharacterCard");
  assert.equal(characterCard.demo, undefined);
  assert.match(characterCard.line({}), /请出来/);
  assert.equal(characterCard.chips[0].next, "tryChatTalk");

  const talk = beatById("tryChatTalk");
  assert.equal(talk.speaker, "宣");
  assert.equal(talk.emo, "smile");
  assert.equal(talk.field, undefined);
  assert.match(talk.line({}), /怎么.*喊/);
  assert.equal(talk.chips[0].next, "tryChatTangmuReply");

  const tangmuReply = beatById("tryChatTangmuReply");
  assert.equal(tangmuReply.speaker, "糖沐");
  assert.equal(tangmuReply.demo.type, "chat");
  assert.match(tangmuReply.line({}), /新客|演示/);
  assert.equal(tangmuReply.chips[0].next, "tryChatIntro");

  const introChat = beatById("tryChatIntro");
  assert.equal(introChat.speaker, "糖沐");
  assert.match(introChat.line({ name: "何人初见月" }), /介绍|宣|何人初见月/);
  assert.equal(introChat.chips[0].next, "tryChatGreet");

  const greet = beatById("tryChatGreet");
  assert.equal(greet.speaker, "宣");
  assert.equal(greet.emo, "smile");
  assert.equal(greet.field, "xuanLine");
  assert.equal(greet.ai.optional, true);
  assert.equal(greet.next, "tryChatLeave");
  assert.match(greet.line({}), /你好|见过/);

  const leave = beatById("tryChatLeave");
  assert.equal(leave.speaker, "宣");
  assert.equal(leave.emo, "smile");
  assert.match(leave.line({}), /先回去了/);
  assert.equal(leave.chips[0].next, "restIntro");

  for (const id of ["tryChatTalk", "tryChatTangmuReply", "tryChatIntro", "tryChatGreet", "tryChatLeave"]) {
    const chat = beatById(id);
    assert.equal(chat.demo.type, "chat");
    assert.equal(chat.demo.character.name, "宣");
    assert.equal(chat.demo.character.image, "/oc/xuan.png");
  }

  const restIntro = beatById("restIntro");
  assert.equal(restIntro.chips[0].next, "tryCreateWhat");
  assert.equal(beatById("tryCreateWhat").chips[0].next, "tryCreate");

  // 创作拍纯台词:无 field/ai、无演示面板(创作功能太大,onboarding 不展开投射画板),靠 chip 推进(具体上手引到「创作」页)。
  const create = beatById("tryCreate");
  assert.equal(create.field, undefined);
  assert.equal(create.demo, undefined);
  assert.doesNotMatch(JSON.stringify(create), /雨夜侦探/);
  assert.match(create.line({}), /创作|执笔人/);
  assert.equal(create.chips[0].next, "createRealize");

  assert.equal(beatById("tryCreateResult"), null);
  assert.equal(beatById("createRealize").chips[0].next, "tryWrap");

  const wrap = beatById("tryWrap");
  assert.equal(wrap.centerBubble, true);
  assert.match(wrap.line({ name: "何人初见月" }), /主页|探索页|创作/);
  assert.equal(wrap.chips[0].to, "/explore");
});

test("auto dialogue pauses and resumes with its full delay", () => {
  const base = { autoNext: "tryChatTangmuReply", autoMs: 3200, nextOverride: null };
  assert.deepEqual(resolveAutoAdvancePlan(base), {
    pauseReasons: [],
    shouldSchedule: true,
    nextId: "tryChatTangmuReply",
    delay: 3200,
  });
  for (const paused of [
    { inputFocused: true, reason: "focus" },
    { hasDraft: true, reason: "draft" },
    { menuOpen: true, reason: "menu" },
    { replyBlocked: true, reason: "pending-reply" },
  ]) {
    const plan = resolveAutoAdvancePlan({ ...base, [Object.keys(paused)[0]]: true });
    assert.equal(plan.shouldSchedule, false);
    assert.deepEqual(plan.pauseReasons, [paused.reason]);
  }
  assert.equal(resolveAutoAdvancePlan({ ...base, inputFocused: false, hasDraft: false }).delay, 3200);
});

test("successful interruption overrides the next target without changing the delay", () => {
  assert.deepEqual(
    resolveAutoAdvancePlan({ autoNext: "tryChatIntro", autoMs: 4200, nextOverride: "tryCreate" }),
    { pauseReasons: [], shouldSchedule: true, nextId: "tryCreate", delay: 4200 }
  );
  assert.equal(resolveAutoAdvancePlan({ autoMs: 4200 }).shouldSchedule, false);
});

test("send blurs the composer, invalidates the old target, and waits for a reply", () => {
  const sent = transitionOnboardingAutoControl(
    { ...INITIAL_ONBOARDING_AUTO_CONTROL, nextOverride: "tryChatTangmuReply" },
    { type: "send" }
  );
  assert.equal(sent.blurComposer, true);
  assert.equal(sent.applied, true);
  assert.deepEqual(sent.control, { interactionEpoch: 1, nextOverride: null, replyState: "pending" });
  assert.equal(
    resolveAutoAdvancePlan({ autoNext: "tryChatTangmuReply", autoMs: 3200, replyBlocked: sent.control.replyState !== "idle" }).shouldSchedule,
    false
  );
});

test("current success overrides to tryCreate while failure stays paused", () => {
  const sent = transitionOnboardingAutoControl(INITIAL_ONBOARDING_AUTO_CONTROL, { type: "send" });
  const success = transitionOnboardingAutoControl(sent.control, { type: "reply-success", interactionEpoch: 1 });
  assert.deepEqual(success.control, { interactionEpoch: 1, nextOverride: "tryCreate", replyState: "idle" });
  assert.equal(resolveAutoAdvancePlan({ autoNext: "tryChatIntro", autoMs: 4200, nextOverride: success.control.nextOverride }).nextId, "tryCreate");

  const failed = transitionOnboardingAutoControl(sent.control, { type: "reply-failure", interactionEpoch: 1 });
  assert.deepEqual(failed.control, { interactionEpoch: 1, nextOverride: null, replyState: "failed" });
  assert.equal(resolveAutoAdvancePlan({ autoNext: "tryChatIntro", autoMs: 4200, replyBlocked: true }).shouldSchedule, false);
  const retry = transitionOnboardingAutoControl(failed.control, { type: "retry" });
  assert.deepEqual(retry.control, { interactionEpoch: 2, nextOverride: null, replyState: "pending" });
  assert.equal(retry.blurComposer, true);
});

test("late success and failure cannot mutate a newer interaction", () => {
  const current = { interactionEpoch: 2, nextOverride: null, replyState: "pending" };
  for (const type of ["reply-success", "reply-failure"]) {
    const stale = transitionOnboardingAutoControl(current, { type, interactionEpoch: 1 });
    assert.equal(stale.applied, false, type);
    assert.deepEqual(stale.control, current, type);
  }
});

test("menu close restarts the full Intro or beat timer", () => {
  for (const timer of [
    { autoNext: "intro:advance", autoMs: 1300 },
    { autoNext: "tryChatTangmuReply", autoMs: 3200 },
  ]) {
    assert.equal(resolveAutoAdvancePlan({ ...timer, menuOpen: true }).shouldSchedule, false);
    assert.deepEqual(resolveAutoAdvancePlan({ ...timer, menuOpen: false }), {
      pauseReasons: [],
      shouldSchedule: true,
      nextId: timer.autoNext,
      delay: timer.autoMs,
    });
  }
});

test("only the current interaction epoch and beat may apply a reply", () => {
  const current = { requestEpoch: 4, currentEpoch: 4, requestBeatId: "tryChatTalk", currentBeatId: "tryChatTalk" };
  assert.equal(isCurrentOnboardingInteraction(current), true);
  assert.equal(isCurrentOnboardingInteraction({ ...current, requestEpoch: 3 }), false);
  assert.equal(isCurrentOnboardingInteraction({ ...current, requestBeatId: "tryChatIntro" }), false);
});

test("test Home bypass is consumed exactly once", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  setTestHomeBypass(storage);
  assert.equal(consumeTestHomeBypass(storage), true);
  assert.equal(consumeTestHomeBypass(storage), false);
});

test("only real message history suppresses first-visit onboarding", () => {
  assert.equal(hasRestoredHomeConversation({ card: { data: { name: "糖沐" } }, msgs: [] }), false);
  assert.equal(hasRestoredHomeConversation({ card: { data: { name: "糖沐" } }, msgs: [{ who: "me", text: "你好" }] }), true);
  assert.equal(hasRestoredHomeConversation(null), false);
});

test("auto chat beats expose speaker-aware interruption contracts", () => {
  const ids = ["tryChatTalk", "tryChatTangmuReply", "tryChatIntro", "tryChatLeave"];
  for (const id of ids) {
    const beat = beatById(id);
    assert.equal(beat.interruptible, true, id);
    assert.ok(AUTO_CHAT_INTERRUPT_AI[beat.speaker], id);
    const shownContext = buildAutoChatShownContext(id, { name: "雨飞" }, beat.line({ name: "雨飞" }));
    const scenario = AUTO_CHAT_INTERRUPT_AI[beat.speaker].scenario({ name: "雨飞", shownContext });
    assert.match(scenario, new RegExp(beat.speaker));
    assert.match(scenario, /只回应已经显示/);
  }
  assert.equal(beatById("tryChatGreet").interruptible, undefined);
});

test("auto chat context contains shown lines but excludes future lines", () => {
  const current = beatById("tryChatTangmuReply");
  const context = buildAutoChatShownContext(current.id, { name: "雨飞" }, current.line({ name: "雨飞" }));
  assert.match(context, /糖沐\?你怎么把我从书里喊出来了/);
  assert.match(context, /别紧张,宣/);
  assert.doesNotMatch(context, /介绍一下,这是宣/);
});

test("wrap CTA promises the real Explore destination", () => {
  const chip = beatById("tryWrap").chips[0];
  assert.equal(chip.label, "去故事广场看看");
  assert.equal(chip.to, "/explore");
  assert.equal(chip.done, true);
});
