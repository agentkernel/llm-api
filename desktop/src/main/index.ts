import { app, BrowserWindow, nativeTheme, screen, shell } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc";
import { getTheme } from "./secureStore";
import { computeWindowBounds } from "./windowBounds";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // 必须在 app ready 后取 workAreaSize（DIP），窗口与最小尺寸都不得超过工作区
  const bounds = computeWindowBounds(screen.getPrimaryDisplay().workAreaSize);
  mainWindow = new BrowserWindow({
    ...bounds,
    center: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141416" : "#f7f7f5",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // 任何外部链接一律交给系统浏览器，窗口内禁止导航离开应用页面
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  // 真机冒烟测试模式：不建窗口，直接跑真实桌面栈并退出（受 WB_SMOKE 门控）。
  if (process.env.WB_SMOKE === "1") {
    const { runSmoke } = await import("./smoke");
    const result = await runSmoke();
    app.exit(result.ok ? 0 : 1);
    return;
  }

  nativeTheme.themeSource = getTheme();
  registerIpcHandlers(() => mainWindow);
  createWindow();

  // 截图模式：等 renderer 渲染完成后抓图退出，用于验证 UI 真实渲染（受 WB_SHOT 门控）。
  if (process.env.WB_SHOT) {
    const outPath = process.env.WB_SHOT;
    const win = mainWindow!;
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          const { writeFileSync } = await import("node:fs");
          writeFileSync(outPath, img.toPNG());
          console.log(`[shot] saved ${outPath}`);
          app.exit(0);
        } catch (error) {
          console.error(`[shot] failed: ${(error as Error).message}`);
          app.exit(1);
        }
      }, 2500);
    });
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
