import test from "node:test";
import assert from "node:assert/strict";

import { resolveMediaUrl } from "./mediaUrl.js";

test("maps the known Tangmu legacy portrait to the existing canonical asset", () => {
  assert.equal(resolveMediaUrl("assets/cards/tangmu-main.jpg"), "/home/tangmu01.png");
  assert.equal(resolveMediaUrl("/assets/cards/tangmu-main.jpg"), "/home/tangmu01.png");
  assert.equal(
    resolveMediaUrl("https://example.invalid/assets/cards/tangmu-main.jpg?version=old"),
    "/home/tangmu01.png"
  );
});

test("drops the obsolete Tangmu avatar so callers use their text fallback", () => {
  assert.equal(resolveMediaUrl("assets/cards/tangmu-avatar.jpg"), "");
  assert.equal(resolveMediaUrl("/assets/cards/tangmu-avatar.jpg#legacy"), "");
});

test("leaves current media URLs and empty values unchanged", () => {
  assert.equal(resolveMediaUrl("/home/tangmu01.png"), "/home/tangmu01.png");
  assert.equal(resolveMediaUrl("data:image/png;base64,abc"), "data:image/png;base64,abc");
  assert.equal(resolveMediaUrl(""), "");
  assert.equal(resolveMediaUrl(null), null);
});
