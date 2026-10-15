"use client";
import { useEffect, useState, useCallback } from "react";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response
    .json()
    .catch(() => ({ message: "Máy chủ không phản hồi đúng định dạng." }));
  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith("/auth/") &&
      window.location.pathname !== "/login"
    )
      window.dispatchEvent(new Event("comm:unauthorized"));
    throw new Error(body.message || "Không thể kết nối máy chủ.");
  }
  return body.data as T;
}
export const send = <T>(path: string, method = "POST", body: unknown = {}) =>
  api<T>(path, { method, body: JSON.stringify(body) });
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Đã có lỗi xảy ra.";
export function useResource<T>(path: string | null, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((x) => x + 1), []);
  useEffect(() => {
    if (!path) return;
    let active = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await api<T>(path);
        if (active) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (active) setError(errorMessage(e));
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = interval
      ? setInterval(() => {
          if (!document.hidden) void load();
        }, interval)
      : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [path, revision, interval]);
  return { data, error, loading, refresh };
}
