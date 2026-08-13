import { describe, expect, it } from "vitest";
import { dateStringInTimeZone } from "../src/domain/usage.js";

describe("dateStringInTimeZone", () => {
  it("东八区凌晨取上海日历日，而不是 UTC 前一天", () => {
    // 2026-08-13T17:00:00Z == 2026-08-14 01:00 Asia/Shanghai
    const lateNight = new Date("2026-08-13T17:00:00Z");
    expect(dateStringInTimeZone(lateNight, "Asia/Shanghai")).toBe("2026-08-14");
    // 旧实现 toISOString 会得到 2026-08-13，把“今天”的用量排除在 end_date 之外
    expect(lateNight.toISOString().slice(0, 10)).toBe("2026-08-13");
  });

  it("白天两种口径一致（历史行为不变）", () => {
    const noon = new Date("2026-08-13T04:00:00Z"); // 12:00 Asia/Shanghai
    expect(dateStringInTimeZone(noon, "Asia/Shanghai")).toBe("2026-08-13");
  });

  it("西向时区同样按目标时区取日", () => {
    // 2026-08-14T02:00:00Z == 2026-08-13 22:00 America/New_York（夏令时 UTC-4）
    const date = new Date("2026-08-14T02:00:00Z");
    expect(dateStringInTimeZone(date, "America/New_York")).toBe("2026-08-13");
  });

  it("非法时区回退 UTC 日期", () => {
    const date = new Date("2026-08-13T17:00:00Z");
    expect(dateStringInTimeZone(date, "Not/AZone")).toBe("2026-08-13");
  });
});
