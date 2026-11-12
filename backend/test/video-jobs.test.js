import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import db from "../src/prisma.js";
import {
  createVideoJob,
  syncVideoJob,
  getVideoState,
  validateVideoInput,
  videoDir,
} from "../src/services/videoJobs.js";
import { mockProvider } from "../src/services/video/mock.js";
import { makeAgnesProvider } from "../src/services/video/agnes.js";

const skip = process.env.RUN_DB_TESTS !== "true";
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function cleanup(jobId, state) {
  await db.workflowJob.deleteMany({ where: { id: jobId } }); // cascades attempts + VideoAsset
  if (state?.result?.url)
    await rm(path.join(videoDir, path.basename(state.result.url)), { force: true });
}

test("validateVideoInput: rejects invalid prompt/duration/ratio", () => {
  for (const bad of [
    { prompt: "" },
    { prompt: "x".repeat(2001) },
    { prompt: "ok", duration: 2 },
    { prompt: "ok", duration: 16 },
    { prompt: "ok", duration: 5.5 },
    { prompt: "ok", aspectRatio: "4:3" },
  ])
    assert.throws(() => validateVideoInput(bad), (e) => e.status === 400);
  const ok = validateVideoInput({ prompt: "  Cà phê  ", duration: 5, aspectRatio: "9:16" });
  assert.equal(ok.prompt, "Cà phê");
  assert.deepEqual([ok.width, ok.height], [720, 1280]);
});

test("Agnes adapter: task lifecycle parsed defensively", async () => {
  process.env.AGNES_API_KEY = "test-key";
  try {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/v1/videos")) return jsonResponse({ video_id: "task-1", task_id: "t-9" });
      if (url.includes("/agnesapi?video_id=task-1"))
        return jsonResponse({ status: "completed", video_url: "https://cdn.example/clip.mp4" });
      if (url.includes("/agnesapi?video_id=task-2")) return jsonResponse({ status: "running" });
      if (url.includes("/agnesapi?video_id=task-3")) return jsonResponse({ status: "failed", error: "h\u1ebft quota" });
      if (url.includes("/agnesapi?video_id=missing")) return jsonResponse({ error: "not found" }, 404);
      if (url === "https://cdn.example/clip.mp4")
        return new Response(new Uint8Array(64), { status: 200 });
      throw new Error("unexpected url " + url);
    };
    const provider = makeAgnesProvider(fetchImpl);
    const created = await provider.createJob({ prompt: "test", duration: 5, aspectRatio: "9:16" });
    assert.equal(created.providerJobId, "task-1"); // video_id is the retrieval key
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Authorization, ["Bearer", "test-key"].join(" "));
    const body = JSON.parse(calls[0].options.body);
    // Live API contract (verified 2026-11-12): seconds is a string, mode/size
    // required, width/height/duration/num_frames/frame_rate are forbidden.
    assert.deepEqual(Object.keys(body).sort(), ["aspect_ratio", "mode", "model", "prompt", "seconds", "size"]);
    assert.equal(body.model, process.env.AGNES_VIDEO_MODEL || "agnes-video-2.5-flash");
    assert.equal(body.seconds, "5");
    assert.equal(body.mode, "text");
    assert.equal(body.size, "720P");
    assert.equal(body.aspect_ratio, "9:16");
    assert.equal((await provider.getJob("task-1")).status, "SUCCEEDED");
    assert.equal((await provider.getJob("task-2")).status, "RUNNING");
    const failed = await provider.getJob("task-3");
    assert.equal(failed.status, "FAILED");
    assert.match(failed.error, /quota/);
    assert.equal((await provider.getJob("missing")).status, "FAILED");
    const fetched = await provider.fetchVideo("https://cdn.example/clip.mp4");
    assert.equal(fetched.bytes.length, 64);
  } finally {
    delete process.env.AGNES_API_KEY;
  }
});

test("Agnes adapter: missing key and malformed create response", async () => {
  delete process.env.AGNES_API_KEY;
  const provider = makeAgnesProvider(async () => new Response("nope"));
  await assert.rejects(provider.createJob({ prompt: "x" }), (e) => e.status === 503);
  process.env.AGNES_API_KEY = "test-key";
  try {
    const bad = makeAgnesProvider(async () => jsonResponse({ message: "bad request" }));
    await assert.rejects(bad.createJob({ prompt: "x" }), (e) => e.status === 502);
  } finally {
    delete process.env.AGNES_API_KEY;
  }
});

