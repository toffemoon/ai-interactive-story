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
  return t.length > 16 ? t.slice(0, 16) + "…" : t;
}

export const FIRST_BEAT = "name";

// AI 自适应(点4/5):字段拍提交后,复用现成 /api/chat(看板同款端点,非引擎改动,前端只调用)让糖沐:
//   - 接住玩家的实际输入(点5:文案随输入变) + 软性处理空/乱码/捣乱(点4:AI 自检)
//   - 顺势引到下一步。产出的这句 = 下一拍的开场(替掉静态 line);AI 失败/超时则回退静态 line。
// beat.ai.scenario 只放「本拍任务」(玩家原话作为 user 传给 /api/chat,不塞进 scenario)。此段属糖沐行为=内容域。
export const AI_PERSONA =
  "你是糖沐,沐言书坊的店员、看板娘。温和爱书,店员口吻,话里带点暖意,简短自然(最多两三句)。始终留在角色里,用第一人称,不解释、不说「作为AI」。";

// 导览拍自动连讲的停留时长(ms):到点自动进下一个功能介绍;点「继续」可提前,打字插话会暂停、答完再续。
export const AUTO_MS = 4600;
// 导览期玩家插话时,糖沐的回应场景(闲聊,不推进导览)。
export const CHAT_SCENARIO =
  "玩家在你带他熟悉书坊时插了句话、或问了个问题。就着他的话、用店员口吻温和答一两句(最多两三句),答完自然回到接着带他逛的语气。别报菜名、别长篇。";

// 入场演出:进 onboarding 先播这段(背身 → 回头),播完转身正面(tangmu02 好奇)进登记拍。
// 每帧 { img, line, dur(ms) };line 空则不显气泡(纯立绘演出)。
export const INTRO = [
  { img: "/home/tangmu11.png", line: "", dur: 1300 }, // 背身,忙店里的活
  { img: "/home/tangmu12.png", line: "哎?", dur: 1200 }, // 回头,察觉生面孔
  // 转身正面,开场白第一句:先自报家门 + 点店名(有礼貌、立角色),再引出登记。第二句留给 name 拍(角色滑左 + 淡入卡)。
  // hold:true = 背身/回头自动播到这帧(正面对话)后停下、等点击推进(正面对话起才点击切换)。店主/世界观留到导览或办卡后带出。台词草稿·雨钦润色域。
  { img: "/home/tangmu02.png", line: "哎,生面孔——我是糖沐,沐言书坊的看板娘。头回来的客人,按店主的规矩得先登记一下。", hold: true },
];

