import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/prisma.js";
import { publicationHash, publishSchedule, checkedPlan } from "../src/services/expansion.js";
test("Plan validation rejects missing items and invalid platforms", () => {
  assert.throws(()=>checkedPlan({ items: [], summary: "x" }));
  assert.throws(()=>checkedPlan({ summary: "x", items: [{ topic: "x", platform: "unknown" }] }));
});
test("Scheduled publication is atomic, idempotent, revision-bound and never posts unapproved content", { skip: process.env.RUN_DB_TESTS !== "true" }, async () => {
  const ids = [];
  async function fixture(status="APPROVED", minutes=1) {
    const p=await prisma.post.create({data:{topic:"schedule-test",headline:"Test",content:"Test body",bannerUrl:"https://example.invalid/test.png",approvedBy:"test-reviewer",status}});ids.push(p.id);
    return prisma.postSchedule.create({data:{postId:p.id,contentHash:publicationHash(p),scheduledAt:new Date(Date.now()-minutes*60000)}});
  }
  const publish=s=>prisma.$transaction(db=>publishSchedule(db,s.id,s.updatedAt.toISOString()));
  try {
    const s=await fixture();
    const result=await Promise.all([publish(s),publish(s)]);
    assert.deepEqual(result.map(x=>x.status).sort(),["IGNORED","PUBLISHED"]);
    assert.equal(await prisma.auditLog.count({where:{entityId:s.postId,action:"POST_PUBLISHED"}}),1);
    const p=await prisma.post.findUnique({where:{id:s.postId}});assert.equal(p.status,"PUBLISHED");assert.ok(p.publishedAt);
    const stale=await fixture();await prisma.post.update({where:{id:stale.postId},data:{content:"Changed after approval"}});assert.equal((await publish(stale)).status,"FAILED");
    const pending=await fixture("PENDING_APPROVAL");assert.equal((await publish(pending)).status,"FAILED");
    const expired=await fixture("APPROVED",1500);assert.equal((await publish(expired)).status,"FAILED");
    const cancelled=await fixture();await prisma.postSchedule.update({where:{id:cancelled.id},data:{status:"CANCELLED"}});assert.equal((await publish(cancelled)).status,"IGNORED");
    const future=await fixture("APPROVED",-60);assert.equal((await publish(future)).status,"NOT_DUE");
    const revised=await fixture();assert.equal((await prisma.$transaction(db=>publishSchedule(db,revised.id,new Date(0).toISOString()))).status,"IGNORED");
  } finally { await prisma.auditLog.deleteMany({where:{entityId:{in:ids}}});await prisma.post.deleteMany({where:{id:{in:ids}}});await prisma.$disconnect(); }
});