test("Video job: provider job ID persisted before poll; sync verifies MP4; polls never re-generate", { skip }, async () => {
  let created = 0;
  const provider = {
    ...mockProvider,
    async createJob(params) { created++; return mockProvider.createJob(params); },
  };
  let state;
  try {
    const job = await createVideoJob(
      db,
      { prompt: "Cà phê nóng bên cửa sổ buổi sáng", duration: 3 },
      { provider, entityId: randomUUID() },
    );
    assert.equal(job.status, "PENDING");
    const attempt = await db.workflowAttempt.findFirst({ where: { jobId: job.jobId } });
    assert.match(attempt.providerJobId, /^mock-/); // persisted BEFORE any poll
    state = await syncVideoJob(db, job.jobId, { provider });
    assert.equal(state.status, "SUCCEEDED");
    assert.ok(["FFPROBE", "CONTAINER_ONLY"].includes(state.result.verification));
    assert.match(state.result.url, /^\/media\/videos\/.*\.mp4$/);
    assert.equal(state.result.sha256.length, 64);
    if (state.result.verification === "FFPROBE") {
      assert.ok(state.result.duration > 0);
      assert.equal(state.result.width, 1280); // 16:9 profile from validateVideoInput
      assert.equal(state.result.height, 720);
    }
    for (let i = 0; i < 2; i++) {
      const again = await syncVideoJob(db, job.jobId, { provider });
      assert.equal(again.status, "SUCCEEDED");
      assert.equal(again.result.sha256, state.result.sha256);
    }
    assert.equal(created, 1); // idempotent polls: one generation only
    assert.equal((await getVideoState(db, job.jobId)).status, "SUCCEEDED");
  } finally {
    await cleanup(state?.jobId, state);
  }
});

test("Video job: provider timeout finalizes FAILED without re-generating", { skip }, async () => {
  let created = 0;
  const provider = {
    name: "mock",
    async createJob() { created++; return { providerJobId: "mock-" + randomUUID() }; },
    async getJob() { return { status: "RUNNING" }; },
    async fetchVideo() { throw new Error("không được gọi fetchVideo khi đang chạy"); },
  };
  let jobId;
  try {
    const job = await createVideoJob(db, { prompt: "Chờ quá lâu", duration: 3 }, { provider, entityId: randomUUID() });
    jobId = job.jobId;
    await db.videoAsset.update({
      where: { jobId },
      data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    const state = await syncVideoJob(db, jobId, { provider });
    assert.equal(state.status, "FAILED");
    assert.match(state.error, /PROVIDER_TIMEOUT/);
    const later = await syncVideoJob(db, jobId, { provider });
    assert.equal(later.status, "FAILED"); // terminal state: no extra provider calls
    assert.equal(created, 1);
  } finally {
    await cleanup(jobId);
  }
});

test("Video job: provider failure propagates as FAILED with reason", { skip }, async () => {
  let created = 0;
  const provider = {
    name: "mock",
    async createJob() { created++; return { providerJobId: "mock-" + randomUUID() }; },
    async getJob() { return { status: "FAILED", error: "hết quota phía nhà cung cấp" }; },
    async fetchVideo() { throw new Error("không được gọi"); },
  };
  let jobId;
  try {
    const job = await createVideoJob(db, { prompt: "Thất bại mô phỏng", duration: 3 }, { provider, entityId: randomUUID() });
    jobId = job.jobId;
    const state = await syncVideoJob(db, jobId, { provider });
    assert.equal(state.status, "FAILED");
    assert.match(state.error, /quota/);
    assert.equal(created, 1);
  } finally {
    await cleanup(jobId);
  }
});

test("Video job: invalid MP4 result finalizes FAILED", { skip }, async () => {
  const provider = {
    name: "mock",
    async createJob() { return { providerJobId: "mock-" + randomUUID() }; },
    async getJob() { return { status: "SUCCEEDED", videoUrl: "mock://clip/bad" }; },
    async fetchVideo() {
      return { bytes: Buffer.from("day khong phai mp4 ma chi la chu thoi thoi thoi"), mimeType: "video/mp4" };
    },
  };
  let jobId;
  try {
    const job = await createVideoJob(db, { prompt: "MP4 hỏng", duration: 3 }, { provider, entityId: randomUUID() });
    jobId = job.jobId;
    const state = await syncVideoJob(db, jobId, { provider });
    assert.equal(state.status, "FAILED");
    assert.match(state.error, /MP4|ftyp/);
  } finally {
    await cleanup(jobId);
  }
});
