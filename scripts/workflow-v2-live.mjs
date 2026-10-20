// Opt-in real integration check. Uses only its own tagged fixtures and cleans them.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(new URL('../backend/package.json',import.meta.url));
require('dotenv').config({path:'backend/.env',quiet:true});
const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
if(process.env.LIVE_AI!=='true')throw Error('Set LIVE_AI=true to explicitly call configured AI/image services.');
const tag='WF-V2-TEST-'+randomUUID(),ids=[],results=[];let cookie,campaign;
async function api(path,method='GET',body) {
  const r=await fetch('http://localhost:5000/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(path+': '+r.status+' '+value.message);return value.data;
}
async function wait(entityId,kind,seconds=300) {
  const end=Date.now()+seconds*1000;let last='';
  while(Date.now()<end){
    const jobs=await db.workflowJob.findMany({where:{entityId,kind},orderBy:{createdAt:'desc'}});const job=jobs[0];
    if(job&&last!==job.id+job.status){console.log(kind,job.mode,job.status);last=job.id+job.status;}
    if(job&&!['QUEUED','RUNNING'].includes(job.status)) {
      // Text success creates its image job transactionally. Read the current post job.
      if(kind==='content'){const p=await db.post.findUnique({where:{id:entityId}});if(p?.latestJobId!==job.id){await new Promise(r=>setTimeout(r,500));continue;}}
      const result={kind,status:job.status,error:job.error};results.push(result);return result;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  const result={kind,status:'TIMEOUT'};results.push(result);return result;
}
try {
  const account=JSON.parse(fs.readFileSync('.local/demo-accounts.json')).find(a=>a.role==='ADMIN');
  const login=await fetch('http://localhost:5000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});if(!login.ok)throw Error('Login failed');cookie=login.headers.get('set-cookie').split(';')[0];
  campaign=await api('/campaigns','POST',{name:tag,description:'Chiến dịch kiểm thử: khuyến khích sinh viên đọc sách. Không có ưu đãi hoặc lịch sự kiện thực tế.'});ids.push(campaign.id);
  const source=await db.post.create({data:{campaignId:campaign.id,topic:tag,headline:'Cùng đọc sách mỗi ngày',content:'Dành thời gian đọc sách mỗi ngày là một gợi ý để khám phá kiến thức. Hãy chọn cuốn sách bạn yêu thích và chia sẻ cảm nhận với bạn bè.',status:'APPROVED',approvedBy:'TEST_FIXTURE',bannerUrl:'https://example.invalid/fixture.jpg',imageStatus:'MANUAL',imagePrompt:'An open book on a wooden desk'}});ids.push(source.id);
  const schedule=await api(`/posts/${source.id}/schedule`,'POST',{scheduledAt:new Date().toISOString()});ids.push(schedule.id);
  const tick=await fetch('http://localhost:5678/webhook/publish-due',{method:'POST',headers:{'x-comm-token':process.env.N8N_CALLBACK_SECRET,'content-type':'application/json'},body:'{}'});
  if(!tick.ok)throw Error('Publisher webhook '+tick.status);
  for(let i=0;i<40;i++){if((await db.post.findUnique({where:{id:source.id}})).status==='PUBLISHED')break;await new Promise(r=>setTimeout(r,500));}
  const published=(await db.post.findUnique({where:{id:source.id}})).status==='PUBLISHED';results.push({kind:'publishing',status:published?'SUCCEEDED':'FAILED'});console.log('publishing',published?'SUCCEEDED':'FAILED');
  const plan=await api(`/campaigns/${campaign.id}/plan`,'POST',{brief:'Đề xuất 2 ý tưởng khuyến khích sinh viên đọc sách trong tuần tới, không bịa sự kiện hay số liệu.',count:2});ids.push(plan.id);await wait(plan.id,'planning');
  const repurpose=await api(`/posts/${source.id}/repurpose`,'POST');ids.push(repurpose.id);await wait(repurpose.id,'repurpose');
  const report=await api(`/campaigns/${campaign.id}/report`,'POST',{from:new Date(Date.now()-86400000).toISOString(),to:new Date().toISOString()});ids.push(report.id);await wait(report.id,'report');
  if(published){const c=await api(`/posts/${source.id}/comments`,'POST',{text:'Cảm ơn nhóm đã chia sẻ gợi ý đọc sách hữu ích!'});ids.push(c.id);await wait(c.id,'community');
    const a=await db.alert.create({data:{postId:source.id,trigger:'Tình huống mô phỏng để kiểm thử quy trình xác minh',evidence:[{id:c.id,text:'Phản ánh mô phỏng: thông tin trong bài có thể bị hiểu nhầm, đề nghị kiểm tra.',sentiment:'NEGATIVE',risk:'MEDIUM'}]}});ids.push(a.id);await api(`/alerts/${a.id}/retry`,'POST');await wait(a.id,'crisis');}
  const content=await api('/posts/generate','POST',{campaignId:campaign.id,topic:'Khuyến khích sinh viên đọc sách, không bịa số liệu hay sự kiện.',targetAudience:'Sinh viên',tone:'Gần gũi',platform:'Facebook',imagePrompt:'Close-up photograph of one open paperback book on a wooden desk beside a small green plant in soft daylight, no text overlays.'});ids.push(content.id);await wait(content.id,'content',480);
  const p=await db.post.findUnique({where:{id:content.id}});results.push({kind:'image',status:p.imageReviewStatus,imageStatus:p.imageStatus,error:p.imageError});
} catch(e) {results.push({kind:'runner',status:'FAILED',error:e.message});console.error(e.message);}
finally {
  fs.mkdirSync('.local/workflow-v2',{recursive:true});fs.writeFileSync('.local/workflow-v2/live-results.json',JSON.stringify(results,null,2));
  if(campaign){const posts=await db.post.findMany({where:{campaignId:campaign.id},select:{id:true}});const artifacts=await db.workflowArtifact.findMany({where:{campaignId:campaign.id},select:{id:true}});const cleanupIds=[...ids,...posts.map(x=>x.id),...artifacts.map(x=>x.id)];await db.workflowJob.updateMany({where:{entityId:{in:cleanupIds},status:{in:['QUEUED','RUNNING']}},data:{status:'CANCELLED'}});await db.workflowJob.deleteMany({where:{entityId:{in:cleanupIds}}});await db.auditLog.deleteMany({where:{entityId:{in:cleanupIds}}});await db.workflowArtifact.deleteMany({where:{campaignId:campaign.id}});await db.post.deleteMany({where:{campaignId:campaign.id}});await db.campaign.delete({where:{id:campaign.id}});}
  if(cookie)await api('/auth/logout','POST',{});await db.$disconnect();console.log(JSON.stringify(results));
  if(results.some(r=>['FAILED','PARTIAL','TIMEOUT','ERROR'].includes(r.status)))process.exitCode=1;
}
