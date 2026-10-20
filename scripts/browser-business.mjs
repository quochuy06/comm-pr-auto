import { chromium } from "../.local/browser-tools/node_modules/playwright/index.mjs";
import { PrismaClient } from "../backend/node_modules/@prisma/client/default.js";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../backend/package.json", import.meta.url),
);
const dotenv = require("dotenv");
import fs from "node:fs";
import { randomUUID } from "node:crypto";
dotenv.config({ path: "backend/.env", quiet: true });
fs.mkdirSync(".local/final-demo-audit", { recursive: true });
const db = new PrismaClient(),
  tag = "[TEST UI " + randomUUID() + "]";
const ids = [];
let browser, campaign;
try {
  campaign = await db.campaign.create({
    data: {
      name: tag,
      description:
        "Fixture tự động kiểm tra giao diện, không phải nội dung AI; xóa sau kiểm tra.",
    },
  });
  const p = await db.post.create({
    data: {
      campaignId: campaign.id,
      topic: tag,
      headline: tag,
      content: "Bài fixture kiểm tra duyệt thủ công.",
      status: "PENDING_APPROVAL",
      bannerUrl: "/media/80191d05-f6ec-4c01-822f-7f13e1279788.jpg",
      imageStatus: "VERIFIED",
      imageReviewStatus: "NOT_REVIEWED",
    },
  });
  ids.push(p.id);
  const c = await db.comment.create({
    data: {
      postId: p.id,
      author: tag,
      text: "Bình luận fixture cần phản hồi.",
      analysisStatus: "DONE",
      sentiment: "NEGATIVE",
      risk: "MEDIUM",
      suggestedReply: "Cảm ơn bạn, nhóm sẽ xác minh phản ánh.",
      replyStatus: "PENDING",
    },
  });
  ids.push(c.id);
  const a = await db.alert.create({
    data: {
      postId: p.id,
      status: "PENDING_APPROVAL",
      trigger: "Tình huống fixture kiểm thử giao diện",
      evidence: [
        { id: c.id, text: c.text, sentiment: "NEGATIVE", risk: "MEDIUM" },
      ],
      summary: "Bản nháp fixture",
      statement: "[TEST UI] Chúng tôi đã tiếp nhận phản ánh và sẽ xác minh.",
      actions: ["Xác minh phản ánh"],
    },
  });
  ids.push(a.id);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const accounts = JSON.parse(fs.readFileSync(".local/demo-accounts.json"));
  const reviewer = accounts.find((x) => x.role === "REVIEWER");
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("Email", { exact: true }).fill(reviewer.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(reviewer.password);
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await page.getByRole("heading", { name: "Tổng quan truyền thông" }).waitFor();
  await page.goto("http://localhost:3000/approval");
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: tag, exact: true }) });
  await card.getByRole("button", { name: "Duyệt bài để lên lịch" }).click();
  await card.waitFor({ state: "detached" });
  let saved = await db.post.findUnique({ where: { id: p.id } });
  if (saved.status !== "APPROVED" || saved.imageReviewStatus !== "MANUAL")
    throw Error("Manual approval failed");
  // Approval no longer publishes. Explicitly schedule this isolated fixture.
  const scheduled = await page.request.post(`http://localhost:3000/api/posts/${p.id}/schedule`, { data: { scheduledAt: new Date().toISOString() } });
  if (!scheduled.ok()) throw Error("Scheduling failed");
  const schedule = (await scheduled.json()).data;
  const publication = await fetch("http://localhost:5000/api/workflow-internal/publish", {
    method: "POST", headers: { "Content-Type": "application/json", "x-comm-token": process.env.N8N_CALLBACK_SECRET },
    body: JSON.stringify({ id: schedule.id, expectedUpdatedAt: schedule.updatedAt }),
  });
  if (!publication.ok || (await publication.json()).status !== "PUBLISHED") throw Error("Publication failed");
  await page.getByRole("button", { name: /Phản hồi bình luận/ }).click();
  const commentCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: tag, exact: true }) });
  await commentCard
    .getByRole("button", { name: "Duyệt phản hồi", exact: true })
    .click();
  await commentCard.waitFor({ state: "detached" });
  await page.goto("http://localhost:3000/simulator");
  const feed = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: tag, exact: true }) });
  await feed
    .getByText("Cảm ơn bạn, nhóm sẽ xác minh phản ánh.", { exact: true })
    .waitFor();
  if (await feed.getByText("Phản hồi chính thức", { exact: false }).count())
    throw Error("Crisis published before approval");
  await feed.getByRole("button", { name: "Ẩn bình luận", exact: true }).click();
  await feed
    .getByText("Bình luận đã được ẩn bởi người kiểm duyệt.", { exact: true })
    .waitFor();
  await feed
    .getByRole("button", { name: "Hiện lại bình luận", exact: true })
    .click();
  await feed
    .getByRole("button", { name: "Ẩn bình luận", exact: true })
    .waitFor();
  await page.goto("http://localhost:3000/alerts");
  const alertCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: tag, exact: true }) });
  await alertCard
    .getByRole("button", { name: "Duyệt và đăng phản hồi trên feed" })
    .click();
  await alertCard.getByText("Đã duyệt", { exact: true }).waitFor();
  await page.goto("http://localhost:3000/simulator");
  await feed
    .getByText("Phản hồi chính thức · Đã được người duyệt kiểm tra", {
      exact: true,
    })
    .waitFor();
  await page.reload();
  await feed
    .getByText("Cảm ơn bạn, nhóm sẽ xác minh phản ánh.", { exact: true })
    .waitFor();
  saved = await db.alert.findUnique({ where: { id: a.id } });
  if (!saved.publishedAt || saved.status !== "APPROVED")
    throw Error("Crisis human approval did not persist");
  await page.screenshot({
    path: ".local/final-demo-audit/reviewer-business.png",
    fullPage: true,
  });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: reviewer approves article/reply; feed persists; hide/unhide comment; crisis invisible before human approval and visible after. Fixture data only, cleaned afterwards.",
  );
} finally {
  if (browser) await browser.close();
  await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  if (campaign) {
    await db.post.deleteMany({ where: { campaignId: campaign.id } });
    await db.campaign.delete({ where: { id: campaign.id } });
  }
  await db.$disconnect();
}
