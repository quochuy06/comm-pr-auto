import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { app } from "../src/app.js";
import prisma from "../src/prisma.js";
import { tokenHash } from "../src/lib/security.js";
import { createArtifact } from "../src/services/expansion.js";
import { checkedVariants, reportInput, sourceRevision, reportCsv } from "../src/services/insights.js";
test("Variants enforce distinct platforms and X length; CSV neutralizes formulas",()=>{
  assert.throws(()=>checkedVariants({variants:[]}));
  const variants=['Facebook','LinkedIn','X'].map(platform=>({platform,headline:'h',content:'c'}));
  assert.equal(checkedVariants({variants}).variants.length,3);
  assert.throws(()=>checkedVariants({variants:variants.map(v=>({...v,platform:'X'}))}));
  assert.throws(()=>checkedVariants({variants:variants.map(v=>({...v,content:'a'.repeat(281)}))}));
  assert.match(reportCsv({input:{campaign:{name:'=SUM(1,2)'},period:{from:'a',to:'b'},metrics:{comments:0},definitions:'test'}}), /'=SUM/);
});
test("Artifact API checks roles, duplicate callbacks, source revisions and immutable report metrics",{skip:process.env.RUN_DB_TESTS!=='true'},async()=>{
  const prefix='expansion-'+randomUUID();const ids=[],users=[];
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const review={safe:true,grounded:true,risk:'LOW',reason:'Đã kiểm tra'};
  const cookies={};
  async function req(path,body,role,method='POST') {
    const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(role?{cookie:cookies[role]}:{'x-comm-token':process.env.N8N_CALLBACK_SECRET})},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});return {status:r.status,body:await r.json()};
  }
  try {
    await prisma.campaign.create({data:{id:prefix,name:'Test campaign'}});
    for(const role of ['EDITOR','REVIEWER']) {const u=await prisma.user.create({data:{email:`${role}-${prefix}@test.invalid`,name:prefix,passwordHash:'unused',role}});users.push(u.id);const token=randomUUID();await prisma.session.create({data:{tokenHash:tokenHash(token),userId:u.id,expiresAt:new Date(Date.now()+60000)}});cookies[role]='comm_session='+token;}
    const p=await prisma.post.create({data:{campaignId:prefix,topic:prefix,headline:'Approved source',content:'Source body',status:'APPROVED',approvedBy:'test',bannerUrl:'https://example.invalid/test.jpg'}});ids.push(p.id);
    const from=new Date(Date.now()-86400000).toISOString(),to=new Date(Date.now()+1000).toISOString();
    const input=await reportInput(prefix,from,to);assert.equal(input.metrics.createdPosts,1);assert.equal(input.metrics.negativeRate,null);assert.equal(input.metrics.publishedPosts,0);
    const variants=['Facebook','LinkedIn','X'].map(platform=>({platform,headline:'Variant',content:'Same facts'}));
    for(const kind of ['planning','repurpose','report']) {
      const context=kind==='report'?input:kind==='repurpose'?{sourceRevision:sourceRevision(p)}:{count:1};
      const {artifact:a,job}=await prisma.$transaction(db=>createArtifact(db,kind,context,{campaignId:prefix,...(kind==='repurpose'?{sourcePostId:p.id}:{})}));ids.push(a.id);
      const result=kind==='planning'?{summary:'Plan',items:[{topic:'Topic',targetAudience:'Students',tone:'Friendly',contentKind:'VIDEO',platform:'Facebook',suggestedDate:'Next week',rationale:'Campaign relevance'}],groundedSources:[{id:'kv-test',version:2}],knowledgeStatus:'INSUFFICIENT'}:kind==='repurpose'?{variants}:{summary:'No analyzed comments',recommendations:['Collect feedback'],metrics:{comments:99999}};
      const payload={jobId:job.id,entityId:a.id,ok:true,result:{...result,review}};
      const callbacks=await Promise.all([req(`/workflow-internal/callback/${kind}`,payload),req(`/workflow-internal/callback/${kind}`,payload)]);
      assert.ok(callbacks.every(x=>x.status===200));assert.equal(callbacks.filter(x=>x.body.ignored===false).length,1);
      // HUY-WF01: artifact luôn chờ duyệt (không bao giờ tự duyệt) và giữ truy vết tri thức.
      const pending=await prisma.workflowArtifact.findUnique({where:{id:a.id}});assert.equal(pending.status,'PENDING_APPROVAL');
      if(kind==='planning'){assert.equal(pending.result.requiresHuman,true);assert.equal(pending.result.items[0].contentKind,'VIDEO');assert.deepEqual(pending.result.groundedSources,[{id:'kv-test',version:2}]);assert.equal(pending.result.knowledgeStatus,'INSUFFICIENT');}
      assert.equal((await req(`/artifacts/${a.id}/approve`,{},'EDITOR','PATCH')).status,403);
      assert.equal((await req(`/artifacts/${a.id}/approve`,{},'REVIEWER','PATCH')).status,200);
      const saved=await prisma.workflowArtifact.findUnique({where:{id:a.id}});assert.equal(saved.status,'APPROVED');
      if(kind==='report'){assert.equal(saved.input.metrics.comments,0);assert.equal(saved.result.metrics,undefined);}
      if(kind==='repurpose') {
        const materialized=await Promise.all([req(`/artifacts/${a.id}/variants/0`,{},'EDITOR'),req(`/artifacts/${a.id}/variants/0`,{},'EDITOR')]);
        assert.ok(materialized.every(r=>r.status===200));assert.equal(materialized[0].body.data.id,materialized[1].body.data.id);assert.equal(materialized[0].body.data.status,'PENDING_APPROVAL');ids.push(materialized[0].body.data.id);
        await prisma.post.update({where:{id:p.id},data:{content:'Changed source'}});
        assert.equal((await req(`/artifacts/${a.id}/variants/1`,{},'EDITOR')).status,409);
      }
    }
    const {artifact:a,job}=await prisma.$transaction(db=>createArtifact(db,'planning',{count:1},{campaignId:prefix}));ids.push(a.id);
    assert.equal((await req('/workflow-internal/callback/planning',{jobId:job.id,entityId:a.id,ok:true,result:{summary:'Bad',items:[],review}})).status,400);
    assert.equal((await prisma.workflowArtifact.findUnique({where:{id:a.id}})).status,'FAILED');
    // HUY-WF01: contentKind mặc định POST khi thiếu; callback rác bị từ chối và artifact FAILED.
    const idea={topic:'Topic',targetAudience:'Students',tone:'Friendly',platform:'Facebook',suggestedDate:'Next week',rationale:'Campaign relevance'};
    {const {artifact:a,job}=await prisma.$transaction(db=>createArtifact(db,'planning',{count:1},{campaignId:prefix}));ids.push(a.id);
      const r=await req('/workflow-internal/callback/planning',{jobId:job.id,entityId:a.id,ok:true,result:{summary:'Defaults',items:[idea],review}});
      assert.equal(r.status,200);const saved=await prisma.workflowArtifact.findUnique({where:{id:a.id}});
      assert.equal(saved.status,'PENDING_APPROVAL');assert.equal(saved.result.items[0].contentKind,'POST');assert.equal(saved.result.groundedSources,undefined);}
    for(const bad of [{summary:'Bad kind',items:[{...idea,contentKind:'GIF'}]},{summary:'Bad sources',items:[idea],groundedSources:[{id:'kv-1'}]},{summary:'Bad knowledge status',items:[idea],knowledgeStatus:'MAYBE'}]){
      const {artifact:a,job}=await prisma.$transaction(db=>createArtifact(db,'planning',{count:1},{campaignId:prefix}));ids.push(a.id);
      assert.equal((await req('/workflow-internal/callback/planning',{jobId:job.id,entityId:a.id,ok:true,result:{...bad,review}})).status,400);
      assert.equal((await prisma.workflowArtifact.findUnique({where:{id:a.id}})).status,'FAILED');
    }
    assert.equal((await req('/workflow-internal/due',{},'EDITOR','GET')).status,401);
  } finally {
    await new Promise(r=>server.close(r));await prisma.auditLog.deleteMany({where:{entityId:{in:ids}}});await prisma.workflowJob.deleteMany({where:{entityId:{in:ids}}});await prisma.workflowArtifact.deleteMany({where:{campaignId:prefix}});await prisma.post.deleteMany({where:{campaignId:prefix}});await prisma.campaign.deleteMany({where:{id:prefix}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
  }
});

