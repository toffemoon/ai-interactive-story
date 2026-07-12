// 酒馆(SillyTavern)chara_card_v2 角色卡导入:JSON 文件 + PNG 内嵌卡(tEXt chunk)。
// 纯前端解析:零请求、零入库、零新依赖(PNG chunk 手写读取)。
// 只收与本引擎 CharacterData(src/models.py)同名的字段——白名单必须与后端
// _validate_build_draft 的 model_fields 过滤对齐,否则会出现「导入看着成功,聊一句就丢」的静默失败。

// 类型与 src/models.py CharacterData 对齐:散文字段=str,规则/标签类=list[str]。
const STRING_FIELDS = [
  "name", "description", "personality", "scenario", "first_mes", "mes_example",
  "anchor", "tension", "look",
];
const LIST_FIELDS = ["speech_rules", "tags", "keys", "versions", "known_public", "known_hidden"];
const FIELD_WHITELIST = [...STRING_FIELDS, ...LIST_FIELDS];

// 值规整:手工构造的 JSON 可能在 name 塞数字、tags 塞对象——不规整直落 draft 会被
// 渲染层的 string 假定崩掉且脏数据已持久化(localStorage),刷新都救不回。
// 类型不符且救不回来的值 → undefined(调用方计入 dropped 如实播报)。
function normalizeField(k, v) {
  if (STRING_FIELDS.includes(k)) {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return undefined; // 对象/数组塞进散文字段=形状不符,弃
  }
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : undefined;
  if (!arr) return undefined;
  const out = arr
    .map((x) => (typeof x === "string" ? x : typeof x === "number" || typeof x === "boolean" ? String(x) : ""))
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

// 按白名单收字段并按后端类型规整;酒馆特有键(character_book/alternate_greetings/
// system_prompt/creator_notes…)与类型不符救不回的值都进 dropped 如实展示,不静默吞。
export function pickDraftFields(v2data) {
  const src = v2data && typeof v2data === "object" && !Array.isArray(v2data) ? v2data : {};
  const draft = {};
  const dropped = [];
  for (const [k, v] of Object.entries(src)) {
    if (v == null || v === "") continue;
    if (!FIELD_WHITELIST.includes(k)) {
      dropped.push(k);
      continue;
    }
    const nv = normalizeField(k, v);
    if (nv === undefined) dropped.push(k);
    else draft[k] = nv;
  }
  return { draft, dropped };
}

// 世界书桥:V2 的 character_book.entries 文本拼接(给「挂为参考资料」用,D1 seed 截 6000)。
export function extractBookText(v2data) {
  const book = v2data && v2data.character_book;
  const entries = book && Array.isArray(book.entries) ? book.entries : [];
  const lines = entries
    .map((e) => {
      const keys = Array.isArray(e.keys) ? e.keys.join("/") : "";
      const content = typeof e.content === "string" ? e.content.trim() : "";
      if (!content) return "";
      return (keys ? `【${keys}】` : "") + content;
    })
    .filter(Boolean);
  return lines.join("\n");
}

export function parseJsonCard(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error("不是合法的 JSON 文件");
  }
  const data = obj && typeof obj === "object" && obj.data && typeof obj.data === "object" ? obj.data : obj;
  const { draft, dropped } = pickDraftFields(data);
  if (!Object.keys(draft).length) throw new Error("没读到可用的卡字段(需要 chara_card_v2 结构)");
  return { draft, dropped, bookText: extractBookText(data) };
}

// 大数组不能 String.fromCharCode(...bytes)(参数上限会炸),分块拼。
function latin1(bytes) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

// PNG 布局:[8B 签名][chunk: 4B 长度 BE | 4B 类型 | data | 4B CRC]…
// 只读不写:不校验 CRC;全程做 length 越界防护;zTXt/iTXt(压缩变体)诚实报错引导导 JSON。
export function parsePngCard(buf) {
  const dv = new DataView(buf);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.byteLength < 8 || !SIG.every((b, i) => dv.getUint8(i) === b)) {
    throw new Error("不是 PNG 文件");
  }
  let off = 8;
  let sawCompressedText = false;
  while (off + 12 <= buf.byteLength) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(
      dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7)
    );
    if (off + 12 + len > buf.byteLength) break; // 坏文件:声明长度越界,停止扫描
    if (type === "tEXt") {
      const bytes = new Uint8Array(buf, off + 8, len);
      let z = -1;
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) { z = i; break; }
      }
      if (z > 0) {
        const key = latin1(bytes.subarray(0, z));
        if (key === "chara" || key === "ccv3") {
          let jsonText;
          try {
            const b64 = latin1(bytes.subarray(z + 1));
            const bin = atob(b64.replace(/\s+/g, ""));
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            jsonText = new TextDecoder("utf-8").decode(out);
          } catch (e) {
            throw new Error("卡数据解码失败(base64/编码损坏)");
          }
          return parseJsonCard(jsonText);
        }
      }
    } else if (type === "zTXt" || type === "iTXt") {
      sawCompressedText = true;
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  throw new Error(
    sawCompressedText
      ? "这张 PNG 的卡数据是压缩格式(zTXt/iTXt),暂不支持——请在酒馆里导出为 JSON 再导入"
      : "这张 PNG 里没有内嵌角色卡数据"
  );
}
