import { auth, currentUser } from "@/server/auth";
import { postSignIn } from "@/server/signin";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const u = await currentUser();
  if (!u) return NextResponse.redirect(new URL("/login", base));
  const { signOut, location } = await postSignIn(u.id, {
    tutor: url.searchParams.get("tutor") === "1",
    next: url.searchParams.get("next"),
  });
  const out = NextResponse.redirect(new URL(location, base));
  if (signOut) {
    const response = await auth.api.signOut({
      headers: await headers(),
      asResponse: true,
    });
    for (const c of response.headers.getSetCookie())
      out.headers.append("set-cookie", c);
  }
  return out;
}
