// 看板新手教程 · 对话式 onboarding 脚本(v1)。
// 隐藏式引导:糖沐用「店内语言」带新客逛书坊,选项 chip 推进,自由输入(称呼/口味)存进「回声」。
// 全前端 + 立绘差分切换,不动引擎。差分图编号对应见 PORTRAIT(编号=差分清单顺序,后续可核对微调)。
//
// 一拍(beat)的形状:
//   { id, emo, line(echo)->string,
//     field?: "name"|"taste",  // 该拍等自由输入,回车/发送写入 echo[field] 后进 next
//     next?: string,           // field 提交后去的下一拍 id
//     showCard?: true,         // 该拍身份卡常驻画面角,随 echo 逐行成形(登记段 name/taste/cardDone)
//     card?: true,             // 「卡办好」态:落章 + AI 现场写寄语(msg) + 可上传头像 + 提示翻面(Home 特殊渲染)
//     msg?: (echo)->string,    // card 拍卡背 AI 寄语的 prompt(现场生成;失败回退卡组件默认暖句)
//     tour?: string,           // 功能导览拍对应的功能路由(explore/chat/create/forum),供高亮/指入口用
//     chips?: [{ label, fill?, set?, next?, to?, done? }] }
//       fill : 点后把这段文字填进输入框(不直接发送),玩家确认/改再提交(点 3 反馈)
//       set  : 点后并入 echo
//       next : 点后推进到的拍 id
//       to   : 点后导航的路由(如 /explore)
//       done : 点后结束 onboarding(落地标记 + 退出引导态)

export const OB_KEY = "ais_onboarded_v1"; // 首访完成标记(有它 = 老用户,不再引导)
export const ECHO_KEY = "ais_ob_echo_v1"; // 回声:称呼/口味,身份卡与后续对话复用

// emo → 立绘差分图。编号按差分清单:
// 01常态笑 / 02歪头好奇 / 03眼睛发亮 / 04凑近小声 / 05得意 / 06递出 / 07温和欠身 / 08惊讶 / 09挥手迎接 / 10无奈笑
export const PORTRAIT = {
  smile: "/home/tangmu01.png",
  curious: "/home/tangmu02.png",
  spark: "/home/tangmu03.png",
  whisper: "/home/tangmu04.png",
  proud: "/home/tangmu05.png",
  offer: "/home/tangmu06.png",
  bow: "/home/tangmu07.png",
  surprise: "/home/tangmu08.png",
  wave: "/home/tangmu09.png",
  wry: "/home/tangmu10.png",
};

// 每张立绘的定位锚点(占图比例 0..1),从立绘 alpha 通道实测(tools/analyze_tangmu_anchors.py,PS精修后可重跑):
//   x    头中心横向(参考用)
//   y    头中心纵向 → 气泡纵向中心对齐到这里(齐头高)
//   edge 气泡纵向范围内的立绘身体左轮廓 → 气泡右缘落在这之前(避让该姿势的头/肩/手臂)
// 例:spark(tangmu03 抬拳)edge=0.211 明显更靠左,气泡就得更左才不撞拳头。真机微调改这张表即可。
export const HEAD = {
  smile: { x: 0.502, y: 0.153, edge: 0.355 }, // tangmu01 常态笑
  curious: { x: 0.517, y: 0.16, edge: 0.326 }, // tangmu02 歪头好奇
  spark: { x: 0.479, y: 0.188, edge: 0.211 }, // tangmu03 眼亮抬拳
  whisper: { x: 0.465, y: 0.194, edge: 0.267 }, // tangmu04 凑近小声
  proud: { x: 0.558, y: 0.153, edge: 0.369 }, // tangmu05 得意
  offer: { x: 0.476, y: 0.146, edge: 0.318 }, // tangmu06 递出
  bow: { x: 0.479, y: 0.176, edge: 0.275 }, // tangmu07 温和欠身
  surprise: { x: 0.533, y: 0.187, edge: 0.316 }, // tangmu08 惊讶
  wave: { x: 0.547, y: 0.206, edge: 0.341 }, // tangmu09 挥手
  wry: { x: 0.48, y: 0.149, edge: 0.279 }, // tangmu10 无奈笑
};
// 入场帧(背身 tangmu11 / 回头 tangmu12)
export const INTRO_HEAD = [
  { x: 0.493, y: 0.153, edge: 0.354 }, // tangmu11 背身
  { x: 0.499, y: 0.112, edge: 0.363 }, // tangmu12 回头
  { x: 0.517, y: 0.16, edge: 0.326 }, // tangmu02 转身正面(开场白第一句),同 curious 锚点
];

