import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import NotFound from "./NotFound";

describe("NotFound", () => {
  it("says the page is missing and links home inside the app", async () => {
    render(
      <MemoryRouter initialEntries={["/nowhere"]}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(screen.getByText("Oops! Page not found")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Return to Home" }));
    expect(screen.getByText("home page")).toBeInTheDocument();
  });
});
