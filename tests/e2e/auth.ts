import "dotenv/config";
import { Pool } from "pg";
import { v7 } from "uuid";
import { createHmac, randomBytes } from "node:crypto";
import { assertTestAuth } from "../../packages/shared/src/index";
import type { BrowserContext } from "@playwright/test";
export async function loginAs(
  context: BrowserContext,
  email: string,
  admin = false,
) {
  if (!assertTestAuth(process.env))
    throw new Error(
      "Test session creation requires NODE_ENV=test and E2E_AUTH_BYPASS=1",
    );
  const pool = new Pool({
    // Owner connection: assertions read RLS-protected tables without a user context.
    connectionString:
      process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  });
  try {
    let user = (await pool.query("SELECT * FROM users WHERE email=$1", [email]))
      .rows[0];
    if (!user && admin) {
      user = (
        await pool.query(
          "INSERT INTO users(id,name,email,email_verified,is_admin) VALUES($1,$2,$3,true,true) RETURNING *",
          [v7(), "Test Owner", email],
        )
      ).rows[0];
    }
    if (!user) throw new Error("Seed user missing");
    if (admin && !user.is_admin) throw new Error("Expected test admin");
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [v7(), user.id, token],
    );
    const signed = encodeURIComponent(
      token +
        "." +
        createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
          .update(token)
          .digest("base64"),
    );
    const url = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    // Dev uses the plain cookie name; production builds use the __Secure- prefix
    // (localhost counts as a secure context, so both work in tests).
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: signed,
        url,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "__Secure-better-auth.session_token",
        value: signed,
        domain: new URL(url).hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    return user;
  } finally {
    await pool.end();
  }
}
