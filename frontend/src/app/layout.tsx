import type { Metadata } from "next";
import Shell from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: "PR Workspace · Communication & PR",
  description:
    "Không gian quản lý nội dung, cộng đồng và phản hồi khủng hoảng.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
