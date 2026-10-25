// 新手引导 · 柜台两边的文字:糖沐的台词、柜台上的提示、登记簿上印的字。
// 单独一个文件,首页静态引入它也不会把 three.js 一起拉进主包(平面登记纸也用这份)。
export const TEXT = {
  zh: {
    lines: {
      enter: "推开门，柜台后有个人背对着你在理书。",
      huh: "「哎？」",
      hello: "「生面孔呢。我是糖沐，这家书坊的看板娘。头回来的客人，要先登记一下哦。」",
      nudge: "「登记簿就在你面前，翻开就好。」",
      poke: ["「诶？」", "「别戳啦，先登记嘛。」"],
      ask: "「来，在登记簿上写个名字吧。」",
      suggest: (n) => `「叫『${n}』怎么样？」`,
      empty: "「名字还空着呢。」",
      done: (n) => `「记下了，${n}。」`,
      // the two places named are the nav's own labels
      next: "「书都在『探索』里，想随便聊聊就去『纯聊』。拿张书签吧。」",
    },
    suggestions: ["夜读人", "过路客", "雨天来的人", "窗边座位"],
    hintOpen: "点封面，翻开登记簿",
    hintOpenTouch: "点封面，翻开",
    hintWrite: "直接打字",
    hintWriteTouch: "点这里写名字",
    // printed in the register and on its cover
    slip: "访客登记",
    title: "访客登记",
    shop: "沐言书坊",
    cols: ["日期", "名字", "店章"],
    serif: '"Noto Serif SC", "Songti SC", serif',
  },
  en: {
    lines: {
      enter: "You push the door open. Behind the counter, someone has their back to you, sorting books.",
      huh: "“Oh?”",
      hello: "“A new face! I'm Tangmu, I look after this bookshop. First-time guests sign the register.”",
      nudge: "“The register's right in front of you. Just open it.”",
      poke: ["“Eh?”", "“Hey, no poking. Sign in first.”"],
      ask: "“Go on, write your name in the register.”",
      suggest: (n) => `“How about ‘${n}’?”`,
      empty: "“The name line is still empty.”",
      done: (n) => `“Got it, ${n}.”`,
      next: "“The books are all in Explore, and if you just want to talk, try Chat. Take a bookmark.”",
    },
    suggestions: ["Night Reader", "Passerby", "Rainy Day", "Window Seat"],
    hintOpen: "Click the cover to open the register",
    hintOpenTouch: "Tap the cover to open it",
    hintWrite: "Just type",
    hintWriteTouch: "Tap here to write your name",
    slip: "Guest Register",
    title: "Guest Register",
    shop: "Muyan Bookshop",
    cols: ["Date", "Name", "Seal"],
    serif: 'Georgia, "Times New Roman", serif',
  },
};
