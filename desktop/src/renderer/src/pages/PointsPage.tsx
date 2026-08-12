import { useCallback, useEffect, useState } from "react";
import type { PointsSummary } from "@shared/types";
import { wb, errorText } from "../api";
import { BarChart, formatPoints, useToast } from "../ui";

const RANGES: Array<7 | 30 | 90> = [7, 30, 90];

export function PointsPage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [summary, setSummary] = useState<PointsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const refresh = useCallback(
    async (range: 7 | 30 | 90) => {
      setLoading(true);
      try {
        setSummary(await wb.getPointsSummary(range));
      } catch (error) {
        toast.push("error", errorText(error));
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void refresh(days);
  }, [days, refresh]);

  return (
    <div>
      <div className="page-title">积分</div>
      <div className="page-subtitle">用量与消耗统计（1 积分 = 1 单位额度）</div>

      <div className="card">
        <div className="row">
          <div>
            <div className="stat-label">当前积分</div>
            <div className="stat-value">{formatPoints(summary?.currentPoints)}</div>
          </div>
          <div>
            <div className="stat-label">近 {days} 天消耗</div>
            <div className="stat-value">{formatPoints(summary?.periodUsage)}</div>
          </div>
          <div>
            <div className="stat-label">累计充值</div>
            <div className="stat-value">{formatPoints(summary?.totalRecharged)}</div>
          </div>
          <div>
            {RANGES.map((range) => (
              <button
                key={range}
                className={`btn btn-ghost ${range === days ? "" : ""}`}
                style={range === days ? { color: "var(--accent)", fontWeight: 600 } : undefined}
                disabled={loading}
                onClick={() => setDays(range)}
              >
                {range}天
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">按日消耗（积分）</div>
        {summary && summary.daily.length > 0 ? (
          <BarChart data={summary.daily.map((point) => ({ label: point.date, value: point.points }))} />
        ) : (
          <div className="empty">{loading ? "加载中…" : "暂无数据"}</div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">按模型消耗</div>
        {summary && summary.models.length > 0 ? (
          <div className="stack" style={{ marginTop: 8 }}>
            {summary.models
              .slice()
              .sort((a, b) => b.points - a.points)
              .map((model) => (
                <div className="row" key={model.model}>
                  <span className="mono">{model.model}</span>
                  <span className="hint">
                    {model.requests} 次 · {formatPoints(model.points)} 积分
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <div className="empty">{loading ? "加载中…" : "暂无数据"}</div>
        )}
      </div>
    </div>
  );
}
