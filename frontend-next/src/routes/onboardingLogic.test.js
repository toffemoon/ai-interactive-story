import assert from "node:assert/strict";
import test from "node:test";
import { analyzeNameInput, matchChipIntent } from "./onboardingLogic.js";

test("extracts the usable name from a sentence", () => {
  assert.deepEqual(analyzeNameInput("我的名字叫 叶叶"), {
    value: "叶叶",
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

test("matches free text that means skipping taste", () => {
  const chips = [{ label: "还没看什么", set: { taste: "" }, next: "cardDone" }];
  assert.equal(matchChipIntent("我最近还没看什么", chips), chips[0]);
});

test("matches the dynamic avatar continue wording to the original next chip", () => {
  const chips = [
    { label: "＋ 传张头像", upload: true },
    { label: "用名字字头就好", next: "taste" },
  ];
  assert.equal(matchChipIntent("好了继续", chips), chips[1]);
});
