import assert from "node:assert/strict";
import test from "node:test";
import { toCardModel } from "../lib/cardModel.js";
import { beatById } from "./onboardingScript.js";
import { analyzeNameCorrectionInput, analyzeNameInput, extractNameFromAiFieldText, isExactFillChipSubmission, matchChipIntent, parseChipIntentReply, parseFieldIntentReply } from "./onboardingLogic.js";

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
  assert.deepEqual(parseFieldIntentReply("[CHAT] 先别急。"), { intent: "chat", text: "先别急。" });
  assert.deepEqual(parseFieldIntentReply("[NONE] 最近还没看。"), { intent: "none", text: "最近还没看。" });
  assert.deepEqual(parseFieldIntentReply("[OK] 写好了。"), { intent: "answer", text: "写好了。" });
  assert.deepEqual(parseFieldIntentReply("写好了。"), { intent: "answer", text: "写好了。" });
});

test("extracts a name value from AI field replies", () => {
  assert.deepEqual(extractNameFromAiFieldText("称呼=何人初见月\n记下了,我会这样叫你。"), {
    value: "何人初见月",
    text: "记下了,我会这样叫你。",
  });
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
  assert.equal(story.chips[0].next, "tryCharacterCard");
  assert.match(story.line({}), /点一下/);
  assert.match(story.line({}), /翻/);

  assert.equal(story.demo.type, "story");
  const storyModel = toCardModel("story", story.demo.preset);
  assert.equal(storyModel.title, "灵魂摆渡人");
  assert.equal(storyModel.cover, "/onboarding/linghunbaiduren.jpg");
  assert.equal(storyModel.cover.startsWith("/covers/"), false);

  const characterCard = beatById("tryCharacterCard");
  assert.equal(characterCard.demo.type, "characterCard");
  const characterModel = toCardModel("character", characterCard.demo.characterCard);
  assert.equal(characterModel.title, "宣");
  assert.equal(characterModel.cover, "/oc/xuan.png");
  assert.match(characterCard.line({}), /角色从他们的世界/);
  assert.equal(characterCard.chips[0].next, "tryChatTalk");

  const talk = beatById("tryChatTalk");
  assert.equal(talk.speaker, "宣");
  assert.equal(talk.field, "xuanLine");
  assert.equal(talk.ai.optional, true);
  assert.equal(talk.next, "tryChatLeave");

  const leave = beatById("tryChatLeave");
  assert.equal(leave.speaker, "宣");
  assert.match(leave.line({}), /先回去了/);
  assert.equal(leave.chips[0].next, "tryCreate");

  const chat = beatById("tryChatTalk");
  assert.equal(chat.demo.type, "chat");
  assert.equal(chat.demo.character.name, "宣");
  assert.equal(chat.demo.character.image, "/oc/xuan.png");

  const create = beatById("tryCreate");
  assert.equal(create.field, "createSeed");
  assert.equal(create.next, "tryCreateResult");
  assert.equal(create.ai.optional, true);
  assert.equal(create.demo.type, "draftCard");
  assert.doesNotMatch(JSON.stringify(create), /雨夜侦探/);
  assert.match(create.line({}), /刚刚你看到的卡/);
  assert.match(create.line({}), /执笔人/);

  const createResult = beatById("tryCreateResult");
  assert.equal(createResult.demo.type, "draftCard");
  assert.doesNotMatch(createResult.demo.hook({ createSeed: "" }), /雨夜侦探/);
  assert.match(createResult.line({ createSeed: "半夜给自己写信的人" }), /角色卡/);
  assert.equal(createResult.chips[0].next, "tryWrap");

  const wrap = beatById("tryWrap");
  assert.equal(wrap.centerBubble, true);
  assert.match(wrap.line({ name: "何人初见月" }), /主页|探索页|创作/);
  assert.equal(wrap.chips[0].to, "/explore");
});
