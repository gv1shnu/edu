import { processWebhook } from "@/server/payments";
import { createHash } from "node:crypto";
import { HttpError, log } from "@/server/core";
export async function POST(req: Request) {
  try {
    const body = await req.text();
    if (body.length > 1000000)
      return new Response("Too large", { status: 413 });
    await processWebhook(
      body,
      req.headers.get("x-razorpay-signature") || "",
      req.headers.get("x-razorpay-event-id") ||
        createHash("sha256").update(body).digest("hex"),
    );
    return Response.json({ ok: true });
  } catch (e) {
    log.error(e);
    return Response.json(
      { error: "Webhook rejected" },
      { status: e instanceof HttpError ? e.status : 500 },
    );
  }
}
