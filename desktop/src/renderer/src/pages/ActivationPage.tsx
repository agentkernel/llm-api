import { useState } from "react";
import { wb, errorText } from "../api";
import { useToast } from "../ui";

export function ActivationPage({
  onActivated,
  onGoPurchase,
}: {
  onActivated: () => void;
  onGoPurchase: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const result = await wb.redeem(code);
      toast.push("success", `兑换成功，已充入 ${result.points} 积分`);
      onActivated();
    } catch (error) {
      toast.push("error", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "80px auto 0", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>WorkBuddy 模型配置助手</div>
      <div className="page-subtitle">输入公司发放的兑换码激活本设备，或先购买兑换码</div>
      <div className="card" style={{ textAlign: "left" }}>
        <div className="stack">
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
            {busy ? "兑换中…" : "确认兑换"}
          </button>
          <button className="btn" disabled={busy} onClick={onGoPurchase}>
            购买兑换码
          </button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>
        兑换码与本机绑定，激活后不可转移到其他电脑；
        <br />
        应用不会上传你的任何本地数据，仅使用匿名设备标识。
      </p>
    </div>
  );
}
