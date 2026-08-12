import { app, ipcMain, nativeTheme, type BrowserWindow } from "electron";
import { toDataURL } from "qrcode";
import type {
  AppState,
  ModelOption,
  ModelsFetchResult,
  PointsSummary,
  PurchaseCreated,
  RedeemResult,
  ThemeMode,
} from "@shared/types";
import { IPC } from "@shared/types";
import { companionRequest, CompanionError } from "./companionClient";
import { fetchGatewayModelIds, testChatCompletion } from "./gatewayClient";
import { readMachineId } from "./machineId";
import {
  applyConfig,
  listBackups,
  restoreBackup,
  snapshotConfig,
  workbuddyConfigPath,
  type ConfigSnapshot,
  type WorkbuddyModelEntry,
} from "./modelsFile";
import {
  getDeviceToken,
  getDeviceUuid,
  getTheme,
  saveDeviceIdentity,
  setTheme,
} from "./secureStore";

interface CatalogModel {
  modelId: string;
  displayName: string;
  vendor: string;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  temperature: number | null;
  supportsToolCall: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  onlyReasoning: boolean;
  useCustomProtocol: boolean;
  reasoning: Record<string, unknown> | null;
  sortOrder: number;
}

interface CompanionState {
  deviceUuid: string;
  activated: boolean;
  currentGroupId: number | null;
  currentPackageId: number | null;
  points: number | null;
}

/** fetchModels 与 applyModels 之间的会话缓存（apiKey 只在 main 内存）。 */
interface FetchSession {
  material: { gatewayUrl: string; apiKey: string };
  catalog: CatalogModel[];
  availableIds: Set<string>;
  configSnapshot: ConfigSnapshot;
}

let session: FetchSession | null = null;

async function ensureRegistered(): Promise<void> {
  if (getDeviceToken() && getDeviceUuid()) return;
  const machineId = await readMachineId();
  const result = await companionRequest<{
    deviceUuid: string;
    deviceToken: string;
    activated: boolean;
  }>("/api/client/devices/register", {
    method: "POST",
    auth: false,
    body: { machineId, appVersion: app.getVersion() },
  });
  saveDeviceIdentity(result.deviceUuid, result.deviceToken);
}

async function assembleState(): Promise<AppState> {
  const configSnapshot = snapshotConfig();
  const base: AppState = {
    deviceUuid: getDeviceUuid(),
    activated: false,
    points: null,
    currentGroupId: null,
    currentPackageId: null,
    companionReachable: false,
    workbuddyConfigPath: workbuddyConfigPath(),
    workbuddyConfigExists: configSnapshot.exists,
    appVersion: app.getVersion(),
  };
  try {
    await ensureRegistered();
    const state = await companionRequest<CompanionState>("/api/client/state");
    return {
      ...base,
      deviceUuid: state.deviceUuid,
      activated: state.activated,
      points: state.points,
      currentGroupId: state.currentGroupId,
      currentPackageId: state.currentPackageId,
      companionReachable: true,
    };
  } catch (error) {
    if (error instanceof CompanionError && error.code === "INVALID_TOKEN") {
      // 令牌被轮换/吊销：重新注册一次
      try {
        const machineId = await readMachineId();
        const result = await companionRequest<{
          deviceUuid: string;
          deviceToken: string;
        }>("/api/client/devices/register", {
          method: "POST",
          auth: false,
          body: { machineId, appVersion: app.getVersion() },
        });
        saveDeviceIdentity(result.deviceUuid, result.deviceToken);
        return assembleState();
      } catch {
        return base;
      }
    }
    return base;
  }
}

