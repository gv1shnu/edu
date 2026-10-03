import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { v7 } from "uuid";
import { loginAs } from "./auth";

const pool = new Pool({
  // Owner connection: assertions read RLS-protected tables without a user context.
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());

test("a student deletes their account from settings and is fully signed out", async ({
  browser,
}) => {
  const id = v7();
  const handle = `gone${Date.now() % 1000000}`;
  const email = `${handle}@example.com`;
  await pool.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Soon Gone',$2,true)",
    [id, email],
  );
  await pool.query(
    "INSERT INTO profiles(id,user_id,handle,display_name,headline,bio_md,location,visibility) VALUES($1,$2,$3,'Soon Gone','','','','public')",
    [v7(), id, handle],
  );
  const context = await browser.newContext();
  await loginAs(context, email);
  const page = await context.newPage();
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Delete my account" }).click();
  const confirm = page.getByRole("button", {
    name: "Permanently delete my account",
  });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Confirm account deletion").fill("DELETE");
  await confirm.click();
  await expect(page).toHaveURL(/\/$/);

  // Sessions are gone: the old cookie no longer works.
  expect((await context.request.get("/api/dashboard")).status()).toBe(401);
  const [user] = (
    await pool.query("SELECT name,email,deleted_at FROM users WHERE id=$1", [
      id,
    ])
  ).rows;
  expect(user.name).toBe("Deleted learner");
  expect(user.email).not.toBe(email);
  expect(user.deleted_at).not.toBeNull();
  // The public profile is gone for everyone.
  const visitor = await browser.newContext();
  expect((await visitor.request.get(`/api/profiles/${handle}`)).status()).toBe(
    404,
  );
  await Promise.all([context.close(), visitor.close()]);
});
