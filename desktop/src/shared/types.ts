/** main ⇄ renderer 共享类型。renderer 永远接触不到 apiKey / 设备令牌。 */

export type ThemeMode = "system" | "light" | "dark";

export interface AppState {
  deviceUuid: string | null;
  activated: boolean;
  points: number | null;
  currentGroupId: number | null;
  currentPackageId: number | null;
  companionReachable: boolean;
  workbuddyConfigPath: string;
  workbuddyConfigExists: boolean;
  appVersion: string;
}

export interface ModelOption {
  modelId: string;
  displayName: string;
  vendor: string;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  supportsToolCall: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  /** 网关是否对当前 key 提供该模型（目录∩网关 交集内恒为 true）。 */
  available: boolean;
  reasoning: Record<string, unknown> | null;
}

export interface ModelsFetchResult {
  models: ModelOption[];
  gatewayTotal: number;
  catalogTotal: number;
  /** 网关返回但目录未适配而被隐藏的数量（仅提示用）。 */
  hiddenCount: number;
}

export interface ApplyResult {
  written: number;
  backupId: string;
  configPath: string;
}

export interface BackupEntry {
  id: string;
  createdAt: string;
  sha256: string;
  sizeBytes: number;
  modelCount: number | null;
}

export interface PackageOption {
  id: number;
  name: string;
  description: string;
  priceCny: number;
  points: number;
  targetGroupId: number;
  targetGroupName: string;
}

export interface PurchaseCreated {
  outTradeNo: string;
  qrDataUrl: string | null;
  payUrl: string | null;
  amountCny: number;
  points: number;
  expiresAt: string;
}

export type PurchaseStatus =
  | "pending"
  | "paid_pending_redeem"
  | "redeeming"
  | "redeemed"
  | "expired"
  | "cancelled"
  | "failed";

export interface PurchaseOrder {
  outTradeNo: string;
  status: PurchaseStatus;
  amountCny: number;
  points: number;
  paymentType: string;
}

export interface PointsSummary {
  currentPoints: number;
  frozenPoints: number;
  totalRecharged: number;
  periodUsage: number;
  periodRequests: number;
  daily: Array<{ date: string; points: number; requests: number }>;
  models: Array<{ model: string; points: number; requests: number }>;
  rangeDays: number;
}

export interface RedeemResult {
  points: number;
  groupId: number | null;
  packageId: number | null;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number | null;
  message: string;
}

export interface WBApi {
  getState(): Promise<AppState>;
  register(): Promise<AppState>;
  redeem(code: string): Promise<RedeemResult>;

  listPackages(): Promise<PackageOption[]>;
  createPurchase(packageId: number, paymentType: "alipay" | "wxpay"): Promise<PurchaseCreated>;
  getPurchaseStatus(outTradeNo: string): Promise<{ status: PurchaseStatus; points: number }>;
  confirmPurchase(outTradeNo: string): Promise<RedeemResult>;
  listPurchases(): Promise<PurchaseOrder[]>;

  getPointsSummary(days: 7 | 30 | 90): Promise<PointsSummary>;

  fetchModels(): Promise<ModelsFetchResult>;
  applyModels(selectedIds: string[]): Promise<ApplyResult>;
  testModel(modelId: string): Promise<TestResult>;

  listBackups(): Promise<BackupEntry[]>;
  restoreBackup(id: string): Promise<{ restored: boolean }>;

  getTheme(): Promise<ThemeMode>;
  setTheme(mode: ThemeMode): Promise<void>;
  onSystemThemeChanged(callback: (isDark: boolean) => void): () => void;
}

export const IPC = {
  getState: "wb:get-state",
  register: "wb:register",
  redeem: "wb:redeem",
  listPackages: "wb:packages:list",
  createPurchase: "wb:purchase:create",
  getPurchaseStatus: "wb:purchase:status",
  confirmPurchase: "wb:purchase:confirm",
  listPurchases: "wb:purchase:history",
  getPointsSummary: "wb:points:summary",
  fetchModels: "wb:models:fetch",
  applyModels: "wb:models:apply",
  testModel: "wb:models:test",
  listBackups: "wb:backups:list",
  restoreBackup: "wb:backups:restore",
  getTheme: "wb:theme:get",
  setTheme: "wb:theme:set",
  systemThemeChanged: "wb:theme:system-changed",
} as const;
