import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  check: vi.fn(),
  run: vi.fn(),
  importJson: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => ({
  useCalendarToken: () => ({ create: { mutate: hooks.create, isPending: false }, revoke: { mutate: hooks.revoke, isPending: false } }),
  useCsvImport: () => ({ check: { mutateAsync: hooks.check, isPending: false }, run: { mutateAsync: hooks.run, isPending: false } }),
  useImportData: () => ({ mutateAsync: hooks.importJson, isPending: false }),
}));

import { CalendarFeed, DataSettings } from "./DataSettings";

describe("CalendarFeed", () => {
  beforeEach(() => {
    hooks.create.mockReset();
    hooks.revoke.mockReset();
  });

  it("asks before making a new address, since subscribed calendars stop updating", async () => {
    render(<CalendarFeed token="abc123" />);
    await userEvent.click(screen.getByRole("button", { name: /new address/i }));
    expect(hooks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/stops working/);
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "New address" }));
    expect(hooks.create).toHaveBeenCalledTimes(1);
  });

  it("turns the feed off only after confirming, and Cancel leaves it on", async () => {
    render(<CalendarFeed token="abc123" />);
    await userEvent.click(screen.getByRole("button", { name: /turn off/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(hooks.revoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /turn off/i }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Turn off" }));
    expect(hooks.revoke).toHaveBeenCalledTimes(1);
  });
});

describe("CSV import", () => {
  beforeEach(() => hooks.check.mockReset());

  it("clears the file picker after a check, so the same file can be chosen again once it is fixed", async () => {
    hooks.check.mockResolvedValue({ ok: false, rows: 1, lists: 1, items: 1, preview: [], errors: [{ row: 2, message: "Bad date" }], errorCount: 1 });
    render(<DataSettings />);
    const picker = screen.getByLabelText("Choose a CSV file") as HTMLInputElement;
    const file = new File(["list,task\nHome,Sweep"], "tasks.csv", { type: "text/csv" });
    await userEvent.upload(picker, file);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Bad date/);
    expect(picker.value).toBe("");
    await userEvent.upload(picker, file);
    expect(hooks.check).toHaveBeenCalledTimes(2);
  });
});

describe("JSON import", () => {
  beforeEach(() => hooks.importJson.mockReset());

  it("leaves the export's comments out of the upload, since the import ignores them", async () => {
    hooks.importJson.mockResolvedValue({ success: true, lists: 1, items: 0 });
    render(<DataSettings />);
    const doc = { app: "TaskQuest", version: 1, lists: [{ name: "Home", items: [] }], comments: [{ body: "x".repeat(50) }] };
    await userEvent.upload(screen.getByLabelText("Choose a JSON export"), new File([JSON.stringify(doc)], "export.json", { type: "application/json" }));
    expect(hooks.importJson).toHaveBeenCalledWith({ app: "TaskQuest", version: 1, lists: [{ name: "Home", items: [] }] });
  });
});