export const BEATS = [
  {
    id: "name",
    emo: "curious",
    showCard: true, // 登记起身份卡常驻画面角,随回声(称呼/口味)逐行成形;cardDone 拍再落章办好。
    // 第二句:此拍进入时角色滑到左边、右侧淡入身份卡(第一句在入场演出第三帧已讲)。
    line: () => "喏,这张就是你的身份卡,凭它随便出入这儿。先说,怎么称呼你?",
    // 从「口味」拍回退到这儿时,糖沐的反悔反应(草稿·待雨钦润色);backEmo=回退时的姿势。
    backLine: () => "咦,又踅回来了?名字想换就换——重新报一个便是。",
    backEmo: "wry",
    field: "name",
    next: "avatar",
    ai: {
      // 辨别:糖沐判断这句是不是在正经报称呼。[OK]=是(填卡推进) / [CHAT]=闲聊(接话不填、停这拍)。
      scenario: () =>
        "你正在给刚进门的新客做登记,面前摊着他空白的身份卡。玩家这条消息本该是他报上的称呼。先判断这是不是在正经给自己起/报一个称呼:\n" +
        "· 是(哪怕随意,只要能当名字用):回复以 [OK] 开头,随后自然确认、轻轻化用这个称呼、提一句已落到卡上,再顺势问他要不要给卡贴张头像(传一张,或用名字的字头也成)。\n" +
        "· 不是(在反问你、闲聊、岔开话题、或空/乱码/一串符号/明显在捣乱):回复以 [CHAT] 开头,随后就着他的话温和聊一两句、别把这句当成名字,末了轻轻把话头引回「那,我该怎么称呼你」。\n" +
        "标记放在最前面,之后只跟台词本身,别解释标记。",
    },
    chips: [{ label: "随便起一个", fill: "夜游客" }],
  },
  {
    // 头像拍:起完名字紧接着问头像(「起名字结束后就问头像」)。非 field 拍,靠 chip 传/不传;传了走 avatarLine 回应。
    id: "avatar",
    emo: "spark", // 眼亮期待
    showCard: true,
    line: (e) => `记下了,${e.name || "客人"}——卡上有名了。想给卡贴张头像吗? 传一张,或者用你名字的字头也成。`,
    // 玩家上传头像后糖沐的即时回应(Home 在 obCardAvatar 有值时用它替 line,让"传头像"像一段对话)。
    avatarLine: () => "诶,这张好看——给你嵌卡上了。",
    backLine: (e) => `${e.name || "客人"},头像想换就换,不换用字头也清爽。`,
    backEmo: "smile",
    chips: [
      { label: "＋ 传张头像", upload: true },
      { label: "用名字字头就好", next: "taste" },
    ],
  },
  {
    id: "taste",
    emo: "smile",
    showCard: true,
    line: (e) =>
      `${e.name || "客人"},卡上就差最后一行了——最近在看什么? 书、剧都行,随口说说;没有就说没有,不勉强。`,
    // 从「卡办好」拍回退到这儿时的反悔反应(草稿·待雨钦润色)。
    backLine: (e) => `${e.name || "客人"},卡还没办完呢又绕回来了?最近在看什么,这行再补补——`,
    backEmo: "wry",
    field: "taste",
    next: "cardDone",
    ai: {
      // 三分辨别:[OK]=报了口味(填卡) / [NONE]=明说没有/想不起来(推进但卡上记空,背面写暖句、不写书) / [CHAT]=闲聊岔开(接话不填、停这拍)。
      scenario: (e) =>
        `你正在给新客「${e.name || "客人"}」做登记,卡上称呼已填好,就差「最近在看」这一行。玩家这条消息本该是他说的最近在看/想看的东西。先判断:\n` +
        "· 说了某本书/某部剧/某类内容(哪怕简短):回复以 [OK] 开头,随后自然接住、轻评一句、提补到卡上、卡这便办好,收尾说带他认认书坊。\n" +
        "· 明说没有 / 最近没看 / 想不起来 / 不想说:回复以 [NONE] 开头(这也算正经回答,别追问),随后温和接住(如「那正好,来日方长」)、说这行先空着、卡照办,收尾带他认书坊。\n" +
        "· 在反问你、闲聊、岔开、或空/乱码/明显在捣乱:回复以 [CHAT] 开头,随后就着他的话聊一两句、别把这句当口味,末了把话头引回「那,最近都在看点什么」。\n" +
        "标记放在最前面,之后只跟台词本身。",
    },
    chips: [{ label: "还没看什么", set: { taste: "" }, next: "cardDone" }],
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
      `好——${e.name || "客人"},章一盖,这卡就是你的了。背面我给你写了句话,翻过来能瞧见。收好,咱这就去认认门道。`,
    // AI 寄语(卡背):糖沐亲手给这一位客人写的一句临别赠言(onboarding 现场生成;失败则用卡组件默认暖句)。
    msg: (e) =>
      `你是沐言书坊的看板娘糖沐。你刚给新到店的客人「${e.name || "客人"}」办完入店登记(他说最近在看/想看:「${e.taste || "还没说"}」),现在要在他身份卡的背面,亲手给他写一句临别赠言。要求:就一两句、温暖、像手写在卡上给这一个人的话;可轻轻化用他的称呼或口味,但别罗列、别报菜名。只输出这句话本身,不带引号、不带旁白、不带落款。`,
    chips: [{ label: "带我认认这儿", next: "tourStory" }],
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
      const hook = t ? `聊到「${t}」——那你可来对地方了。` : "来对地方了。";
      return hook + "先说最要紧的:我身后那排书架就是「书」。取一本、推开门,你就走进那个故事里当回主角,往哪儿走全看你。";
    },
    backLine: () => "书架的门道再看一眼?——取一本推门进去,你就是主角。",
    backEmo: "spark",
    chips: [{ label: "然后呢", next: "tourChat" }],
  },
  {
    id: "tourChat",
    emo: "whisper",
    tour: "chat",
    line: () =>
      "要是只想找书里某个人单独说说话——不进整个故事,就把他请出来,坐咖啡厅慢慢聊。想聊谁,我替你叫。",
    backLine: () => "想单独找人聊那处?——把书里的人请出来,坐下慢慢说。",
    backEmo: "whisper",
    chips: [{ label: "还有吗", next: "tourCreate" }],
  },
  {
    id: "tourCreate",
    emo: "proud",
    tour: "create",
    line: () =>
      "店里的故事看腻了,后头还有间工坊——自己造角色、写世界、搭一整个故事出来,摆上书架给旁人读。",
    backLine: () => "后头那间工坊?——自己造角色、写故事,摆上架给人读。",
    backEmo: "proud",
    chips: [{ label: "继续", next: "tourExplore" }],
  },
  {
    id: "tourExplore",
    emo: "wave",
    tour: "explore",
    line: () =>
      "找故事不用干等我推荐——门口那面「书目」你自己翻,按心情、按口味挑,热闹的冷门的都在里头。",
    backLine: () => "那面书目?——自己翻,按口味挑故事。",
    backEmo: "wave",
    chips: [{ label: "最后一个", next: "tourForum" }],
  },
  {
    id: "tourForum",
    emo: "smile",
    tour: "forum",
    line: () =>
      "还有个「茶座」——读一样书的客人在那儿碰头,聊剧情、荐故事、留几句话。逛累了就去坐坐,认识认识人。",
    backLine: () => "那处茶座?——读者碰头,聊剧情、荐故事。",
    backEmo: "smile",
    chips: [
      { label: "带我进第一本书", to: "/explore", done: true },
      { label: "我自己逛逛", done: true },
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
