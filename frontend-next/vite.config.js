import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 前端重构地基 (YOR-92)。dev 期所有 /api/* 走代理打到本地后端(假设1:本地 uvicorn :8000),
// 避免直连 prod / 烧 DeepSeek key。流式端点(story_turn_stream / SSE)关掉代理缓冲,逐字才出得来。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5182,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
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
      "/covers": { target: "http://localhost:8000", changeOrigin: true },
      "/assets": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
