import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataFinder 云端查询",
  description: "私有云端 DataFinder 只读查询插件",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
