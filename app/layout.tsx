import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OSC Monitor",
  description: "Live monitoring dashboard for Open Source Cloud platform activity",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full antialiased bg-gray-950 text-gray-100" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
