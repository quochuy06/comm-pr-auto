import prisma from "../prisma.js";
import { createJob, dispatch } from "./workflows.js";
import { crisisTrigger } from "./policy.js";
import { audit } from "../lib/errors.js";
export async function evaluateCrisis(commentId) {
  const job = await prisma.$transaction(async (db) => {
    const comment = await db.comment.findUnique({ where: { id: commentId } });
    if (!comment) return null;
    // Serialize alert creation for a post so simultaneous callbacks do not create duplicate open alerts.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${comment.postId}))::text`;
    const settings = await db.settings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
    const recent = await db.comment.findMany({
      where: {
        postId: comment.postId,
        createdAt: {
          gte: new Date(Date.now() - settings.windowMinutes * 60000),
        },
        OR: [{ sentiment: { in: ["NEGATIVE", "CRISIS"] } }, { risk: "HIGH" }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const trigger = crisisTrigger(
      comment,
      recent.length,
      settings.negativeThreshold,
    );
    if (!trigger) return null;
    const existing = await db.alert.findFirst({
      where: {
        postId: comment.postId,
        status: { notIn: ["RESOLVED", "REJECTED"] },
      },
    });
    if (existing) return null;
    const evidence = [comment, ...recent.filter((c) => c.id !== comment.id)]
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        text: c.text,
        sentiment: c.sentiment,
        risk: c.risk,
      }));
    const alert = await db.alert.create({
      data: { postId: comment.postId, trigger, evidence },
    });
    const job = await createJob(db, "crisis", alert.id);
    await audit(db, "SYSTEM", "CRISIS_DETECTED", alert.id, trigger);
    return job;
  });
  if (job) dispatch(job);
}
