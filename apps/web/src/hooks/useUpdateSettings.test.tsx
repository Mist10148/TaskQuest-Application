import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateSettings } = vi.hoisted(() => ({ updateSettings: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), userApi: { updateSettings } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));

import { useUpdateSettings } from "./useApi";

function setup() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useUpdateSettings(), { wrapper });
  const invalidated = () => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
  return { result, invalidated };
}

describe("useUpdateSettings", () => {
  beforeEach(() => {
    updateSettings.mockReset();
    updateSettings.mockResolvedValue({});
  });

  it("refreshes the day-based pages after a time zone change", async () => {
    const { result, invalidated } = setup();
    act(() => void result.current.mutate({ timezone: "America/Los_Angeles" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(invalidated()).toContain('["today"]'));
    expect(invalidated()).toContain('["stats"]');
  });

  it("refreshes them when XP is switched off", async () => {
    const { result, invalidated } = setup();
    act(() => void result.current.mutate({ gamification_enabled: false }));
    await waitFor(() => expect(invalidated()).toContain('["today"]'));
  });

  it("leaves them alone for other settings", async () => {
    const { result, invalidated } = setup();
    act(() => void result.current.mutate({ weekly_digest: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(invalidated()).toContain('["user"]'));
    expect(invalidated()).not.toContain('["today"]');
  });
});
