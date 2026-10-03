import { test, expect } from "@playwright/test";
import { loginAs } from "./auth";

test("login pages explain sign-in errors and protected areas route to the right login", async ({
  page,
}) => {
  await page.goto("/tutor/login?error=not-tutor");
  await expect(page.locator(".error-callout")).toContainText(
    "This account isn’t a tutor account.",
  );
  await expect(
    page.getByRole("button", { name: "Tutor sign in" }),
  ).toBeVisible();

  await page.goto("/login?error=unable_to_get_user_info");
  await expect(page.locator(".error-callout")).toHaveText(
    "Please use a Google account with a verified email address.",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  // Google is the only way in: no password or email fields anywhere.
  await expect(
    page.locator('input[type="password"], input[type="email"]'),
  ).toHaveCount(0);

  for (const [path, login] of [
    ["/dashboard", "/login"],
    ["/learn/sql-from-zero-to-interview", "/login"],
    ["/teach", "/tutor/login"],
    ["/admin", "/tutor/login"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${login}(\\?|$)`));
  }
});

test("signed-in staff visiting /login go to their home", async ({
  browser,
}) => {
  const admin = await browser.newContext();
  await loginAs(admin, "admin-e2e@example.com", true);
  const ap = await admin.newPage();
  await ap.goto("/login");
  await expect(ap).toHaveURL(/\/admin$/);
  await admin.close();

  const tutor = await browser.newContext();
  await loginAs(tutor, "instructor@example.com");
  const tp = await tutor.newPage();
  await tp.goto("/login");
  await expect(tp).toHaveURL(/\/teach$/);
  await tutor.close();
});
