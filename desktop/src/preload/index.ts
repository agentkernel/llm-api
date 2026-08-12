import { contextBridge, ipcRenderer } from "electron";
import type { ThemeMode, WBApi } from "@shared/types";
import { IPC } from "@shared/types";

/** 白名单桥接：renderer 只能调用以下方法，接触不到 Node/Electron 原生能力。 */
const api: WBApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  register: () => ipcRenderer.invoke(IPC.register),
  redeem: (code: string) => ipcRenderer.invoke(IPC.redeem, code),

  listPackages: () => ipcRenderer.invoke(IPC.listPackages),
  createPurchase: (packageId: number, paymentType: "alipay" | "wxpay") =>
    ipcRenderer.invoke(IPC.createPurchase, packageId, paymentType),
  getPurchaseStatus: (outTradeNo: string) => ipcRenderer.invoke(IPC.getPurchaseStatus, outTradeNo),
  confirmPurchase: (outTradeNo: string) => ipcRenderer.invoke(IPC.confirmPurchase, outTradeNo),
  listPurchases: () => ipcRenderer.invoke(IPC.listPurchases),

  getPointsSummary: (days) => ipcRenderer.invoke(IPC.getPointsSummary, days),

  fetchModels: () => ipcRenderer.invoke(IPC.fetchModels),
  applyModels: (selectedIds: string[]) => ipcRenderer.invoke(IPC.applyModels, selectedIds),
  testModel: (modelId: string) => ipcRenderer.invoke(IPC.testModel, modelId),

  listBackups: () => ipcRenderer.invoke(IPC.listBackups),
  restoreBackup: (id: string) => ipcRenderer.invoke(IPC.restoreBackup, id),

  getTheme: () => ipcRenderer.invoke(IPC.getTheme),
  setTheme: (mode: ThemeMode) => ipcRenderer.invoke(IPC.setTheme, mode),
  onSystemThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_event: unknown, isDark: boolean) => callback(isDark);
    ipcRenderer.on(IPC.systemThemeChanged, listener);
    return () => ipcRenderer.removeListener(IPC.systemThemeChanged, listener);
  },
};

contextBridge.exposeInMainWorld("wb", api);
