import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/prisma.js";
import {
  getPrConfig,
  updatePrConfig,
  createPrContent,
  approvePrContent,
  createPrOutbox,
} from "../src/services/pr.js";

const skip = process.env.RUN_DB_TESTS !== "true";

test("PR config: mặc định OFF, CAS version, mode hợp lệ", { skip }, async () => {
  // Singleton "default": bắt đầu và kết thúc ở trạng thái không row = OFF.
  await db.prConfig.deleteMany({ where: { id: "default" } });
  try {
    assert.equal((await getPrConfig(db)).mode, "OFF");
    await assert.rejects(
      updatePrConfig(db, { mode: "AUTO", version: 2 }),
      (e) => e.status === 409, // chưa có row, chỉ chấp nhận version 1
    );
    await assert.rejects(
      updatePrConfig(db, { mode: "TỰ ĐỘNG", version: 1 }),
      (e) => e.status === 400,
    );
    const first = await updatePrConfig(db, { mode: "SEMI_AUTO", version: 1 });
    assert.equal(first.mode, "SEMI_AUTO");
    assert.equal(first.version, 1); // tạo mới giữ version 1
    const second = await updatePrConfig(db, { mode: "AUTO", version: 1 });
    assert.equal(second.mode, "AUTO");
    assert.equal(second.version, 2); // cập nhật tăng version
    // CAS: dùng version cũ là 409
    await assert.rejects(
      updatePrConfig(db, { mode: "OFF", version: 1 }),
      (e) => e.status === 409,
    );
  } finally {
    await db.prConfig.deleteMany({ where: { id: "default" } });
    await db.$disconnect();
  }
});

test("PR content + outbox: duyệt idempotent, chỉ bài hệ thống đăng, khóa publication duy nhất", { skip }, async () => {
  const postId = randomUUID();
  const scheduleId = randomUUID();
  let draftPostId;
  let manualPostId;
  const keys = [];
  try {
    // Chuẩn bị: bài + lịch đăng hệ thống
    await db.post.create({
      data: { id: postId, topic: "PR test", content: "nội dung", status: "PUBLISHED" },
    });
    await db.postSchedule.create({
      data: { id: scheduleId, postId, scheduledAt: new Date(), contentHash: "h1", status: "PUBLISHED", externalPostId: "ext-" + postId },
    });

    const content = await createPrContent(db, { text: "Chúng tôi vừa ra mắt sản phẩm mới!", createdBy: "test" });
    await assert.rejects(
      createPrOutbox(db, { publicationKey: "post:" + postId, postId, contentId: content.id }),
      (e) => e.status === 400, // content chưa APPROVED
    );
    const approved = await approvePrContent(db, content.id, "reviewer");
    assert.equal(approved.status, "APPROVED");
    assert.equal((await approvePrContent(db, content.id, "reviewer2")).reviewedBy, "reviewer"); // idempotent

    const outbox = await createPrOutbox(db, {
      publicationKey: "post:" + postId, postId, contentId: content.id,
    });
    keys.push(outbox.publicationKey);
    assert.equal(outbox.status, "PENDING");
    assert.equal(outbox.contentSnapshot.text, "Chúng tôi vừa ra mắt sản phẩm mới!");
    assert.equal(outbox.postId, postId);

    // Khóa duy nhất: cùng publication không tạo PR thứ hai
    await assert.rejects(
      createPrOutbox(db, { publicationKey: "post:" + postId, postId, contentId: content.id }),
      (e) => e.status === 409,
    );

    // Bài CHƯA đăng xong (không externalPostId) -> 409
    draftPostId = randomUUID();
    await db.post.create({ data: { id: draftPostId, topic: "chưa đăng", status: "APPROVED" } });
    await db.postSchedule.create({
      data: { id: randomUUID(), postId: draftPostId, scheduledAt: new Date(), contentHash: "h2", status: "PENDING" },
    });
    await assert.rejects(
      createPrOutbox(db, { publicationKey: "post:" + draftPostId, postId: draftPostId }),
      (e) => e.status === 409,
    );

    // Bài không có lịch đăng (không do hệ thống đăng) -> 400
    manualPostId = randomUUID();
    await db.post.create({ data: { id: manualPostId, topic: "thủ công", status: "PUBLISHED" } });
    await assert.rejects(
      createPrOutbox(db, { publicationKey: "post:" + manualPostId, postId: manualPostId }),
      (e) => e.status === 400,
    );
  } finally {
    await db.prOutbox.deleteMany({ where: { publicationKey: { in: keys } } });
    const postIds = [postId, draftPostId, manualPostId].filter(Boolean);
    await db.postSchedule.deleteMany({ where: { postId: { in: postIds } } });
    await db.post.deleteMany({ where: { id: { in: postIds } } });
    await db.prContent.deleteMany({ where: { text: "Chúng tôi vừa ra mắt sản phẩm mới!" } });
    await db.$disconnect();
  }
});
