# 首页 UI 与性能优化 · 第一批

> 日期:2026-07-10
> 范围:`frontend-next` 首页,不改故事引擎、立绘双层交叉溶解或身份卡几何。
> Linear:[YOR-209](https://linear.app/yorha/issue/YOR-209/optimization-homepage-react-bits-ui-and-performance-first-pass)

## 目标

在不重做视觉方向的前提下,让首页台词和角色切换更顺,同时清掉空闲状态下不必要的动画开销。

## 已完成

- 接入 React Bits `StaggeredText` 的纯 CSS 版本,用于首页和 onboarding 台词。忙碌提示不做逐字动画,系统开启“减少动态效果”时直接静态显示。
- 接入 React Bits `AnimatedList` 的纯 CSS 版本,用于“换个人聊”列表。原按钮语义和直接点击选择保持不变。
- `ClickSpark` 改为点击后才启动 RAF 和分配画布,播放结束恢复为 `1x1`;DPR 上限为 2,键盘合成点击和减少动态效果模式不生成火花。
- 菜单打开时增加真实点击遮罩,不再穿透到首页按钮;关闭时 6 个离屏链接不可 Tab 聚焦,并支持 Esc 关闭。
- 全屏截图态隐藏实际的 `.staggered-menu-header` 和续玩浮条。
- onboarding 整屏推进层改为可聚焦按钮,支持 Enter / 空格。
- 拆开重复路由:`/test` 保留导航原型,`/test/onboarding` 专门测试新手引导。

## 验收

- `npm run build`:通过。
- `.venv/Scripts/python.exe -m pytest -q`:18 passed。
- 浏览器回归:1440x900、390x844、844x390 均无横向溢出或控件重叠。
- 菜单遮罩实点 CTA 所在位置后仍停在 `#/home`;关闭后菜单链接全部为 `tabIndex=-1`。
- ClickSpark 实测空闲 `1x1`,播放时按视口分配,约 650ms 后回到 `1x1`。
- bundle 对比:JS 原始体积约增加 8.9 KB,gzip 约增加 2.7 KB;没有引入 Tailwind、Three.js 或 WebGL。

## 下一批

- 图片 WebP/AVIF、尺寸集和延迟解码单独处理,先做视觉无损对照。
- 路由拆包单独处理,避免和 UI 动效混在同一个回归面。
- onboarding 横屏重排、modal 焦点陷阱和 Escape 语义继续补齐。
