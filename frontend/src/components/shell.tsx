"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  FolderOpen,
  CheckCheck,
  MessageSquare,
  ShieldAlert,
  Settings,
  LogOut,
  Radio,
} from "lucide-react";
import { api, send } from "@/lib/api";
import type { User } from "@/lib/types";
const AuthContext = createContext<User | null>(null);
export const useAuth = () => useContext(AuthContext);
const links = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/campaigns", label: "Chiến dịch", icon: FolderOpen },
  { href: "/planning", label: "Kế hoạch & lịch đăng", icon: FolderOpen },
  { href: "/studio", label: "Content Studio", icon: Sparkles },
  { href: "/approval", label: "Hàng đợi duyệt", icon: CheckCheck },
  { href: "/simulator", label: "Feed & bình luận", icon: MessageSquare },
  { href: "/alerts", label: "Cảnh báo rủi ro", icon: ShieldAlert },
  { href: "/insights", label: "Chuyển thể & báo cáo", icon: LayoutDashboard },
  { href: "/settings", label: "Cài đặt", icon: Settings },
];
export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    if (pathname === "/login") return;
    let active = true;
    api<User>("/auth/me")
      .then((u) => {
        if (active) {
          setUser(u);
          setAuthError("");
        }
      })
      .catch(() => {
        if (active) {
          setUser(null);
          router.replace("/login");
        }
      });
    return () => {
      active = false;
    };
  }, [pathname, router]);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      router.replace("/login");
    };
    window.addEventListener("comm:unauthorized", expired);
    return () => window.removeEventListener("comm:unauthorized", expired);
  }, [router]);
  if (pathname === "/login") return children;
  if (!user)
    return <div className="center-screen">Đang kiểm tra phiên đăng nhập…</div>;
  return (
    <AuthContext.Provider value={user}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link className="brand" href="/">
            <span className="brand-icon">
              <Radio size={22} />
            </span>
            <span>
              PR Workspace<small>Truyền thông có kiểm soát</small>
            </span>
          </Link>
          <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
          <nav>
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={pathname === href ? "nav-link active" : "nav-link"}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="sidebar-note">
            <strong>Quy trình PR</strong>
            <p>
              8 workflow · AI hỗ trợ
              <br />
              Người dùng kiểm soát quyết định
            </p>
            <span className="badge">Feed mô phỏng</span>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <span className="muted">Communication & PR</span>
            <div className="row">
              <span className="user-avatar">{user.name.slice(0, 1)}</span>
              <div>
                <strong>{user.name}</strong>
                <small className="muted block">
                  {
                    {
                      ADMIN: "Quản trị viên",
                      EDITOR: "Biên tập viên",
                      REVIEWER: "Người duyệt",
                    }[user.role]
                  }
                </small>
              </div>
              <button
                className="icon-button"
                aria-label="Đăng xuất"
                onClick={async () => {
                  try {
                    await send("/auth/logout");
                    setUser(null);
                    router.replace("/login");
                  } catch {
                    setAuthError("Đăng xuất chưa thành công. Hãy thử lại.");
                  }
                }}
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>
          <main className="main-content">
            {authError && <p className="notice error">{authError}</p>}
            {children}
          </main>
          <footer className="footer">
            PR Workspace · Bài viết xuất bản theo kênh đã chọn. Bình luận và phản hồi hiện dùng feed mô phỏng.
          </footer>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
