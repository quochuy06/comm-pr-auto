import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 860, margin: "40px auto", padding: "28px clamp(16px, 4vw, 40px)", background: "white", borderRadius: 16, overflowWrap: "anywhere" }}>
      <p>Hiên Cà Phê · Hien Cafe PR</p>
      {children}
      <hr />
      <nav aria-label="Thông tin ứng dụng" style={{ display: "flex", flexWrap: "wrap", gap: 20, color: "#425bd8" }}>
        <Link href="/privacy">Quyền riêng tư</Link>
        <Link href="/terms">Điều khoản</Link>
        <Link href="/data-deletion">Xóa dữ liệu</Link>
        <Link href="/login">Đăng nhập</Link>
      </nav>
    </main>
  );
}
