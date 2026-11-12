import { HttpError } from "../lib/errors.js";

// HUY-API02: PR config (OFF/SEMI_AUTO/AUTO, mặc định OFF), nội dung PR có
// duyệt theo phiên bản, và outbox khóa duy nhất theo publication. CHỈ bài do
// hệ thống đăng (có PostSchedule) mới được tạo PR — một publication một PR.
const MODES = ["OFF", "SEMI_AUTO", "AUTO"];

export async function getPrConfig(db, pageId = "default") {
  const config = await db.prConfig.findUnique({ where: { id: "default" } });
  return config || { id: "default", pageId, mode: "OFF", version: 1 };
}

// CAS theo version: cấu hình đổi thì version tăng, đọc trước khi ghi.
export async function updatePrConfig(db, { pageId = "default", mode, version }) {
  if (!MODES.includes(mode))
    throw new HttpError(400, "Chế độ PR phải là OFF, SEMI_AUTO hoặc AUTO.");
  if (!Number.isInteger(version) || version < 1)
    throw new HttpError(400, "Phiên bản cấu hình không hợp lệ.");
  return db.$transaction(async (tx) => {
    const current = await tx.prConfig.findUnique({ where: { id: "default" } });
    if (!current) {
      if (version !== 1) throw new HttpError(409, "Phiên bản cấu hình đã thay đổi.");
      return tx.prConfig.create({ data: { id: "default", pageId, mode, version: 1 } });
    }
    if (current.version !== version)
      throw new HttpError(409, "Phiên bản cấu hình đã thay đổi; đọc lại trước khi lưu.");
    return tx.prConfig.update({
      where: { id: "default" },
      data: { mode, version: current.version + 1 },
    });
  });
}

export async function createPrContent(db, { pageId = "default", text, createdBy }) {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body || body.length > 2000)
    throw new HttpError(400, "Nội dung PR phải từ 1 đến 2000 ký tự.");
  return db.prContent.create({
    data: { pageId, text: body, createdBy: createdBy || null, version: 1 },
  });
}

export async function approvePrContent(db, id, reviewedBy) {
  const content = await db.prContent.findUnique({ where: { id } });
  if (!content) throw new HttpError(404, "Không tìm thấy nội dung PR.");
  if (content.status === "ARCHIVED")
    throw new HttpError(409, "Nội dung PR đã lưu trữ, không thể duyệt.");
  if (content.status === "APPROVED") return content; // idempotent
  return db.prContent.update({
    where: { id },
    data: { status: "APPROVED", reviewedBy: reviewedBy || null },
  });
}

// Tạo/claim outbox cho một publication. Khóa duy nhất publicationKey chặn
// tạo PR thứ hai cho cùng publication. Bài phải do hệ thống đăng (có
// PostSchedule) và nội dung PR phải APPROVED đúng thời điểm tạo.
export async function createPrOutbox(db, { publicationKey, postId, scheduleId, pageId = "default", contentId }) {
  if (!publicationKey || typeof publicationKey !== "string" || publicationKey.length > 200)
    throw new HttpError(400, "publicationKey không hợp lệ.");
  let schedule = null;
  if (scheduleId) {
    schedule = await db.postSchedule.findUnique({ where: { id: scheduleId } });
  } else if (postId) {
    schedule = await db.postSchedule.findUnique({ where: { postId } });
  }
  if (!schedule)
    throw new HttpError(400, "Chỉ bài do hệ thống đăng (có lịch đăng) mới được tạo PR.");
  if (schedule.status !== "PUBLISHED" && !schedule.externalPostId)
    throw new HttpError(409, "Bài chưa xác nhận đăng xong; chưa tạo PR.");
  const content = contentId ? await db.prContent.findUnique({ where: { id: contentId } }) : null;
  if (contentId && (!content || content.status !== "APPROVED"))
    throw new HttpError(400, "Nội dung PR phải được duyệt (APPROVED) trước khi tạo outbox.");
  try {
    return await db.prOutbox.create({
      data: {
        publicationKey,
        postId: schedule.postId,
        scheduleId: schedule.id,
        pageId,
        contentId: content ? content.id : null,
        contentSnapshot: content
          ? { contentId: content.id, version: content.version, text: content.text }
          : null,
      },
    });
  } catch (e) {
    if (e.code === "P2002")
      throw new HttpError(409, "Publication này đã có PR; không tạo trùng.");
    throw e;
  }
}
