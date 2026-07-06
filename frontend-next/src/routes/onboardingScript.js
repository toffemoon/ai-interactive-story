// 看板新手教程 · 对话式 onboarding 脚本(v1)。
// 隐藏式引导:糖沐用「店内语言」带新客逛书坊,选项 chip 推进,自由输入(称呼/口味)存进「回声」。
// 全前端 + 立绘差分切换,不动引擎。差分图编号对应见 PORTRAIT(编号=差分清单顺序,后续可核对微调)。
//
// 一拍(beat)的形状:
//   { id, emo, line(echo)->string,
//     field?: "name"|"taste",  // 该拍等自由输入,回车/发送写入 echo[field] 后进 next
//     next?: string,           // field 提交后去的下一拍 id
//     chips?: [{ label, set?, next?, to?, done? }] }
//       set  : 点后并入 echo(如「随便起一个」直接给个名)
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

// 化用玩家口味原话(截断,避免太长)。
function tasteQuote(echo) {
  const t = (echo && echo.taste) || "";
  return t.length > 16 ? t.slice(0, 16) + "…" : t;
}

export const FIRST_BEAT = "name";

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
    field: "name",
    next: "taste",
    chips: [{ label: "随便起一个", set: { name: "夜游客" }, next: "taste" }],
  },
  {
    id: "taste",
    emo: "smile",
    line: (e) =>
      `记下了,${e.name || "客人"}。卡上还差一行——最近在看什么?书也行、剧也行,随口说说;没有就说想看什么。`,
    field: "taste",
    next: "tour",
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
