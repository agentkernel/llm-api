import { useEffect, useState } from "react";
import type { AppState, BackupEntry, ThemeMode } from "@shared/types";
import { wb, errorText } from "../api";
import { Modal, useToast } from "../ui";

export function SettingsPage({
  state,
  theme,
  onThemeChange,
}: {
  state: AppState;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}) {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const refreshBackups = () => {
    wb.listBackups().then(setBackups).catch(() => setBackups([]));
  };

  useEffect(refreshBackups, []);

  const restore = async (id: string) => {
    setBusy(true);
    try {
      await wb.restoreBackup(id);
      toast.push("success", "已恢复所选备份，WorkBuddy 将自动加载");
      setRestoring(null);
      refreshBackups();
    } catch (error) {
      toast.push("error", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-title">设置</div>
      <div className="page-subtitle">外观、备份与诊断</div>

      <div className="card row">
        <div>
          <div className="card-title">外观主题</div>
          <div className="card-desc">跟随系统或手动选择</div>
        </div>
        <select
          className="select"
          value={theme}
          onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">配置文件</div>
        <div className="card-desc mono">{state.workbuddyConfigPath}</div>
        <div className="hint" style={{ marginTop: 6 }}>
          {state.workbuddyConfigExists ? "文件存在" : "文件不存在（首次应用配置时创建）"}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <div>
            <div className="card-title">配置备份</div>
            <div className="card-desc">每次替换前自动加密备份，保留最近 5 份</div>
          </div>
          <button className="btn btn-ghost" onClick={refreshBackups}>
            刷新
          </button>
        </div>
        {backups.length === 0 ? (
          <div className="empty">暂无备份</div>
        ) : (
          <div className="stack" style={{ marginTop: 10 }}>
            {backups.map((backup) => (
              <div className="row" key={backup.id}>
                <div>
                  <div>{new Date(backup.createdAt).toLocaleString("zh-CN")}</div>
                  <div className="hint">
                    {backup.modelCount !== null ? `${backup.modelCount} 个模型 · ` : ""}
                    {(backup.sizeBytes / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button className="btn" disabled={busy} onClick={() => setRestoring(backup.id)}>
                  恢复
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card row" style={{ marginTop: 12 }}>
        <div>
          <div className="card-title">关于</div>
          <div className="card-desc">
            WorkBuddy 模型配置助手 v{state.appVersion} · 设备 {state.deviceUuid ?? "未注册"}
          </div>
        </div>
      </div>

      {restoring && (
        <Modal
          title="恢复此备份？"
          onClose={() => setRestoring(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRestoring(null)}>
                取消
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void restore(restoring)}>
                恢复
              </button>
            </>
          }
        >
          当前 models.json 会先备份，然后被所选备份替换。WorkBuddy 将自动热加载，
          进行中的会话首条消息若报 ECONNRESET，重发一次即可。
        </Modal>
      )}
    </div>
  );
}
