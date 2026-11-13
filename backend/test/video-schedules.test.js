import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import db from "../src/prisma.js";
import { createVideoJob, syncVideoJob, videoDir } from "../src/services/videoJobs.js";
import { mockProvider } from "../src/services/video/mock.js";
import {
  createVideoSchedule,
  cancelVideoSchedule,
  getSchedule,
  listVideoSchedules,
} from "../src/services/videoSchedules.js";

const skip = process.env.RUN_DB_TESTS !== "true";

test("VideoSchedule: đặt lịch cho asset hoàn tất, chặn trùng/quá khứ/chưa xong, hủy idempotent", { skip }, async () => {
  const jobIds = [];
  const files = [];
  try {
    // Tạo video thật qua mock provider
    const job = await createVideoJob(db, { prompt: "lịch test", duration: 3 }, { provider: mockProvider, entityId: randomUUID() });
    jobIds.push(job.jobId);
    const done = await syncVideoJob(db, job.jobId, { provider: mockProvider });
    assert.equal(done.status, "SUCCEEDED");
    files.push(path.basename(done.result.url));

    // Video job đang sinh (PENDING) → 409
    const pendingJob = await createVideoJob(db, { prompt: "đang sinh", duration: 3 }, {
      provider: { ...mockProvider, async getJob() { return { status: "RUNNING" }; } },
      entityId: randomUUID(),
    });
    jobIds.push(pendingJob.jobId);

    await assert.rejects(
      createVideoSchedule(db, { videoJobId: "khong-ton-tai", scheduledAt: new Date(Date.now() + 3600e3) }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      createVideoSchedule(db, { videoJobId: pendingJob.jobId, scheduledAt: new Date(Date.now() + 3600e3) }),
      (e) => e.status === 409,
    );
    await assert.rejects(
      createVideoSchedule(db, { videoJobId: done.jobId, scheduledAt: new Date(Date.now() - 1000) }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      createVideoSchedule(db, { videoJobId: done.jobId, scheduledAt: new Date(Date.now() + 3600e3), target: "TIKTOK" }),
      (e) => e.status === 400,
    );

    const when = new Date(Date.now() + 2 * 3600e3);
    const schedule = await createVideoSchedule(db, { videoJobId: done.jobId, scheduledAt: when, createdBy: "huy" });
    assert.equal(schedule.status, "PENDING");
    assert.equal(schedule.target, "FACEBOOK_PAGE");
    assert.equal(schedule.video.status, "SUCCEEDED");

    // Trùng lịch → 409
    await assert.rejects(
      createVideoSchedule(db, { videoJobId: done.jobId, scheduledAt: when }),
      (e) => e.status === 409,
    );

    // Hủy idempotent
    const cancelled = await cancelVideoSchedule(db, schedule.id, { by: "huy" });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal((await cancelVideoSchedule(db, schedule.id)).status, "CANCELLED");

    // Đã hủy → đặt lịch mới được (slot đã nhả)
    const rescheduled = await createVideoSchedule(db, { videoJobId: done.jobId, scheduledAt: when, createdBy: "huy" });
    assert.equal(rescheduled.status, "PENDING");

    const all = await listVideoSchedules(db, { status: "PENDING" });
    assert.ok(all.some((s) => s.id === rescheduled.id));
    assert.equal((await getSchedule(db, rescheduled.id)).videoJobId, done.jobId);
  } finally {
    await db.videoSchedule.deleteMany({ where: { videoJobId: { in: jobIds } } });
    await db.workflowJob.deleteMany({ where: { id: { in: jobIds } } });
    for (const f of files) await rm(path.join(videoDir, f), { force: true });
    await db.$disconnect();
  }
});
