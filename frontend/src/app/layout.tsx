import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Realtime Chess",
  description: "Login, create a room, invite a player, and play chess in realtime."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
