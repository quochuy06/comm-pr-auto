import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
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
      const result=kind==='planning'?{summary:'Plan',items:[{topic:'Topic',targetAudience:'Students',tone:'Friendly',platform:'Facebook',suggestedDate:'Next week',rationale:'Campaign relevance'}]}:kind==='repurpose'?{variants}:{summary:'No analyzed comments',recommendations:['Collect feedback'],metrics:{comments:99999}};
      const payload={jobId:job.id,entityId:a.id,ok:true,result:{...result,review}};
      const callbacks=await Promise.all([req(`/workflow-internal/callback/${kind}`,payload),req(`/workflow-internal/callback/${kind}`,payload)]);
      assert.ok(callbacks.every(x=>x.status===200));assert.equal(callbacks.filter(x=>x.body.ignored===false).length,1);
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
    assert.equal((await req('/workflow-internal/due',{},'EDITOR','GET')).status,401);
  } finally {
    await new Promise(r=>server.close(r));await prisma.auditLog.deleteMany({where:{entityId:{in:ids}}});await prisma.workflowJob.deleteMany({where:{entityId:{in:ids}}});await prisma.workflowArtifact.deleteMany({where:{campaignId:prefix}});await prisma.post.deleteMany({where:{campaignId:prefix}});await prisma.campaign.deleteMany({where:{id:prefix}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
  }
});
