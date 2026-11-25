import { Prisma } from "@prisma/client";
import { HttpError, choice, text } from "../lib/errors.js";
import { knowledgeScope } from "./knowledge.js";

const statuses = ["SUFFICIENT", "INSUFFICIENT", "CONFLICT"];

export function contentSources(result) {
  const knowledgeStatus = choice(result.knowledgeStatus ?? "INSUFFICIENT", statuses, "Trạng thái tri thức");
  const sources = result.groundedSources ?? [];
  if (!Array.isArray(sources) || sources.length > 5)
    throw new HttpError(400, "Danh sách nguồn trích dẫn không hợp lệ.");
  const groundedSources = sources.map((source) => {
    if (!Number.isSafeInteger(source?.version) || source.version < 1)
      throw new HttpError(400, "Phiên bản nguồn trích dẫn không hợp lệ.");
    return { id: text(source.id, "ID nguồn", 200), version: source.version };
  });
  if (new Set(groundedSources.map(source => source.id)).size !== groundedSources.length)
    throw new HttpError(400, "Nguồn trích dẫn bị trùng.");
  return { knowledgeStatus, groundedSources };
}

// Hold shared locks on the cited documents until the post update commits.
// Version transitions lock the same rows, so checking the active versions and
// persisting the approval cannot race with archiving or replacing a source.
export async function verifyContentSources(db, review) {
  if (!review.grounded) return review;
  const sources = review.groundedSources;
  const eligible = review.knowledgeStatus === "SUFFICIENT" && sources.length > 0;
  if (eligible) {
    const valid = await db.$queryRaw`
      SELECT version.id, version.version
      FROM "KnowledgeDocument" AS doc
      JOIN "KnowledgeVersion" AS version
        ON version.id = doc."activeVersionId" AND version."documentId" = doc.id
      WHERE doc."pageId" = ${knowledgeScope()}
        AND doc."archivedAt" IS NULL
        AND version.status = 'APPROVED'
        AND version.id IN (${Prisma.join(sources.map(source => source.id))})
      ORDER BY doc.id
      FOR SHARE OF doc
    `;
    if (sources.every(source => valid.some(version => version.id === source.id && version.version === source.version)))
      return review;
  }
  const reason = eligible ? "Nguồn trích dẫn không còn hoạt động hoặc không thuộc Page đang dùng."
    : "Chưa có đủ nguồn tri thức đã duyệt.";
  return { ...review, grounded: false, reason: (reason + " " + review.reason).slice(0, 5000) };
}
