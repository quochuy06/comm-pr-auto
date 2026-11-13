import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors.js";

// HUY-API01-A: đặt lịch cho video asset ĐÃ sinh xong. Trạng thái PUBLISHING/
// PUBLISHED/FAILED do HUY-WF03 (transport Meta) cập nhật sau — task này chỉ
// tạo/xem/hủy lịch, không đăng đi đâu cả. Một video job tối đa một lịch.
export async function createVideoSchedule(db, { videoJobId, scheduledAt, target = "FACEBOOK_PAGE", createdBy = "system" }) {
  if (typeof videoJobId !== "string" || !videoJobId)
    throw new HttpError(400, "Thiếu video job cần đặt lịch.");
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime()))
    throw new HttpError(400, "Thời điểm đặt lịch không hợp lệ.");
  if (when.getTime() <= Date.now())
    throw new HttpError(400, "Thời điểm đặt lịch phải ở tương lai.");
  if (target !== "FACEBOOK_PAGE")
    throw new HttpError(400, "Chỉ hỗ trợ đích FACEBOOK_PAGE trong giai đoạn này.");
  const asset = await db.videoAsset.findUnique({ where: { jobId: videoJobId } });
  if (!asset) throw new HttpError(404, "Không tìm thấy video job.");
  if (asset.status !== "SUCCEEDED")
    throw new HttpError(409, "Video chưa sinh xong hoặc thất bại; chỉ đặt lịch khi asset đã hoàn tất.");
  const active = await db.videoSchedule.findFirst({
    where: { videoJobId, status: { not: "CANCELLED" } },
  });
  if (active)
    throw new HttpError(409, "Video này đã có lịch đăng đang hoạt động; hủy lịch cũ trước khi đặt lại.");
  try {
    const schedule = await db.videoSchedule.create({
      data: { id: randomUUID(), videoJobId, scheduledAt: when, target },
    });
    await db.auditLog.create({
      data: { actor: createdBy, action: "video_schedule.create", entityId: schedule.id, detail: videoJobId },
    });
    return getSchedule(db, schedule.id);
  } catch (e) {
    if (e.code === "P2002")
      throw new HttpError(409, "Video này đã có lịch đăng; không đặt trùng.");
    throw e;
  }
}

export async function cancelVideoSchedule(db, id, { by = "system" } = {}) {
  const schedule = await db.videoSchedule.findUnique({ where: { id } });
  if (!schedule) throw new HttpError(404, "Không tìm thấy lịch đăng video.");
  if (schedule.status === "CANCELLED") return getSchedule(db, id); // idempotent
  if (!["PENDING"].includes(schedule.status))
    throw new HttpError(409, "Lịch đã bắt đầu xử lý; không hủy được nữa.");
  await db.videoSchedule.update({ where: { id }, data: { status: "CANCELLED" } });
  await db.auditLog.create({ data: { actor: by, action: "video_schedule.cancel", entityId: id } });
  return getSchedule(db, id);
}

export async function getSchedule(db, id) {
  const schedule = await db.videoSchedule.findUnique({
    where: { id },
    include: { job: { include: { videoAsset: true } } },
  });
  if (!schedule) throw new HttpError(404, "Không tìm thấy lịch đăng video.");
  const asset = schedule.job.videoAsset;
  return {
    id: schedule.id,
    videoJobId: schedule.videoJobId,
    scheduledAt: schedule.scheduledAt,
    target: schedule.target,
    status: schedule.status,
    error: schedule.error,
    video: asset
      ? { status: asset.status, url: asset.filePath, duration: asset.duration, width: asset.width, height: asset.height }
      : null,
    createdAt: schedule.createdAt,
  };
}

export async function listVideoSchedules(db, { status } = {}) {
  const rows = await db.videoSchedule.findMany({
    where: status ? { status } : {},
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });
  return Promise.all(rows.map((r) => getSchedule(db, r.id)));
}
