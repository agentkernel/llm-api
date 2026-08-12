import type { AppState } from "@shared/types";
import { formatPoints } from "../ui";

export function OverviewPage({
  state,
  onNavigate,
}: {
  state: AppState;
  onNavigate: (page: string) => void;
}) {
  return (
    <div>
      <div className="page-title">概览</div>
      <div className="page-subtitle">设备与配置状态</div>

      <div className="card">
        <div className="row">
          <div>
            <div className="stat-label">当前积分</div>
            <div className="stat-value">{formatPoints(state.points)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="hint">
              服务连接：{state.companionReachable ? "正常" : "不可用"}
            </div>
            <div className="hint">
              WorkBuddy 配置：{state.workbuddyConfigExists ? "已存在" : "未找到"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginTop: 12 }}>
        <button className="card" style={{ cursor: "pointer", textAlign: "left" }} onClick={() => onNavigate("models")}>
          <div className="card-title">配置模型</div>
          <div className="card-desc">拉取可用模型并写入 WorkBuddy</div>
        </button>
        <button className="card" style={{ cursor: "pointer", textAlign: "left" }} onClick={() => onNavigate("purchase")}>
          <div className="card-title">购买积分</div>
          <div className="card-desc">选择套餐，扫码支付</div>
        </button>
        <button className="card" style={{ cursor: "pointer", textAlign: "left" }} onClick={() => onNavigate("redeem")}>
          <div className="card-title">输入兑换码</div>
          <div className="card-desc">使用公司发放的兑换码</div>
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">配置文件</div>
        <div className="card-desc mono">{state.workbuddyConfigPath}</div>
        <div className="hint" style={{ marginTop: 8 }}>
          写入配置后 WorkBuddy 会自动热加载；进行中的会话首条消息若提示
          「ACP transport ECONNRESET」，重新发送该消息即可。
        </div>
      </div>
    </div>
  );
}