function toModelEntry(
  model: CatalogModel,
  material: { gatewayUrl: string; apiKey: string },
): WorkbuddyModelEntry {
  const entry: WorkbuddyModelEntry = {
    id: model.modelId,
    name: model.displayName,
    vendor: model.vendor,
    url: material.gatewayUrl,
    apiKey: material.apiKey,
  };
  if (model.maxInputTokens !== null) entry.maxInputTokens = model.maxInputTokens;
  if (model.maxOutputTokens !== null) entry.maxOutputTokens = model.maxOutputTokens;
  if (model.temperature !== null) entry.temperature = model.temperature;
  entry.supportsToolCall = model.supportsToolCall;
  entry.supportsImages = model.supportsImages;
  entry.supportsReasoning = model.supportsReasoning;
  if (model.onlyReasoning) entry.onlyReasoning = true;
  entry.useCustomProtocol = model.useCustomProtocol;
  if (model.reasoning) {
    entry.reasoning = model.reasoning as WorkbuddyModelEntry["reasoning"];
  }
  return entry;
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.getState, () => assembleState());

  ipcMain.handle(IPC.register, async () => {
    await ensureRegistered();
    return assembleState();
  });

  ipcMain.handle(IPC.redeem, async (_event, code: string): Promise<RedeemResult> => {
    await ensureRegistered();
    return companionRequest<RedeemResult>("/api/client/redeem", {
      method: "POST",
      body: { code },
    });
  });

  ipcMain.handle(IPC.listPackages, async () => {
    return companionRequest("/api/client/packages");
  });

  ipcMain.handle(
    IPC.createPurchase,
    async (_event, packageId: number, paymentType: "alipay" | "wxpay"): Promise<PurchaseCreated> => {
      await ensureRegistered();
      const created = await companionRequest<{
        outTradeNo: string;
        qrCode: string | null;
        payUrl: string | null;
        amountCny: number;
        points: number;
        expiresAt: string;
      }>("/api/client/purchase/orders", {
        method: "POST",
        body: { packageId, paymentType },
      });
      const qrSource = created.qrCode ?? created.payUrl;
      return {
        outTradeNo: created.outTradeNo,
        qrDataUrl: qrSource ? await toDataURL(qrSource, { margin: 1, width: 240 }) : null,
        payUrl: created.payUrl,
        amountCny: created.amountCny,
        points: created.points,
        expiresAt: created.expiresAt,
      };
    },
  );

  ipcMain.handle(IPC.getPurchaseStatus, (_event, outTradeNo: string) =>
    companionRequest(`/api/client/purchase/orders/${encodeURIComponent(outTradeNo)}`),
  );

  ipcMain.handle(IPC.confirmPurchase, (_event, outTradeNo: string) =>
    companionRequest(`/api/client/purchase/orders/${encodeURIComponent(outTradeNo)}/confirm`, {
      method: "POST",
    }),
  );

  ipcMain.handle(IPC.listPurchases, () => companionRequest("/api/client/purchase/orders"));

  ipcMain.handle(IPC.getPointsSummary, (_event, days: number): Promise<PointsSummary> => {
    return companionRequest<PointsSummary>(`/api/client/points/summary?days=${days}`);
  });

  ipcMain.handle(IPC.fetchModels, async (): Promise<ModelsFetchResult> => {
    await ensureRegistered();
    const [catalogResp, material] = await Promise.all([
      companionRequest<{ gatewayUrl: string; models: CatalogModel[] }>("/api/client/catalog"),
      companionRequest<{ gatewayUrl: string; apiKey: string }>("/api/client/config-material"),
    ]);
    const gatewayIds = await fetchGatewayModelIds(material.gatewayUrl, material.apiKey);
    const availableIds = new Set(gatewayIds);
    const catalogIds = new Set(catalogResp.models.map((model) => model.modelId));
    const visible = catalogResp.models.filter((model) => availableIds.has(model.modelId));
    const hiddenCount = gatewayIds.filter((id) => !catalogIds.has(id)).length;

    session = {
      material,
      catalog: visible,
      availableIds,
      configSnapshot: snapshotConfig(),
    };

    const models: ModelOption[] = visible.map((model) => ({
      modelId: model.modelId,
      displayName: model.displayName,
      vendor: model.vendor,
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
      supportsToolCall: model.supportsToolCall,
      supportsImages: model.supportsImages,
      supportsReasoning: model.supportsReasoning,
      available: true,
      reasoning: model.reasoning,
    }));
    return {
      models,
      gatewayTotal: gatewayIds.length,
      catalogTotal: catalogResp.models.length,
      hiddenCount,
    };
  });

  ipcMain.handle(IPC.applyModels, async (_event, selectedIds: string[]) => {
    if (!session) {
      throw new Error("请先刷新模型列表");
    }
    const chosen = session.catalog.filter((model) => selectedIds.includes(model.modelId));
    if (chosen.length === 0) {
      throw new Error("请至少选择一个模型");
    }
    const entries = chosen.map((model) => toModelEntry(model, session!.material));
    const result = applyConfig(entries, session.configSnapshot);
    // 写入成功后刷新快照，避免下次误报外部修改
    session.configSnapshot = snapshotConfig();
    return {
      written: entries.length,
      backupId: result.backupId,
      configPath: result.configPath,
    };
  });

  ipcMain.handle(IPC.testModel, async (_event, modelId: string) => {
    if (!session) {
      throw new Error("请先刷新模型列表");
    }
    return testChatCompletion(session.material.gatewayUrl, session.material.apiKey, modelId);
  });

  ipcMain.handle(IPC.listBackups, () => listBackups());

  ipcMain.handle(IPC.restoreBackup, (_event, id: string) => {
    restoreBackup(id);
    return { restored: true };
  });

  ipcMain.handle(IPC.getTheme, (): ThemeMode => getTheme());

  ipcMain.handle(IPC.setTheme, (_event, mode: ThemeMode) => {
    setTheme(mode);
    nativeTheme.themeSource = mode;
  });

  nativeTheme.on("updated", () => {
    getWindow()?.webContents.send(IPC.systemThemeChanged, nativeTheme.shouldUseDarkColors);
  });
}