test("Planning request dispatches the configured knowledge Page and waits for review", {
  skip: process.env.RUN_DB_TESTS !== "true",
}, async (t) => {
  const campaignId = `planning-${randomUUID()}`;
  let userId, artifactId;
  const appServer = app.listen(0, "127.0.0.1");
  await once(appServer, "listening");
  const base = `http://127.0.0.1:${appServer.address().port}/api`;
  const n8n = createServer();
  n8n.listen(0, "127.0.0.1");
  await once(n8n, "listening");
  const env = {
    N8N_BASE_URL: `http://127.0.0.1:${n8n.address().port}`,
    FACEBOOK_PAGE_ID: "12345670001", FACEBOOK_PAGE_ACCESS_TOKEN: "test-page-only",
    FACEBOOK_GRAPH_API_VERSION: "v99.0",
  };
  const oldEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async () => {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    n8n.closeAllConnections();
    await Promise.all([n8n, appServer].map(s => new Promise(resolve => s.close(resolve))));
    if (artifactId) {
      await prisma.auditLog.deleteMany({ where: { entityId: artifactId } });
      await prisma.workflowJob.deleteMany({ where: { entityId: artifactId } });
      await prisma.workflowArtifact.deleteMany({ where: { id: artifactId } });
    }
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  await prisma.campaign.create({ data: { id: campaignId, name: "Ngày hội rang cà phê" } });
  const user = await prisma.user.create({ data: {
    email: `${campaignId}@test.invalid`, name: campaignId, passwordHash: "unused", role: "EDITOR",
  } });
  userId = user.id;
  const session = randomUUID();
  await prisma.session.create({ data: {
    tokenHash: tokenHash(session), userId, expiresAt: new Date(Date.now() + 60000),
  } });
  const inbound = once(n8n, "request", { signal: AbortSignal.timeout(10000) });
  const created = await fetch(`${base}/campaigns/${campaignId}/plan`, {
    method: "POST", headers: { "content-type": "application/json", cookie: `comm_session=${session}` },
    body: JSON.stringify({ brief: "Quy trình rang", count: 1, pageId: "untrusted" }),
  });
  assert.equal(created.status, 201);
  artifactId = (await created.json()).data.id;
  const [request, response] = await inbound;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks));
  assert.equal(request.url, "/webhook/plan-campaign");
  assert.equal(payload.entityId, artifactId);
  assert.equal(payload.context.pageId, env.FACEBOOK_PAGE_ID);
  assert.equal(payload.context.brief, "Quy trình rang");
  const finalized = await fetch(`${base}/workflow-internal/callback/planning`, {
    method: "POST", headers: { "x-comm-token": process.env.N8N_CALLBACK_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      jobId: payload.jobId, entityId: artifactId, ok: true,
      result: {
        summary: "Kế hoạch hội rang", knowledgeStatus: "INSUFFICIENT", groundedSources: [],
        items: [{ topic: "Quy trình rang", targetAudience: "Khách", tone: "Thân thiện", platform: "Facebook", contentKind: "VIDEO", suggestedDate: "Tuần tới", rationale: "Hợp brief" }],
        review: { safe: true, grounded: false, risk: "LOW", reason: "Chờ đối chiếu dữ kiện" },
      },
    }),
  });
  assert.equal(finalized.status, 200);
  assert.equal((await finalized.json()).ignored, false);
  response.end("{}");
  const saved = await prisma.workflowArtifact.findUniqueOrThrow({ where: { id: artifactId } });
  assert.equal(saved.status, "PENDING_APPROVAL");
  assert.equal(saved.result.requiresHuman, true);
  assert.equal(saved.result.items[0].contentKind, "VIDEO");
  assert.equal(await prisma.post.count({ where: { campaignId } }), 0);
});
