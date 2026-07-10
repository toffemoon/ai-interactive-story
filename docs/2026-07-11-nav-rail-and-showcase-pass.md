# 全局导航 rail 化 + 探索页 showcase 货架 + 创作页 react-bits 触点

> 日期:2026-07-11
> 范围:`frontend-next` 全局导航壳(AppShell/StaggeredMenu)、探索页货架、创作页展示层。
> Linear:[YOR-211](https://linear.app/yorha/issue/YOR-211)(React Bits showcase on Explore;导航与创作页触点按 2026-06-19 合批放宽并入)。

## 先看结论

三个界面层改动,零后端接口变更:桌面导航从"默认全隐藏 + ☰ 唤出"改成**半常驻 icon rail + 悬停展开**;探索页卡片货架换成带 layout 动画的 ShowcaseGrid;创作页加了 StaggeredText / DepthCard / BlurHighlight 触点,为已批的"卡即界面"整页重做(`docs/2026-07-11-create-card-canvas-plan.md`)铺素材。全部动效遵守 prefers-reduced-motion 降级。

## 全局导航:icon rail + hover 展开

- 桌面静止时只显示窄 icon rail(lucide-react 图标:首页/探索/聊天/创作/我的/论坛),不再完全隐藏——入口可见性和"菜单默认收起"的旧决策折中。
- 鼠标悬停 rail 后展开完整 StaggeredMenu 错层大字菜单(GSAP timeline,带 hover 开/关双向防抖计时器,避免路过误触);点击「沐言」标识可**固定展开**(pinned),再点收起。
- 面板宽度、rail 宽度改为运行时测量(`getRailWidth`/`getPanelWidth`),不同视口不再靠硬编码。
- 手机(≤720px)不走 rail:沿用顶部 PillNav,`useIsMobile` 用 matchMedia 监听切换。
- `prefers-reduced-motion: reduce` 下全部动画退化为直接显隐。
- shell.css 中旧抽屉/底 tab 样式(-352 行)清除,导航样式收敛进 StaggeredMenu.css。

## 探索页:ShowcaseGrid 货架

- 新组件 `components/explore/ShowcaseGrid.jsx`:motion `layout` 弹簧动画(筛选/分页时卡片平滑重排)、收藏星标(乐观切换)、封面 loading/error 三态(失败退回结构化占位,不假装空货架)、`AnimatePresence` 进出场。
- Explore.jsx 从通用 `CardShelf`/`Chip` 切到 showcase 货架,筛选逻辑保持 07-10 版(类型/搜索/排序/题材)。
- reduced-motion 下 layout 动画时长归零。

## 创作页:react-bits 触点(canvas 重做前置)

- 标题用 `StaggeredText` 逐字入场;预览卡包 `DepthCard` 倾斜视差;`BlurHighlight` 用于叙述强调。
- 新增「起个头」建议行(SUGGESTS 预填指令 + 三点装饰),空白开局不再是干等输入。
- 新组件目录 `components/react-bits/`(depth-card / blur-highlight),后续 canvas 重做直接复用。
- **注意**:本批只动展示层,`/api/build_card` 等契约、desks localStorage 形状均未动;整页重做见已批计划 `docs/2026-07-11-create-card-canvas-plan.md`,红线以该文档为准。

## 依赖与体积

- 新依赖 `lucide-react@^1.24.0`(icon rail 与 showcase 角标)。
- 构建:主 JS **410.29 kB(gzip 138.49 kB)**,比 07-10 优化后的 393.88 kB(gzip 133.95)**回升约 16 kB**(lucide-react + motion 触点),仍低于优化前的 568.70 kB;Explore chunk 12.60 kB,Create chunk 61.10 kB。体积回升是本批的已知代价,后续 canvas 重做时统一复核。

## 验证

- `npm run build` 干净通过,产物 hash 稳定(两次构建一致)。
- `pytest -q` 25 passed(后端无回归)。
- 界面改动出自主理人 2026-07-11 本机迭代;合入前建议按 1440x900 / 390x844 快速走查 sidebar 悬停/固定、探索页筛选重排、创作页入场(同 YOR-210 验证口径)。
