import { test, expect } from "@playwright/test";
import { loginAs } from "./auth";

test("strict CSP: nonce-based scripts, no inline-script allowance, no violations", async ({
  page,
  context,
}) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/.test(m.text()))
      violations.push(m.text());
  });
  const first = await page.goto("/");
  const csp = first!.headers()["content-security-policy"];
  const scriptSrc = csp
    .split(";")
    .find((d) => d.trim().startsWith("script-src"))!;
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  // A fresh nonce per response.
  const again = (await page.request.get("/")).headers()[
    "content-security-policy"
  ];
  expect(again).not.toBe(csp);

  await loginAs(context, "student1@example.com");
  for (const path of [
    "/",
    "/courses",
    "/courses/sql-from-zero-to-interview",
    "/dashboard",
    "/notes",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});
