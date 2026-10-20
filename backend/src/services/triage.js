import { choice, text, HttpError } from "../lib/errors.js";
export function communityMetadata(result) {
  return { issueType: choice(result.issueType,["INFORMATION","COMPLIMENT","COMPLAINT","SAFETY","LEGAL","OTHER"],"Loại vấn đề"), urgency: choice(result.urgency,["LOW","MEDIUM","HIGH"],"Mức ưu tiên") };
}
export function applyTriage(result, meta) {
  if(["SAFETY","LEGAL"].includes(meta.issueType)||meta.urgency==="HIGH") return {...result,risk:"HIGH",sensitive:true};
  if(meta.issueType==="COMPLAINT"&&result.risk==="LOW") return {...result,risk:"MEDIUM"};
  return result;
}
export function crisisMetadata(result,evidence) {
  const ids=new Set((Array.isArray(evidence)?evidence:[]).map(e=>e.id));
  if(!Array.isArray(result.evidenceIds)||!result.evidenceIds.length||result.evidenceIds.length>20||new Set(result.evidenceIds).size!==result.evidenceIds.length||result.evidenceIds.some(id=>typeof id!=="string"||!ids.has(id)))throw new HttpError(400,"Thông cáo dẫn bằng chứng không hợp lệ.");
  if(!Array.isArray(result.verificationSteps)||!result.verificationSteps.length||result.verificationSteps.length>10)throw new HttpError(400,"Cần 1–10 bước xác minh.");
  return {evidenceIds:result.evidenceIds,verificationSteps:result.verificationSteps.map(x=>text(x,"Bước xác minh",1000))};
}
