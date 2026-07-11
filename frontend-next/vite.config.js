import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// 前端重构地基 (YOR-92)。dev 期所有 /api/* 走代理打到本地后端(假设1:本地 uvicorn :8000),
// 避免直连 prod / 烧 DeepSeek key。流式端点(story_turn_stream / SSE)关掉代理缓冲,逐字才出得来。
// AIS_API_TARGET(E2):可用环境变量把代理目标切到别的本地后端实例(如 8017 验证新引擎代码),
// 不设时维持 8000 原行为——已在跑的 dev server 不受影响。
const API_TARGET = process.env.AIS_API_TARGET || "http://localhost:8000";
export default defineConfig({
  plugins: [react()],
  // React Bits 组件用 @/ 导入(shadcn 别名);映射到 src。
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5182,
    // 临时公网隧道(cloudflared trycloudflare 随机域名)真机自测用:放开 Host 校验,否则 Vite 5 拦截非本机 Host。
    // 仅 dev;隧道地址私发(API 无鉴权)。HMR 浮层关掉,隧道下 WS 连不上也不挡手机屏。
    allowedHosts: true,
    hmr: { overlay: false },
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        // SSE:不缓冲,delta 逐块透传
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });
        },
      },
      // 卡片封面有些存成后端相对路径 /covers/xx.jpg(老前端 static mount),dev 期一并代理到后端,
      // 真封面才显示(否则只剩书脊占位)。/assets 同理(recon 立绘)。dev-only,不影响构建产物。
      "/covers": { target: API_TARGET, changeOrigin: true },
      "/assets": { target: API_TARGET, changeOrigin: true },
    },
  },
});
