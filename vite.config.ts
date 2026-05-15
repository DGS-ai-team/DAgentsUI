import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Electron loadFile 使用 file:// 协议，必须用相对资源路径，否则 /assets/* 会指向本机根目录导致白屏
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
