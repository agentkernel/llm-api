import { useCallback, useEffect, useRef, useState } from "react";
import type { PackageOption, PurchaseCreated, PurchaseStatus } from "@shared/types";
import { wb, errorText } from "../api";
import { Modal, useToast } from "../ui";

type Step =
  | { kind: "browse" }
  | { kind: "paying"; order: PurchaseCreated; status: PurchaseStatus }
  | { kind: "confirm"; outTradeNo: string; points: number };

export function PurchasePage({ onRedeemed }: { onRedeemed: () => void }) {
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [paymentType, setPaymentType] = useState<"alipay" | "wxpay">("alipay");
  const [step, setStep] = useState<Step>({ kind: "browse" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    wb.listPackages()
      .then(setPackages)
      .catch((error) => toast.push("error", errorText(error)));
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const startPolling = useCallback((outTradeNo: string, points: number) => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const result = await wb.getPurchaseStatus(outTradeNo);
        if (result.status === "paid_pending_redeem") {
          stopPolling();
          setStep({ kind: "confirm", outTradeNo, points });
        } else if (["expired", "cancelled", "failed"].includes(result.status)) {
          stopPolling();
          setStep({ kind: "browse" });
          toast.push("error", "订单已关闭或过期，请重新发起");
        } else {
          setStep((current) =>
            current.kind === "paying" ? { ...current, status: result.status } : current,
          );
        }
      } catch {
        // 轮询失败静默重试
      }
    }, 3000);
  }, [toast]);

  const buy = async (pkg: PackageOption) => {
    setBusy(true);
    try {
      const order = await wb.createPurchase(pkg.id, paymentType);
      setStep({ kind: "paying", order, status: "pending" });
      startPolling(order.outTradeNo, order.points);
    } catch (error) {
      toast.push("error", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (outTradeNo: string) => {
    setBusy(true);
    try {
      const result = await wb.confirmPurchase(outTradeNo);
      toast.push("success", `已充入 ${result.points} 积分`);
      setStep({ kind: "browse" });
      onRedeemed();
    } catch (error) {
      toast.push("error", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-title">购买积分</div>
      <div className="page-subtitle">选择套餐后使用微信或支付宝扫码支付，支付成功后需确认兑换</div>

      <div className="card row">
        <div className="hint">支付方式</div>
        <div>
          <button
            className="btn"
            style={paymentType === "alipay" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => setPaymentType("alipay")}
          >
            支付宝
          </button>{" "}
          <button
            className="btn"
            style={paymentType === "wxpay" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => setPaymentType("wxpay")}
          >
            微信支付
          </button>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        {packages.map((pkg) => (
          <div className="card" key={pkg.id}>
            <div className="card-title">{pkg.name}</div>
            <div className="card-desc">{pkg.description || `模型分组：${pkg.targetGroupName}`}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <div>
                <span className="stat-value" style={{ fontSize: 20 }}>
                  ¥{pkg.priceCny}
                </span>
                <span className="hint"> / {pkg.points} 积分</span>
              </div>
              <button className="btn btn-primary" disabled={busy} onClick={() => void buy(pkg)}>
                购买
              </button>
            </div>
          </div>
        ))}
        {packages.length === 0 && <div className="card empty">暂无可售套餐</div>}
      </div>

      {step.kind === "paying" && (
        <Modal
          title={paymentType === "alipay" ? "支付宝扫码支付" : "微信扫码支付"}
          onClose={() => {
            stopPolling();
            setStep({ kind: "browse" });
          }}
          actions={
            <button
              className="btn"
              onClick={() => {
                stopPolling();
                setStep({ kind: "browse" });
              }}
            >
              取消
            </button>
          }
        >
          <div className="qr-box">
            {step.order.qrDataUrl ? (
              <img src={step.order.qrDataUrl} width={240} height={240} alt="支付二维码" />
            ) : (
              <div className="empty">未获取到二维码，请取消后重试</div>
            )}
            <div>
              应付 <strong>¥{step.order.amountCny}</strong> · 到账 {step.order.points} 积分
            </div>
            <div className="hint">
              {step.status === "pending" ? "等待支付…" : "支付确认中…"}
              （二维码将于订单过期时失效）
            </div>
          </div>
        </Modal>
      )}

      {step.kind === "confirm" && (
        <Modal
          title="支付成功，确认兑换"
          actions={
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void confirm(step.outTradeNo)}
            >
              {busy ? "兑换中…" : `确认兑换 ${step.points} 积分`}
            </button>
          }
        >
          积分将充入当前设备，并按套餐切换可用模型分组。此操作只能在本机完成。
        </Modal>
      )}
    </div>
  );
}
