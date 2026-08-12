import {
  userProfile,
  userUsageModels,
  userUsageStats,
  userUsageTrend,
} from "../sub2api/userClient.js";
import { hiddenUserCredentials, type DeviceRow } from "./devices.js";

export interface PointsSummary {
  /** 当前积分（Sub2API balance，1:1）。 */
  currentPoints: number;
  frozenPoints: number;
  /** 累计充值积分。 */
  totalRecharged: number;
  /** 所选时段消耗（actual_cost 口径）。 */
  periodUsage: number;
  periodRequests: number;
  daily: Array<{ date: string; points: number; requests: number }>;
  models: Array<{ model: string; points: number; requests: number }>;
  rangeDays: number;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 员工积分页数据：当前积分 + 时段消耗 + 按日/按模型统计。 */
export async function pointsSummary(
  device: DeviceRow,
  rangeDays: 7 | 30 | 90,
  timezone: string,
): Promise<PointsSummary> {
  const creds = hiddenUserCredentials(device);
  const end = new Date();
  const start = new Date(end.getTime() - (rangeDays - 1) * 24 * 60 * 60 * 1000);
  const query = {
    startDate: dateString(start),
    endDate: dateString(end),
    timezone,
  };

  const [profile, stats, trend, models] = await Promise.all([
    userProfile(creds),
    userUsageStats(creds, query),
    userUsageTrend(creds, { ...query, granularity: "day" }),
    userUsageModels(creds, query),
  ]);

  return {
    currentPoints: profile.balance,
    frozenPoints: profile.frozen_balance,
    totalRecharged: profile.total_recharged,
    periodUsage: Number(stats.total_actual_cost ?? 0),
    periodRequests: Number(stats.total_requests ?? 0),
    daily: (trend ?? []).map((point) => ({
      date: String(point.date ?? point.hour ?? ""),
      points: Number(point.actual_cost ?? point.cost ?? 0),
      requests: Number(point.requests ?? 0),
    })),
    models: (models ?? []).map((stat) => ({
      model: stat.model,
      points: Number(stat.actual_cost ?? stat.cost ?? 0),
      requests: Number(stat.requests ?? 0),
    })),
    rangeDays,
  };
}
