import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/prisma.js";
import { channelModes, updateChannelMode, currentAdviceConfig } from "../src/services/automationMode.js";
import { app } from "../src/app.js";
import { tokenHash } from "../src/lib/security.js";
import { once } from "node:events";

test("Advice channel persistence, CAS, role protection and stale claim guard", {skip:process.env.RUN_DB_TESTS !== "true"}, async () => {
  const pageId = String(Date.now()), actor = `${pageId}@test.invalid`, users=[];
  const previous = process.env.FACEBOOK_PAGE_ID;
  const oldToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const oldVersion = process.env.FACEBOOK_GRAPH_API_VERSION;
  process.env.FACEBOOK_PAGE_ID = pageId;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test-only";
  process.env.FACEBOOK_GRAPH_API_VERSION = "v23.0";
  let server;
  try {
    const baseline = await db.facebookAutomation.findMany();
    const initial = await channelModes(db,pageId);
    assert.ok(initial.channels.every(c=>c.mode === "OFF" && c.version === 0));
    const row = await updateChannelMode(db,pageId,"COMMENT",{mode:"AUTO",expectedVersion:0},actor);
    const snapshot={pageId,channel:"COMMENT",mode:"AUTO",configVersion:row.version};
    assert.equal((await currentAdviceConfig(db,snapshot)).mode,"AUTO");
    const race=await Promise.allSettled(["OFF","SEMI_AUTO"].map(mode=> updateChannelMode(db,pageId,"COMMENT",{mode,expectedVersion:1},actor)));
    assert.equal(race.filter(r=>r.status === "fulfilled").length,1);
    assert.equal(race.find(r=>r.status === "rejected").reason.status,409);
    await assert.rejects(currentAdviceConfig(db,snapshot),e=>e.status === 409);
    await assert.rejects(updateChannelMode(db,pageId,"COMMENT",{mode:"AUTO",expectedVersion:2, greeting:"changed"},actor),e=>e.status === 400);
    assert.equal((await channelModes(db,pageId)).channels.find(c=>c.channel === "MESSENGER").mode,"OFF");
    assert.deepEqual(await db.facebookAutomation.findMany(),baseline);
    server=app.listen(0,"127.0.0.1"); await once(server,"listening");
    for (const role of ["ADMIN","EDITOR","REVIEWER"]) {
      const token=randomUUID();
      const user=await db.user.create({data:{email:`${role}-${actor}`,name:role,role,passwordHash:"unused",sessions:{create:{tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+60000)}}}});
      users.push(user.id);
      const res=await fetch(`http://127.0.0.1:${server.address().port}/api/automation/channels/MESSENGER`,{method:"PATCH",headers:{"Content-Type":"application/json",Cookie:`comm_session=${token}`},body:JSON.stringify({mode:"SEMI_AUTO",expectedVersion:0})});
      assert.equal(res.status,role === "ADMIN" ? 200 : 403);
    }
    assert.equal(await db.auditLog.count({where:{actor}}),2);
  } finally {
    if(server) await new Promise(r=>server.close(r));
    const rows=await db.automationChannel.findMany({where:{pageId}});
    await db.auditLog.deleteMany({where:{entityId:{in:rows.map(r=>r.id)}}});
    await db.automationChannel.deleteMany({where:{pageId}});
    await db.user.deleteMany({where:{id:{in:users}}});
    for (const [key,value] of Object.entries({FACEBOOK_PAGE_ID:previous,FACEBOOK_PAGE_ACCESS_TOKEN:oldToken,FACEBOOK_GRAPH_API_VERSION:oldVersion})) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
    await db.$disconnect();
  }
});
