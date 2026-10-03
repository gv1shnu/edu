import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { loginAs } from "./auth";

const pool = new Pool({
  // Owner connection: assertions read RLS-protected tables without a user context.
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());

const titles: Record<string, string> = {
  about: "A little about me",
  courses: "My learning path",
  learning: "Currently learning",
  league: "Learning together",
  activity: "Showing up, in my own way",
  links: "Around the web",
};

test("student restyles and rearranges their profile; a classmate sees the change", async ({
  browser,
}) => {
  const [original] = (
    await pool.query("SELECT theme,layout FROM profiles WHERE handle='diya'")
  ).rows;
  const owner = await browser.newContext();
  const classmate = await browser.newContext();
  try {
    await loginAs(owner, "student2@example.com");
    await loginAs(classmate, "student3@example.com");
    const page = await owner.newPage();
    await page.goto("/settings/profile");
    await page.getByRole("button", { name: "Style", exact: true }).click();
    await page.getByRole("button", { name: "Forest", exact: true }).click();
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.getByLabel("Columns").selectOption("1");
    await page.getByRole("button", { name: "Hide activity" }).click();
    // Keyboard drag: move "links" above "league".
    const handle = page.getByRole("button", { name: "Move links" });
    await handle.focus();
    // dnd-kit announces each step to screen readers; waiting on it paces the keys.
    const live = page.locator('[id^="DndLiveRegion"]');
    await page.keyboard.press("Space");
    await expect(live).toContainText("moved over droppable area links");
    await page.keyboard.press("ArrowUp");
    await expect(live).toContainText("moved over droppable area league");
    await page.keyboard.press("Space");
    await expect(live).toContainText("was dropped");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(page.getByText("Your profile is updated")).toBeVisible();

    const [saved] = (
      await pool.query("SELECT theme,layout FROM profiles WHERE handle='diya'")
    ).rows;
    expect(saved.theme.name).toBe("Forest");
    expect(saved.layout.columns).toBe(1);
    expect(saved.layout.sections).not.toContain("activity");
    expect(saved.layout.sections.indexOf("links")).toBeLessThan(
      saved.layout.sections.indexOf("league"),
    );

    const view = await classmate.newPage();
    await view.goto("/u/diya");
    await expect(
      view.getByRole("heading", { name: "Diya Reddy", exact: true }),
    ).toBeVisible();
    const card = view.locator(".profile-preview");
    await expect(card).toHaveCSS("--profile-columns", "1");
    await expect(card).toHaveCSS("--profile-accent", saved.theme.accent);
    await expect(view.getByText(titles.activity)).toHaveCount(0);
    const order = await view.locator(".profile-section h2").allTextContents();
    expect(order).toEqual(
      saved.layout.sections.map((s: string) => titles[s] ?? s),
    );
  } finally {
    await pool.query(
      "UPDATE profiles SET theme=$1,layout=$2 WHERE handle='diya'",
      [original.theme, original.layout],
    );
    await owner.close();
    await classmate.close();
  }
});
