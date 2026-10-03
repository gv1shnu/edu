import { test, expect } from "@playwright/test";
import { loginAs } from "./auth";

test("removed features stay unavailable", async ({ page, context }) => {
  await loginAs(context, "student1@example.com");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
  await expect(
    page.locator(
      'a[href^="/challenges"], a[href^="/assignments"], a[href^="/quizzes"], a[href^="/coursework"]',
    ),
  ).toHaveCount(0);
  for (const path of [
    "challenges",
    "assignments",
    "grades",
    "quizzes",
    "attempts",
    "questions",
    "banks",
    "coursework",
  ]) {
    expect((await page.request.get(`/api/${path}/x`)).status()).toBe(404);
    expect(
      (
        await page.request.post(`/api/${path}`, {
          data: {},
          headers: { origin: "http://localhost:3000" },
        })
      ).status(),
    ).toBe(404);
  }
  for (const path of [
    "/challenges",
    "/refund-policy",
    "/assignments/example",
    "/quizzes/example",
    "/coursework/example",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
  await page.goto("/courses/sql-from-zero-to-interview");
  await expect(
    page.getByRole("link", { name: /quiz|assignment/i }),
  ).toHaveCount(0);
  await page.goto("/settings/profile");
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Hide my name in league results")).toHaveCount(0);
});

test("tutors get HTML lessons, no video, no quizzes and no meeting links", async ({
  page,
  context,
}) => {
  await loginAs(context, "instructor@example.com");
  await page.goto("/teach");
  await page
    .getByRole("link")
    .filter({ hasText: "SQL from Zero to Interview" })
    .click();
  await expect(page.getByRole("link", { name: "Lessons" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Assessments" })).toHaveCount(0);
  const url = page.url();
  expect((await page.goto(url + "/assessments"))?.status()).toBe(404);
  await page.goto(url);
  await page.getByRole("button", { name: "+ Lesson", exact: true }).click();
  const lesson = page.getByRole("dialog");
  await expect(
    lesson.getByLabel("Lesson content · HTML", { exact: true }),
  ).toBeVisible();
  await expect(lesson.getByLabel(/YouTube|Vimeo/)).toHaveCount(0);
  const formats = await lesson
    .getByLabel("Lesson format")
    .locator("option")
    .allTextContents();
  expect(formats.join(",")).not.toMatch(/video|markdown/i);
  await page.keyboard.press("Escape");
  await page.goto(url + "/live");
  await page
    .getByRole("button", { name: "+ Start or schedule class", exact: true })
    .click();
  const live = page.getByRole("dialog");
  await expect(live.getByLabel("Length (minutes)")).toBeVisible();
  await expect(live.getByLabel(/Meet|Zoom/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Connect Google Calendar" }),
  ).toBeVisible();
});

test("admins invite instructors only and see no seat controls", async ({
  page,
  context,
}) => {
  await loginAs(context, "scope-admin@example.com", true);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Batches", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Seats left", { exact: true })).toHaveCount(0);
  await page.goto("/admin/staff");
  await page.getByRole("button", { name: "Invite staff", exact: true }).click();
  const invite = page.getByRole("dialog");
  await expect(invite.getByLabel("Gmail address")).toBeVisible();
  await expect(invite.getByLabel("Role")).toHaveCount(0);
  await expect(invite.getByText(/TA|teaching assistant/i)).toHaveCount(0);
});

test("on a fresh site an admin can add a subject and write the terms", async ({
  page,
  context,
}) => {
  const name = `Subject ${Date.now()}`;
  await loginAs(context, "scope-admin@example.com", true);
  await page.goto("/admin");
  await page.getByRole("button", { name: "+ Subject", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Subject name, e.g. Data & SQL").fill(name);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await page.goto("/admin/settings");
  await expect(
    page.getByRole("heading", { name: "Terms", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Privacy", exact: true }),
  ).toBeVisible();
});
