import { useEffect, useState } from "react";
import type { PurchaseOrder } from "@shared/types";
import { wb, errorText } from "../api";
import { useToast } from "../ui";

const STATUS_TEXT: Record<string, string> = {
  pending: "待支付",
  paid_pending_redeem: "已支付待兑换",
  redeeming: "兑换中",
  redeemed: "已兑换",
  expired: "已过期",
  cancelled: "已取消",
  failed: "异常",
};

export function RedeemPage({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const toast = useToast();

  const refreshOrders = () => {
    wb.listPurchases().then(setOrders).catch(() => setOrders([]));
  };

  useEffect(refreshOrders, []);

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const result = await wb.redeem(code);
      toast.push("success", `兑换成功，已充入 ${result.points} 积分`);
      setCode("");
      onRedeemed();
    } catch (error) {
      toast.push("error", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmOrder = async (outTradeNo: string) => {
    setBusy(true);
    try {
      const result = await wb.confirmPurchase(outTradeNo);
      toast.push("success", `已充入 ${result.points} 积分`);
      refreshOrders();
      onRedeemed();
    } catch (error) {
      toast.push("error", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-title">兑换</div>
      <div className="page-subtitle">输入公司发放的兑换码，或处理已支付订单</div>

      <div className="card">
        <div className="card-title">公司兑换码</div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="input mono"
            placeholder="粘贴兑换码"
            value={code}
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
          <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={() => void submit()}>
            确认兑换
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          兑换成功后积分立即到账；若兑换码带模型套餐，将同时切换可用模型分组。
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <div className="card-title">购买订单</div>
          <button className="btn btn-ghost" onClick={refreshOrders}>
            刷新
          </button>
        </div>
        {orders.length === 0 ? (
          <div className="empty">暂无订单</div>
        ) : (
          <div className="stack" style={{ marginTop: 8 }}>
            {orders.map((order) => (
              <div className="row" key={order.outTradeNo}>
                <div>
                  <span className="mono hint">{order.outTradeNo}</span>{" "}
                  <span className="tag">{STATUS_TEXT[order.status] ?? order.status}</span>
                </div>
                <div>
                  <span className="hint">
                    ¥{order.amountCny} / {order.points} 积分
                  </span>{" "}
                  {order.status === "paid_pending_redeem" && (
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void confirmOrder(order.outTradeNo)}
                    >
                      确认兑换
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
