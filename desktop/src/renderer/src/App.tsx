import { useCallback, useEffect, useState } from "react";
import type { AppState, ThemeMode } from "@shared/types";
import { wb } from "./api";
import { ToastProvider } from "./ui";
import { ActivationPage } from "./pages/ActivationPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ModelsPage } from "./pages/ModelsPage";
import { PointsPage } from "./pages/PointsPage";
import { PurchasePage } from "./pages/PurchasePage";
import { RedeemPage } from "./pages/RedeemPage";
import { SettingsPage } from "./pages/SettingsPage";

type PageKey = "overview" | "models" | "points" | "purchase" | "redeem" | "settings";

const NAV: Array<{ key: PageKey; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "models", label: "模型配置" },
  { key: "points", label: "积分" },
  { key: "purchase", label: "购买" },
  { key: "redeem", label: "兑换" },
  { key: "settings", label: "设置" },
];

function applyThemeAttribute(mode: ThemeMode, systemDark: boolean): void {
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [page, setPage] = useState<PageKey>("overview");
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [showActivation, setShowActivation] = useState(false);

  const refreshState = useCallback(async () => {
    const next = await wb.getState();
    setState(next);
    setShowActivation(!next.activated);
    return next;
  }, []);

  useEffect(() => {
    void wb.getTheme().then((mode) => {
      setThemeState(mode);
      applyThemeAttribute(mode, systemDark);
    });
    const dispose = wb.onSystemThemeChanged((isDark) => setSystemDark(isDark));
    void refreshState();
    return dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyThemeAttribute(theme, systemDark);
  }, [theme, systemDark]);

  const changeTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    void wb.setTheme(mode);
  };

  if (!state) {
    return (
      <div className="app">
        <div className="main empty" style={{ paddingTop: 120 }}>
          正在启动…
        </div>
      </div>
    );
  }

  if (showActivation) {
    return (
      <ToastProvider>
        <div className="app">
          <div className="main">
            <ActivationPage
              onActivated={() => void refreshState()}
              onGoPurchase={() => {
                setShowActivation(false);
                setPage("purchase");
              }}
            />
          </div>
        </div>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="app">
        <nav className="sidebar">
          <div className="sidebar-brand">
            <div className="title">模型配置助手</div>
            <div className="version">v{state.appVersion}</div>
          </div>
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? "active" : ""}`}
              onClick={() => setPage(item.key)}
            >
              {item.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {!state.activated && (
            <button className="nav-item" onClick={() => setShowActivation(true)}>
              激活设备
            </button>
          )}
        </nav>
        <main className="main">
          {page === "overview" && (
            <OverviewPage state={state} onNavigate={(key) => setPage(key as PageKey)} />
          )}
          {page === "models" && <ModelsPage onApplied={() => void refreshState()} />}
          {page === "points" && <PointsPage />}
          {page === "purchase" && <PurchasePage onRedeemed={() => void refreshState()} />}
          {page === "redeem" && <RedeemPage onRedeemed={() => void refreshState()} />}
          {page === "settings" && (
            <SettingsPage state={state} theme={theme} onThemeChange={changeTheme} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
