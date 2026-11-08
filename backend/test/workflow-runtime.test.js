import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { app } from "../src/app.js";
import { recoverJobs } from "../src/services/workflows.js";
import db from "../src/prisma.js";
import { createContractJob, claimContractJob, renewContractLease, finalizeContractJob, dispatchContractCheck } from "../src/services/workflowRuntime.js";
test("Contract runtime: durable lease, provider recovery, callback CAS/replay, dispatch",{skip:process.env.RUN_DB_TESTS!=="true"},async()=> {
  const ids=[]; let server, apiServer;
  const previousSecret=process.env.N8N_CALLBACK_SECRET;
  process.env.N8N_CALLBACK_SECRET="test-internal-secret";
  const create=async()=>{const job=await createContractJob(db,{contractVersion:1,kind:"knowledge.check",pageId:"123",entityId:"123",correlationId:randomUUID(),versions:{input:1,config:1,content:1},context:{}});ids.push(job.id);return job;};
  const callback=e=>({...e,status:"SUCCEEDED",result:{contractAccepted:true},sources:[]});
  try {
    const job=await create();
    const race=await Promise.allSettled(["one","two"].map(owner=>claimContractJob(db,job.id,owner)));
    assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
    const {envelope,attempt}=race.find(r=>r.status==="fulfilled").value;
    await renewContractLease(db,job.id,attempt.id,attempt.leaseOwner,"provider-123");
    await assert.rejects(renewContractLease(db,job.id,attempt.id,"other","provider-123"),e=>e.status===409);
    await db.workflowAttempt.update({where:{id:attempt.id},data:{leaseUntil:new Date(Date.now()-1000)}});
    await assert.rejects(finalizeContractJob(db,callback(envelope)),e=>e.status===409);
    await recoverJobs();
    assert.equal((await db.workflowJob.findUnique({where:{id:job.id}})).status,"RUNNING");
    await db.$disconnect();
    const recovered=await claimContractJob(db,job.id,"restarted");
    assert.equal(recovered.recovery,true); assert.equal(recovered.attempt.id,attempt.id);
    assert.equal(recovered.attempt.providerJobId,"provider-123");
    for(const patch of [{pageId:"999"},{entityId:"999"},{attemptId:randomUUID()},{versions:{input:2,config:1,content:1}}])
      await assert.rejects(finalizeContractJob(db,{...callback(envelope),...patch}),e=>[400,409].includes(e.status));
    apiServer=app.listen(0,"127.0.0.1");await once(apiServer,"listening");
    const url=`http://127.0.0.1:${apiServer.address().port}/api/webhooks/contract-v1`;
    assert.equal((await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(callback(envelope))})).status,401);
    assert.equal((await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-comm-token":"test-internal-secret"},body:JSON.stringify(callback(envelope))})).status,200);
    const receipts=await Promise.all([1,2].map(()=>finalizeContractJob(db,callback(envelope))));
    assert.deepEqual(receipts[0],receipts[1]);
    assert.equal((await db.workflowJob.findUnique({where:{id:job.id}})).status,"SUCCEEDED");
    await assert.rejects(claimContractJob(db,job.id,"new"),e=>e.status===409);
    server=createServer(async(req,res)=>{let body="";for await(const part of req)body+=part;assert.equal(req.headers["x-comm-token"],"test-secret");res.setHeader("Content-Type","application/json");res.end(JSON.stringify(callback(JSON.parse(body))));});
    server.listen(0,"127.0.0.1");await once(server,"listening");
    const second=await create();
    assert.equal((await dispatchContractCheck(db,second.id,`http://127.0.0.1:${server.address().port}`,"test-secret")).status,"SUCCEEDED");
  } finally {
    if(apiServer)await new Promise(r=>apiServer.close(r));
    if(previousSecret===undefined)delete process.env.N8N_CALLBACK_SECRET;else process.env.N8N_CALLBACK_SECRET=previousSecret;
    if(server)await new Promise(r=>server.close(r));
    await db.workflowJob.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
  }
});
