import { Router } from "express";
import prisma from "../prisma.js";
import { roles } from "../middleware/auth.js";
import { HttpError, audit } from "../lib/errors.js";
import { createArtifact } from "../services/expansion.js";
import { reportInput, sourceRevision, reportCsv } from "../services/insights.js";
import { dispatch } from "../services/workflows.js";
const router=Router();
router.post('/posts/:id/repurpose', roles('ADMIN','EDITOR'), async(req,res)=>{
  const p=await prisma.post.findUniqueOrThrow({where:{id:req.params.id}});
  if(!['APPROVED','PUBLISHED'].includes(p.status)||!p.headline||!p.content)throw new HttpError(409,'Cần bài gốc đã duyệt, có đủ nội dung.');
  const input={source:{headline:p.headline,content:p.content,platform:p.platform},sourceRevision:sourceRevision(p),platforms:['Facebook','LinkedIn','X']};
  const {artifact,job}=await prisma.$transaction(db=>createArtifact(db,'repurpose',input,{campaignId:p.campaignId,sourcePostId:p.id}));
  dispatch(job);res.status(201).json({success:true,data:artifact});
});
router.post('/campaigns/:id/report',roles('ADMIN','EDITOR'),async(req,res)=>{
  const input=await reportInput(req.params.id,req.body.from,req.body.to);
  const {artifact,job}=await prisma.$transaction(db=>createArtifact(db,'report',input,{campaignId:req.params.id}));
  dispatch(job);res.status(201).json({success:true,data:artifact});
});
router.get('/artifacts/:id/csv',async(req,res)=>{
  const a=await prisma.workflowArtifact.findUniqueOrThrow({where:{id:req.params.id}});
  if(a.kind!=='report')throw new HttpError(400,'Chỉ xuất CSV cho báo cáo.');
  res.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="campaign-report-${a.id}.csv"`).send(reportCsv(a));
});
router.post('/artifacts/:id/variants/:index',roles('ADMIN','EDITOR'),async(req,res)=>{
  const index=Number(req.params.index);if(!Number.isInteger(index)||index<0||index>2)throw new HttpError(400,'Phiên bản không hợp lệ.');
  const p=await prisma.$transaction(async db=>{
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.params.id}))::text`;
    const a=await db.workflowArtifact.findUniqueOrThrow({where:{id:req.params.id}});
    if(a.kind!=='repurpose'||a.status!=='APPROVED')throw new HttpError(409,'Bản chuyển thể cần được duyệt trước.');
    if(a.createdPosts?.[index])return db.post.findUniqueOrThrow({where:{id:a.createdPosts[index]}});
    const source=a.sourcePostId&&await db.post.findUnique({where:{id:a.sourcePostId}});
    if(!source||!['APPROVED','PUBLISHED'].includes(source.status)||sourceRevision(source)!==a.input.sourceRevision)throw new HttpError(409,'Bài gốc đã thay đổi; hãy chuyển thể lại.');
    const v=a.result?.variants?.[index];if(!v)throw new HttpError(404,'Không có phiên bản.');
    const post=await db.post.create({data:{campaignId:a.campaignId,topic:source.topic,headline:v.headline,content:v.content,platform:v.platform,bannerUrl:source.bannerUrl,imagePrompt:source.imagePrompt,imageStatus:source.imageStatus,status:'PENDING_APPROVAL',risk:'UNKNOWN',reviewReason:'Bản chuyển thể cần kiểm tra văn bản và ảnh trước khi đăng.'}});
    await db.workflowArtifact.update({where:{id:a.id},data:{createdPosts:{...(a.createdPosts||{}),[index]:post.id}}});
    await audit(db,req.user.email,'VARIANT_CREATED',post.id,a.id);return post;
  });res.json({success:true,data:p});
});
export default router;
