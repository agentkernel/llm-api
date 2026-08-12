import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
    define: {
      // 构建期注入生产业务服务地址；发布流水线通过 WB_COMPANION_URL_PROD 提供。
      __WB_COMPANION_URL__: JSON.stringify(
        process.env.WB_COMPANION_URL_PROD ?? "https://assistant.ziyouxie.online",
      ),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
});
