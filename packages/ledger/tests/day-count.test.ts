import { describe, it, expect } from "vitest";
import {
  dayCountDenominator,
  calendarDaysBetween,
  addCalendarDays,
} from "../src/index.js";

describe("day-count", () => {
  it("ACT_365 and ACT_360 are fixed", () => {
    expect(dayCountDenominator("ACT_365", "2024-06-01")).toBe(365n);
    expect(dayCountDenominator("ACT_360", "2024-06-01")).toBe(360n);
  });

  it("ACT_ACT uses leap year", () => {
    expect(dayCountDenominator("ACT_ACT", "2024-06-01")).toBe(366n);
    expect(dayCountDenominator("ACT_ACT", "2025-06-01")).toBe(365n);
  });

  it("counts calendar days and adds days", () => {
    expect(calendarDaysBetween("2024-01-01", "2024-01-11")).toBe(10);
    expect(addCalendarDays("2024-01-01", 10)).toBe("2024-01-11");
  });
});