// 化用玩家口味原话(截断,避免太长)。
function tasteQuote(echo) {
  const t = (echo && echo.taste) || "";
  return t.length > 32 ? t.slice(0, 32).replace(/\s+\S*$/, "") + "…" : t;
}

export const FIRST_BEAT = "name";

// AI 自适应(点4/5):字段拍提交后,复用现成 /api/chat(看板同款端点,非引擎改动,前端只调用)让糖沐:
//   - 接住玩家的实际输入(点5:文案随输入变) + 软性处理空/乱码/捣乱(点4:AI 自检)
//   - 顺势引到下一步。产出的这句 = 下一拍的开场(替掉静态 line);AI 失败/超时则回退静态 line。
// beat.ai.scenario 只放「本拍任务」(玩家原话作为 user 传给 /api/chat,不塞进 scenario)。此段属糖沐行为=内容域。
export const AI_PERSONA =
  "You are Tangmu, the clerk and resident face of Muyan Bookshop. You're gentle and you love books. You talk like a shop clerk, with a touch of warmth, and you keep it short and natural (two or three sentences at most). Always stay in character and speak in the first person. Don't explain yourself, and never say \"as an AI\".";

// 导览拍自动连讲的停留时长(ms):到点自动进下一个功能介绍;点「继续」可提前,打字插话会暂停、答完再续。
export const AUTO_MS = 4600;
// 导览期玩家插话时,糖沐的回应场景(闲聊,不推进导览)。
export const CHAT_SCENARIO =
  "While you were showing the guest around the bookshop, they cut in with a remark or a question. Respond to what they said with a warm sentence or two in your shop-clerk voice (two or three sentences at most), then slip naturally back into the tone of someone carrying on with the tour. Don't rattle off lists, and don't ramble.";

// 入场演出:进 onboarding 先播这段(背身 → 回头),播完转身正面(tangmu02 好奇)进登记拍。
// 每帧 { img, line, dur(ms) };line 空则不显气泡(纯立绘演出)。
export const INTRO = [
  { img: "/home/tangmu11.png", line: "", dur: 1300 }, // 背身,忙店里的活
  { img: "/home/tangmu12.png", line: "Hm?", dur: 1200 }, // 回头,察觉生面孔
  // 转身正面,开场白第一句:先自报家门 + 点店名(有礼貌、立角色),再引出登记。第二句留给 name 拍(角色滑左 + 淡入卡)。
  // hold:true = 背身/回头自动播到这帧(正面对话)后停下、等点击推进(正面对话起才点击切换)。店主/世界观留到导览或办卡后带出。台词草稿·雨钦润色域。
  { img: "/home/tangmu02.png", line: "Oh, a new face! I'm Tangmu, the face of Muyan Bookshop. House rules from the owner: first-time guests get registered before anything else.", hold: true },
];

