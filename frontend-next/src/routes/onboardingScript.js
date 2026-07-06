// 看板新手教程 · 对话式 onboarding 脚本(v1)。
// 隐藏式引导:糖沐用「店内语言」带新客逛书坊,选项 chip 推进,自由输入(称呼/口味)存进「回声」。
// 全前端 + 立绘差分切换,不动引擎。差分图编号对应见 PORTRAIT(编号=差分清单顺序,后续可核对微调)。
//
// 一拍(beat)的形状:
//   { id, emo, line(echo)->string,
//     field?: "name"|"taste",  // 该拍等自由输入,回车/发送写入 echo[field] 后进 next
//     next?: string,           // field 提交后去的下一拍 id
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

// 入场演出:进 onboarding 先播这段(背身 → 回头),播完转身正面(tangmu02 好奇)进登记拍。
// 每帧 { img, line, dur(ms) };line 空则不显气泡(纯立绘演出)。
export const INTRO = [
  { img: "/home/tangmu11.png", line: "", dur: 1300 }, // 背身,忙店里的活
  { img: "/home/tangmu12.png", line: "哎?", dur: 1200 }, // 回头,察觉生面孔
];

export const BEATS = [
  {
    id: "name",
    emo: "curious",
    line: () =>
      "哎,生面孔。头回来的客人,按店主的规矩得先登记一下——回头给你张身份卡,凭卡随便出入这儿。怎么称呼你?",
    // 从「口味」拍回退到这儿时,糖沐的反悔反应(草稿·待雨钦润色);backEmo=回退时的姿势。
    backLine: () => "咦,又踅回来了?名字想换就换——重新报一个便是。",
    backEmo: "wry",
    field: "name",
    next: "taste",
    ai: {
      scenario: () =>
        "你正在给刚进门的新客做登记。玩家这条消息是他报上的称呼。请:自然确认、回应这个称呼(可轻轻化用它),再顺势引到下一步——问他最近在看什么(书也行、剧也行,随口说说;没有就说想看什么)。若这个称呼是空/乱码/一串符号/明显在捣乱,就温和地请他正经报一个(这时先别引下一步)。",
    },
    chips: [{ label: "随便起一个", fill: "夜游客" }],
  },
  {
    id: "taste",
    emo: "smile",
    line: (e) =>
      `记下了,${e.name || "客人"}。卡上还差一行——最近在看什么?书也行、剧也行,随口说说;没有就说想看什么。`,
    // 从「认识书坊」拍回退到这儿时的反悔反应(草稿·待雨钦润色)。
    backLine: (e) => `${e.name || "客人"},书还没进门呢又绕回来了?最近在看什么,这行再补补——`,
    backEmo: "wry",
    field: "taste",
    next: "tour",
    ai: {
      scenario: (e) =>
        `你正在给新客「${e.name || "客人"}」做登记。玩家这条消息是他说的最近在看/想看的东西。请:自然接住这个口味(可轻评一句),再顺势引到下一步——说要带他认识书坊的门道:身后那排书架就是「书」,取一本、推开门就走进故事里当回主角;想单独找书里某个人说说话,你把人请出来、坐咖啡厅慢慢聊;要造他自己的角色和故事,就去后头的工坊。若他这条是空/乱码/明显捣乱,就温和带过再引。`,
    },
    chips: [{ label: "先跳过", set: { taste: "" }, next: "tour" }],
  },
  {
    id: "tour",
    emo: "spark",
    line: (e) => {
      const t = tasteQuote(e);
      const hook = t ? `聊到「${t}」——那你可来对地方了。` : "来对地方了。";
      return (
        hook +
        "跟你说这儿的门道:我身后那排书架就是「书」,取一本、推开门就走进故事里当回主角;" +
        "想单独找书里某个人说说话,我把人请出来、坐咖啡厅慢慢聊;要造你自己的角色和故事,就去后头的工坊。"
      );
    },
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
