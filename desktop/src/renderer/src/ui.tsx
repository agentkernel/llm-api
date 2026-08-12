import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/* ---- 基础控件 ---- */

export function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  );
}

export function Modal({
  title,
  children,
  actions,
  onClose,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

/* ---- Toast ---- */

interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

interface ToastContextValue {
  push(kind: ToastItem["kind"], text: string): void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => undefined });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastItem["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, kind, text }]);
    setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.kind === "info" ? "" : item.kind}`}>
            {item.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---- 简单柱状图 ---- */

export function BarChart({
  data,
  height = 120,
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
}) {
  const max = Math.max(...data.map((point) => point.value), 0.0001);
  return (
    <div className="bar-chart" style={{ height }}>
      {data.map((point) => (
        <div
          key={point.label}
          className="bar"
          style={{ height: `${Math.max((point.value / max) * 100, 1)}%` }}
          title={`${point.label}: ${point.value.toFixed(2)}`}
        />
      ))}
    </div>
  );
}

export function formatPoints(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