export const BEATS = [
  {
    id: "name",
    emo: "curious",
    showCard: true, // 登记起身份卡常驻画面角,随回声(称呼/口味)逐行成形;cardDone 拍再落章办好。
    // 第二句:此拍进入时角色滑到左边、右侧淡入身份卡(第一句在入场演出第三帧已讲)。
    line: () => "Here, this is your ID card. With it, you can come and go as you please. First things first: what should I call you?",
    // 从「口味」拍回退到这儿时,糖沐的反悔反应(草稿·待雨钦润色);backEmo=回退时的姿势。
    backLine: () => "Oh, back again? If you'd like a different name, that's fine. Just tell me the new one.",
    backEmo: "wry",
    field: "name",
    next: "avatar",
    ai: {
      // 辨别:糖沐判断这句是不是在正经报称呼。[OK]=是(填卡推进) / [CHAT]=闲聊(接话不填、停这拍)。
      scenario: () =>
        "You're registering a guest who just walked in, with their blank ID card laid out in front of you. The player's message is supposed to be the name they want to go by. First decide whether they're genuinely giving (or making up) a name for themselves:\n" +
        "· Yes (even a casual one, as long as it works as a name): start your reply with [OK], then naturally confirm it, work the name in lightly, mention that it's now on the card, and smoothly ask whether they'd like to add an avatar to the card (they can upload one, or just use their initial).\n" +
        "· No (they're asking you something back, making small talk, changing the subject, or it's empty / gibberish / a string of symbols / obvious trolling): start your reply with [CHAT], then chat warmly about what they said for a sentence or two without treating it as a name, and at the end gently steer back to \"So, what should I call you?\"\n" +
        "Put the tag at the very start, follow it with only the line itself, and don't explain the tag.",
    },
    chips: [{ label: "Make one up for me", fill: "Night Wanderer" }],
  },
  {
    // 头像拍:起完名字紧接着问头像(「起名字结束后就问头像」)。非 field 拍,靠 chip 传/不传;传了走 avatarLine 回应。
    id: "avatar",
    emo: "spark", // 眼亮期待
    showCard: true,
    line: (e) => `Got it, ${e.name || "friend"}. Your name's on the card now. Want to add an avatar? Upload one, or just use your initial.`,
    // 玩家上传头像后糖沐的即时回应(Home 在 obCardAvatar 有值时用它替 line,让"传头像"像一段对话)。
    avatarLine: () => "Ooh, that's a nice one. I've set it into your card.",
    backLine: (e) => `${e.name || "Friend"}, you can change your avatar whenever you like. Your initial looks clean on its own, too.`,
    backEmo: "smile",
    chips: [
      { label: "+ Upload an avatar", upload: true },
      { label: "Just use my initial", next: "taste" },
    ],
  },
  {
    id: "taste",
    emo: "smile",
    showCard: true,
    line: (e) =>
      `${e.name || "Friend"}, just one more line on your card. What have you been reading or watching lately? Books, shows, anything goes. If nothing comes to mind, that's fine too. No pressure.`,
    // 从「卡办好」拍回退到这儿时的反悔反应(草稿·待雨钦润色)。
    backLine: (e) => `${e.name || "Friend"}, your card's not finished and you've circled back already? Let's fill in this line again: what have you been into lately?`,
    backEmo: "wry",
    field: "taste",
    next: "cardDone",
    ai: {
      // 三分辨别:[OK]=报了口味(填卡) / [NONE]=明说没有/想不起来(推进但卡上记空,背面写暖句、不写书) / [CHAT]=闲聊岔开(接话不填、停这拍)。
      scenario: (e) =>
        `You're registering a new guest, "${e.name || "Guest"}". Their name is already on the card; only the "Lately into" line is left. The player's message is supposed to be what they've been reading or watching lately, or want to. First decide:\n` +
        "· They named a book, a show, or some kind of content (even briefly): start your reply with [OK], then naturally pick up on it, add a light comment, mention that you've added it to the card and the card is now done, and wrap up by offering to show them around the bookshop.\n" +
        "· They clearly say there's nothing / they haven't been reading anything / they can't remember / they'd rather not say: start your reply with [NONE] (this counts as a real answer, so don't press them), then accept it warmly (something like \"Perfect, plenty of time for that\"), say you'll leave this line blank for now and the card is still good to go, and wrap up by offering to show them around the bookshop.\n" +
        "· They're asking you something back, making small talk, changing the subject, or it's empty / gibberish / obvious trolling: start your reply with [CHAT], then chat about what they said for a sentence or two without treating it as their taste, and at the end steer back to \"So, what have you been into lately?\"\n" +
        "Put the tag at the very start, followed only by the line itself.",
    },
    chips: [{ label: "Nothing lately", set: { taste: "" }, next: "cardDone" }],
  },
  {
    // 卡办好:登记两行齐了,糖沐落章、AI 现场写寄语、可上传头像、提示翻面看背面。card:true → Home 触发办卡收尾态。
    // 你说的"卡在登记这儿给",所以位置从原来的末尾提前到登记之后、导览之前。
    id: "cardDone",
    emo: "offer", // 递出姿势 tangmu06
    card: true,
    showCard: true,
    // 头像已在前面的「头像拍」问过,这里只办卡:落章 + 寄语 + 递卡 → 导览。
    line: (e) =>
      `There we go, ${e.name || "friend"}. One stamp, and this card is yours. I wrote you a little something on the back; flip it over to see. Keep it safe, and let's go learn the ropes.`,
    // AI 寄语(卡背):糖沐亲手给这一位客人写的一句临别赠言(onboarding 现场生成;失败则用卡组件默认暖句)。
    msg: (e) =>
      `You are Tangmu, the face of Muyan Bookshop. You've just finished registering a new guest, "${e.name || "Guest"}" (they said they've lately been reading or watching, or want to: "${e.taste || "not said yet"}"). Now you're going to handwrite a single parting line for them on the back of their ID card. Requirements: one or two sentences, warm, like something written on the card just for this one person. You may lightly weave in their name or taste, but don't list things or rattle off titles. Output only the line itself: no quotation marks, no narration, no signature.`,
    chips: [{ label: "Show me around", next: "tourStory" }],
  },

  // ---- 功能导览 5 拍 · onboarding 后半段(台词草稿·雨钦润色域)。 ----
  // 逐个介绍网站能干嘛(不止命名);导览期身份卡收角落不打断。tour 字段=该拍对应的功能路由,供后续高亮/指入口用。
  // 注:tourStory(书架取书进故事) 与 tourExplore(书目自己找故事) 同指探索/进故事,略有重叠 —— 待雨钦定合并或保留。
  {
    id: "tourStory",
    emo: "spark",
    tour: "explore",
    line: (e) => {
      const t = tasteQuote(e);
      const hook = t ? `"${t}", huh? Then you've come to the right place. ` : "You've come to the right place. ";
      return hook + "First, the most important thing: those shelves behind me are full of books. Take one down, push open the door, and you walk right into that story as its lead. Where you go from there is entirely up to you.";
    },
    backLine: () => "Another look at the shelves? Take a book, push the door open, and you're the lead.",
    backEmo: "spark",
    chips: [{ label: "And then?", next: "tourChat" }],
  },
  {
    id: "tourChat",
    emo: "whisper",
    tour: "chat",
    line: () =>
      "If you just want a one-on-one with someone from a book, without stepping into the whole story, bring them out and sit down together in the café for a proper chat. Tell me who, and I'll call them over.",
    backLine: () => "Want to talk with someone on their own? Bring them out of their book and sit down for a chat.",
    backEmo: "whisper",
    chips: [{ label: "Anything else?", next: "tourCreate" }],
  },
  {
    id: "tourCreate",
    emo: "proud",
    tour: "create",
    line: () =>
      "Tired of the stories on our shelves? There's a workshop out back. Make your own characters, write your own worlds, build a whole story, and put it on the shelf for others to read.",
    backLine: () => "The workshop out back? Make your own characters, write stories, and shelve them for others to read.",
    backEmo: "proud",
    chips: [{ label: "Go on", next: "tourExplore" }],
  },
  {
    id: "tourExplore",
    emo: "wave",
    tour: "explore",
    line: () =>
      "And you don't have to wait for me to recommend something. Browse the Catalog by the door yourself and pick by mood or by taste. The crowd favorites and the hidden gems are all in there.",
    backLine: () => "The Catalog? Browse it yourself and pick stories to your taste.",
    backEmo: "wave",
    chips: [{ label: "Last one", next: "tourForum" }],
  },
  {
    id: "tourForum",
    emo: "smile",
    tour: "forum",
    line: () =>
      "There's also the Tea Corner. Readers of the same books meet up there to talk plot, swap story picks, and leave a few words. When you're tired of browsing, go sit for a while and meet some people.",
    backLine: () => "The Tea Corner? That's where readers meet up to talk plot and swap story picks.",
    backEmo: "smile",
    chips: [
      { label: "Take me to my first book", to: "/explore", done: true },
      { label: "I'll look around myself", done: true },
    ],
  },
];

export function beatById(id) {
  return BEATS.find((b) => b.id === id) || null;
}

// 读/写回声(容错)。
export function loadEcho() {
  try {
    return JSON.parse(localStorage.getItem(ECHO_KEY) || "null") || {};
  } catch (e) {
    return {};
  }
}
export function saveEcho(echo) {
  try {
    localStorage.setItem(ECHO_KEY, JSON.stringify(echo || {}));
  } catch (e) {}
}
export function isOnboarded() {
  try {
    return !!localStorage.getItem(OB_KEY);
  } catch (e) {
    return false;
  }
}
export function markOnboarded() {
  try {
    localStorage.setItem(OB_KEY, "1");
  } catch (e) {}
}
