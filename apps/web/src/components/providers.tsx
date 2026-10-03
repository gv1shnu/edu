"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      nonce={nonce}
    >
      <Toaster richColors position="bottom-right" />
      {children}
    </ThemeProvider>
  );
}
