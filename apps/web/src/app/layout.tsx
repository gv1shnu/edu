import type { Metadata } from "next";
import { headers } from "next/headers";
import { currentUser } from "@/server/auth";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://edu.vishnugandarapu.in",
  ),
  title: {
    default: "Edu - Vishnu Gandarapu",
    template: "%s · Edu - Vishnu Gandarapu",
  },
  description:
    "Learn SQL, databases, and cybersecurity with Vishnu Gandarapu. Live small-group tutoring, hands-on practice, and feedback that helps you grow.",
  icons: { icon: "/icon.svg" },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers nonce={nonce}>
          <Shell user={user}>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
