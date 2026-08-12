import type { WBApi } from "@shared/types";

declare global {
  interface Window {
    wb: WBApi;
  }
}

export const wb: WBApi = window.wb;

/** 把 IPC 抛出的错误转成用户可读文案。 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Electron 会加 "Error invoking remote method 'xx': Error:" 前缀
  const cleaned = message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
  return cleaned || "操作失败，请重试";
}
