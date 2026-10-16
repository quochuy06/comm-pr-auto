import fs from "node:fs";
const mode = process.argv[2] || "content";
if (!["content", "community", "crisis"].includes(mode)) {
  console.error("Usage: node scripts/live-demo.mjs content|community|crisis");
  process.exit(1);
}
const account = JSON.parse(fs.readFileSync(".local/demo-accounts.json")).find(
  (a) => a.role === "ADMIN",
);
const base = "http://localhost:5000/api";
const login = await fetch(base + "/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: account.email, password: account.password }),
});
if (!login.ok) throw new Error("Demo login failed");
const cookie = login.headers.get("set-cookie").split(";")[0];
async function api(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(r.status + ": " + value.message);
  return value.data;
}
async function wait(entityId, kind, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let tick = 0;
  while (Date.now() < deadline) {
    const job = (await api("/jobs?entityId=" + entityId)).find(
      (j) => j.kind === kind,
    );
    if (job && ["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"].includes(job.status)) {
      console.log(
        JSON.stringify({ kind, status: job.status, error: job.error }),
      );
      return job;
    }
    if (tick++ % 6 === 0)
      console.log(JSON.stringify({ kind, status: job?.status }));
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Job did not finish within demo timeout: " + kind);
}
fs.mkdirSync(".local/demo-runs", { recursive: true });
const file = ".local/demo-runs/" + Date.now() + "-" + mode + ".json",
  result = { mode };
try {
  if (mode === "content") {
    const post = await api("/posts/generate", "POST", {
      topic:
        "[DEMO GIỮA KỲ] Khuyến khích sinh viên đọc sách mỗi ngày. Giữ nhãn DEMO ở tiêu đề, không thêm giá, ưu đãi, lịch hay số liệu.",
      targetAudience: "Sinh viên",
      tone: "Gần gũi",
      platform: "Facebook",
      imagePrompt:
        "An open paperback book on a wooden desk beside a green plant, close-up photograph in daylight.",
    });
    result.postId = post.id;
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    result.job = await wait(post.id, "content", 440);
    result.post = await api("/posts/" + post.id);
    console.log(
      JSON.stringify({
        post: result.post.status,
        image: result.post.imageStatus,
        imageReview: result.post.imageReviewStatus,
        reason: result.post.imageReview?.reason,
      }),
    );
  } else {
    const posts = await api("/posts"),
      alerts = mode === "crisis" ? await api("/alerts") : [];
    const post = posts.find(
      (p) =>
        ["APPROVED", "PUBLISHED"].includes(p.status) &&
        p.content &&
        (mode !== "crisis" ||
          !alerts.some(
            (a) =>
              a.postId === p.id && !["RESOLVED", "REJECTED"].includes(a.status),
          )),
    );
    if (!post)
      throw new Error(
        mode === "crisis"
          ? "Cần bài đã duyệt chưa có cảnh báo mở để demo tạo cảnh báo mới. Hãy xử lý cảnh báo cũ hoặc chuẩn bị bài khác."
          : "Cần một bài đã duyệt để thử bình luận.",
      );
    const c = await api("/posts/" + post.id + "/comments", "POST", {
      text:
        mode === "crisis"
          ? "[BÌNH LUẬN GIẢ LẬP KIỂM THỬ] Tôi phản ánh sản phẩm gây ngộ độc phải nhập viện. Đề nghị nhóm xác minh."
          : "[DEMO GIỮA KỲ] Cảm ơn nhóm đã chia sẻ nội dung hữu ích!",
    });
    result.commentId = c.id;
    result.postId = post.id;
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    result.job = await wait(c.id, "community", 260);
    result.comment = (await api("/comments")).find((x) => x.id === c.id);
    if (mode === "crisis") {
      const a = (await api("/alerts")).find((a) =>
        a.evidence.some((e) => e.id === c.id),
      );
      if (!a)
        throw new Error("Không tìm thấy cảnh báo cho bình luận kiểm thử.");
      result.crisisJob = await wait(a.id, "crisis", 260);
      result.alert = (await api("/alerts")).find((x) => x.id === a.id);
      console.log(
        JSON.stringify({
          alert: result.alert.status,
          publishedAt: result.alert.publishedAt,
        }),
      );
    }
  }
  if (
    result.job?.status !== "SUCCEEDED" ||
    (mode === "content" && (result.post?.imageStatus !== "VERIFIED" || result.post?.imageReviewStatus !== "PASS")) ||
    (result.crisisJob && result.crisisJob.status !== "SUCCEEDED")
  )
    process.exitCode = 1;
} catch (e) {
  result.error = e.message;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log("Evidence saved:", file);
}
