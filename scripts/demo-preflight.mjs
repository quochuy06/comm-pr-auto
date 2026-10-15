// Read-only checks; never calls AI, changes records or prints credentials.
import fs from "node:fs";
const failures = [],
  warnings = [];
async function get(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
}
for (const [name, url] of [
  ["Backend", "http://localhost:5000/health"],
  ["n8n", "http://localhost:5678/healthz/readiness"],
  ["Web", "http://localhost:3000/login"],
]) {
  try {
    const r = await get(url);
    if (!r.ok) throw Error("HTTP " + r.status);
    if (name === "Backend" && (await r.json()).database !== "OK")
      throw Error("Database unavailable");
    console.log("PASS", name);
  } catch (e) {
    failures.push(name + ": " + e.message);
  }
}
try {
  const account = JSON.parse(fs.readFileSync(".local/demo-accounts.json")).find(
    (a) => a.role === "ADMIN",
  );
  const login = await get("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!login.ok) throw Error("Login HTTP " + login.status);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  async function api(path) {
    const r = await get("http://localhost:5000/api" + path, {
      headers: { Cookie: cookie },
    });
    if (!r.ok) throw Error(path + " HTTP " + r.status);
    return (await r.json()).data;
  }
  try {
    const [posts, alerts, jobs, settings] = await Promise.all(
      ["/posts", "/alerts", "/jobs", "/settings"].map(api),
    );
    let readyPosts = 0;
    for (const p of posts.filter(
      (p) =>
        ["APPROVED", "PUBLISHED"].includes(p.status) &&
        p.content &&
        p.bannerUrl?.startsWith("/media/"),
    )) {
      const r = await get("http://localhost:5000" + p.bannerUrl, {
        method: "HEAD",
      });
      if (r.ok && r.headers.get("content-type")?.startsWith("image/"))
        readyPosts++;
    }
    const drafts = alerts.filter(
      (a) => a.status === "PENDING_APPROVAL" && a.statement,
    ).length;
    const running = jobs.filter((j) =>
      ["QUEUED", "RUNNING"].includes(j.status),
    ).length;
    if (!readyPosts)
      warnings.push("Chưa có bài đã duyệt kèm ảnh local tải được để dự phòng.");
    if (!drafts) warnings.push("Chưa có thông cáo chờ duyệt để dự phòng.");
    if (running)
      warnings.push(
        running + " job đang chạy; không restart backend/n8n lúc này.",
      );
    console.log(
      JSON.stringify({
        readyPosts,
        pendingCrisisDrafts: drafts,
        runningJobs: running,
        mode: settings.mode,
        negativeThreshold: settings.negativeThreshold,
        windowMinutes: settings.windowMinutes,
      }),
    );
  } finally {
    await get("http://localhost:5000/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
  }
} catch (e) {
  failures.push("API/account: " + e.message);
}
for (const file of fs
  .readdirSync("n8n/workflows")
  .filter((f) => f.endsWith(".json"))) {
  const w = JSON.parse(fs.readFileSync("n8n/workflows/" + file));
  if (w.nodes.length < 12) failures.push(file + " has fewer than 12 nodes");
  console.log("Workflow file:", file, w.nodes.length, "nodes");
}
for (const w of warnings) console.log("WARNING", w);
for (const e of failures) console.error("FAIL", e);
console.log(
  "AI live availability is not tested here. Run one real workflow before presenting.",
);
process.exitCode = failures.length ? 1 : 0;
