import assert from "node:assert/strict";
import test from "node:test";
import { analyzeNameCorrectionInput, analyzeNameInput, matchChipIntent, parseChipIntentReply } from "./onboardingLogic.js";

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
});

test("does not treat ok as skipping the taste answer", () => {
  const chips = [{ label: "还没看什么", set: { taste: "" }, next: "cardDone" }];
  assert.equal(matchChipIntent("ok", chips), null);
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

test("parses AI chip intent replies conservatively", () => {
  const chips = [{ label: "带我认认这儿", next: "tourStory" }];
  assert.deepEqual(parseChipIntentReply("[CHIP:0]", chips), { chip: chips[0], chat: null });
  assert.deepEqual(parseChipIntentReply("[CHAT] 我先回答你一句。", chips), { chip: null, chat: "我先回答你一句。" });
  assert.deepEqual(parseChipIntentReply("随便聊聊", chips), { chip: null, chat: "随便聊聊" });
  assert.deepEqual(parseChipIntentReply("[CHIP:9]", chips), { chip: null, chat: null });
});
