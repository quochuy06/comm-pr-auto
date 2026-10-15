"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Radio, ArrowRight } from "lucide-react";
import { send, errorMessage } from "@/lib/api";
import { Notice } from "@/components/ui";
export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="login-screen">
      <section className="card login-card">
        <div className="brand">
          <span className="brand-icon">
            <Radio size={23} />
          </span>
          <span>
            PR Workspace<small>Communication & PR</small>
          </span>
        </div>
        <h1>Chào mừng trở lại</h1>
        <p className="muted">
          Đăng nhập để quản lý nội dung, cộng đồng và phản hồi truyền thông.
        </p>
        <Notice error={error} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await send("/auth/login", "POST", {
                email: form.get("email"),
                password: form.get("password"),
              });
              router.replace("/");
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="ten@commpr.local"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button disabled={busy} className="btn full">
            {busy ? "Đang đăng nhập…" : "Vào không gian làm việc"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="hint mt">
          Tài khoản do quản trị viên cung cấp. Phiên đăng nhập có thời hạn 24
          giờ.
        </p>
      </section>
    </div>
  );
}
