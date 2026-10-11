import { describe, expect, it } from "vitest";
import { orderQuestsForDashboard } from "./questOrder";

const L = (id: number, deadline: string | null, created_at: string, done?: [number, number]) => ({
  id, deadline, created_at, itemsCompleted: done?.[0], itemsTotal: done?.[1],
});

describe("orderQuestsForDashboard", () => {
  const today = "2030-06-10";

  it("puts overdue first, then due today, then newest", () => {
    const out = orderQuestsForDashboard(
      [L(1, null, "2030-06-01"), L(2, "2030-06-10", "2030-05-01"), L(3, "2030-06-01", "2030-04-01"), L(4, "2030-07-01", "2030-06-05")],
      today,
    );
    expect(out.map((l) => l.id)).toEqual([3, 2, 4, 1]);
  });

  it("orders overdue quests by oldest deadline", () => {
    const out = orderQuestsForDashboard([L(1, "2030-06-05", "x"), L(2, "2030-06-01", "x")], today);
    expect(out.map((l) => l.id)).toEqual([2, 1]);
  });

  it("does not treat finished quests as urgent and does not mutate the input", () => {
    const input = [L(1, "2030-06-01", "2030-01-01", [3, 3]), L(2, null, "2030-02-01")];
    const out = orderQuestsForDashboard(input, today);
    expect(out.map((l) => l.id)).toEqual([2, 1]);
    expect(input.map((l) => l.id)).toEqual([1, 2]);
  });
});
