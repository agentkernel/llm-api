/** 主窗口初始尺寸：默认值与主屏工作区取较小者，保证任何分辨率/缩放下完整落屏。 */

export const DEFAULT_WINDOW_SIZE = {
  width: 1080,
  height: 720,
  minWidth: 920,
  minHeight: 600,
} as const;

export interface WindowBounds {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/**
 * 按主屏 workArea（DIP）夹取窗口初始尺寸与最小尺寸。
 * 高 DPI 缩放或小分辨率（如 200% 缩放下逻辑工作区仅 720x430）时，
 * 固定的 1080x720 / min 920x600 会让窗口超出屏幕且无法缩小，必须全部夹取。
 */
export function computeWindowBounds(workArea: { width: number; height: number }): WindowBounds {
  const width = Math.min(DEFAULT_WINDOW_SIZE.width, Math.max(1, workArea.width));
  const height = Math.min(DEFAULT_WINDOW_SIZE.height, Math.max(1, workArea.height));
  return {
    width,
    height,
    minWidth: Math.min(DEFAULT_WINDOW_SIZE.minWidth, width),
    minHeight: Math.min(DEFAULT_WINDOW_SIZE.minHeight, height),
  };
}
