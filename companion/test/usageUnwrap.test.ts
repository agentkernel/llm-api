import { describe, expect, it } from "vitest";
import {
  unwrapDashboardList,
  type UsageModelStat,
  type UsageTrendPoint,
} from "../src/sub2api/userClient.js";

describe("unwrapDashboardList", () => {
  it("解包 Sub2API v0.1.175 的 data.models 包裹形态", () => {
    const payload = {
      models: [{ model: "deepseek-chat", requests: 3, tokens: 1200, actual_cost: 0.012 }],
    };
    const models = unwrapDashboardList<UsageModelStat>(payload, "models");
    expect(models).toHaveLength(1);
    expect(models[0]!.model).toBe("deepseek-chat");
    expect(models[0]!.requests).toBe(3);
  });

  it("解包 Sub2API v0.1.175 的 data.trend 包裹形态", () => {
    const payload = {
      trend: [{ date: "2026-08-13", requests: 6, cost: 0.02, actual_cost: 0.02 }],
    };
    const trend = unwrapDashboardList<UsageTrendPoint>(payload, "trend");
    expect(trend).toHaveLength(1);
    expect(trend[0]!.date).toBe("2026-08-13");
    expect(trend[0]!.requests).toBe(6);
  });

  it("兼容直接返回数组的形态", () => {
    const list = [{ model: "gpt-5.6", requests: 1 }];
    expect(unwrapDashboardList<UsageModelStat>(list, "models")).toEqual(list);
  });

  it("缺字段/字段非数组/非对象响应一律回退为空数组", () => {
    expect(unwrapDashboardList({}, "models")).toEqual([]);
    expect(unwrapDashboardList({ models: null }, "models")).toEqual([]);
    expect(unwrapDashboardList({ trend: "not-a-list" }, "trend")).toEqual([]);
    expect(unwrapDashboardList(null, "trend")).toEqual([]);
    expect(unwrapDashboardList(undefined, "models")).toEqual([]);
  });
});
