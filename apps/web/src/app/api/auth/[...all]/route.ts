import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { rate } from "@/server/core";
const handlers = toNextJsHandler(auth);
export async function GET(req: Request) {
  await rate(
    `auth:${req.headers.get("x-forwarded-for") || "unknown"}`,
    120,
    60,
  );
  return handlers.GET(req);
}
export async function POST(req: Request) {
  await rate(`auth:${req.headers.get("x-forwarded-for") || "unknown"}`, 30, 60);
  return handlers.POST(req);
}
