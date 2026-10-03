import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { loginAs } from "./auth";
const pool = new Pool({
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());

test("numeric progress renders full bars and league totals are whole points", async ({
  page,
  context,
}) => {
  await loginAs(context, "instructor@example.com");
  const [course] = (
    await pool.query(
      "SELECT id FROM courses WHERE slug='sql-from-zero-to-interview'",
    )
  ).rows;
  const response = await context.request.get(`/api/analytics/${course.id}`);
  const analytics = await response.json();
  expect(analytics.progress.length).toBeGreaterThan(0);
  for (const r of analytics.progress)
    expect(typeof r.completion).toBe("number");
  // Render a known numeric percentage from the API contract, independent of demo progress.
  await page.route(`**/api/analytics/${course.id}`, (route) =>
    route.fulfill({
      json: { ...analytics, progress: [{ name: "Learner", completion: 75 }] },
    }),
  );
  await page.goto(`/teach/courses/${course.id}/analytics`);
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(".recharts-bar-rectangle path")
          .first()
          .getAttribute("height"),
      ),
    )
    .toBeGreaterThan(100);
  await page.route("**/api/leagues/format-check", (route) =>
    route.fulfill({
      json: {
        name: "Test league",
        teams: [
          {
            id: "one",
            name: "Team",
            emoji: "⚡",
            perCapita: 194.5,
            points: "389.0000",
            season_points: "1234.0000",
            members: 2,
          },
        ],
        feed: [],
      },
    }),
  );
  await page.goto("/leagues/format-check");
  await expect(
    page.getByText("points per learner · 389 team points", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2 learners · 1234 season points", { exact: true }),
  ).toBeVisible();
});

test("unbatched offerings say Any batch", async ({ page, context }) => {
  await loginAs(context, "owner@example.com", true);
  await page.goto("/admin");
  const offerings = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "Offerings & prices",
      exact: true,
    }),
  });
  await expect(
    offerings.getByRole("cell", { name: "Any batch", exact: true }).first(),
  ).toBeVisible();
  await expect(
    offerings.getByRole("cell", { name: "null", exact: true }),
  ).toHaveCount(0);
});
