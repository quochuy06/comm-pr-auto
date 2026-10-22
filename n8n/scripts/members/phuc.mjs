import { buildWorkflow, writeWorkflow } from "../workflow-builder.mjs";
import { specs } from "./legacy-specs.mjs";
export function build() {
  for(const kind of ['community','crisis']) {
    const s={...specs[kind],name:kind==='community'?'Phúc · 01 · Phân tích và phản hồi cộng đồng':'Phúc · 02 · Xử lý khủng hoảng có bằng chứng'};
    if(kind==='community') {
      s.instruction += ' Chỉ xác nhận địa chỉ, giờ mở cửa, giá và tiện ích khi bài viết có thông tin xác thực tương ứng. Nếu không có, trả lời rõ chưa có thông tin xác nhận; không tự khẳng định cơ sở có thật hoặc hứa đón khách. Nếu bài ghi thương hiệu giả lập/demo/đồ án, nhắc đúng bối cảnh đó khi người dùng hỏi dịch vụ thực tế.';
      s.instruction += ' Bổ sung issueType:"INFORMATION"|"COMPLIMENT"|"COMPLAINT"|"SAFETY"|"LEGAL"|"OTHER" và urgency:"LOW"|"MEDIUM"|"HIGH". SAFETY/LEGAL luôn nhạy cảm, urgency HIGH. Khiếu nại COMPLAINT phải chuyển người duyệt.';
      s.validate += " && ['INFORMATION','COMPLIMENT','COMPLAINT','SAFETY','LEGAL','OTHER'].includes(d.issueType)&&['LOW','MEDIUM','HIGH'].includes(d.urgency)";
    } else {
      s.instruction += ' Bổ sung evidenceIds:string[] dẫn đúng ID từ context.evidence, ít nhất 1 ID; verificationSteps:string[] gồm 1–10 bước xác minh cần làm. Không tạo ID mới và không coi phản ánh là kết luận.';
      s.validate += " && Array.isArray(d.evidenceIds)&&d.evidenceIds.length>0&&Array.isArray(d.verificationSteps)&&d.verificationSteps.length>0&&d.verificationSteps.length<=10&&d.verificationSteps.every(x=>typeof x==='string')";
    }
    const w=buildWorkflow(kind,s);
    const name=kind==='community'?'08a Enforce triage policy':'08a Check evidence references';
    const jsCode=kind==='community'?"if($json.ok){const d=$json.result;if(['SAFETY','LEGAL'].includes(d.issueType)||d.urgency==='HIGH'){d.sensitive=true;d.risk='HIGH';}else if(d.issueType==='COMPLAINT'&&d.risk==='LOW'){d.risk='MEDIUM';}}return {json:$json};":"if($json.ok){const ids=new Set(($json.context.evidence||[]).map(e=>e.id));const refs=$json.result.evidenceIds;if(refs.length>20||new Set(refs).size!==refs.length||refs.some(id=>typeof id!=='string'||!ids.has(id))){$json.ok=false;$json.error='Thông cáo dẫn chứng không khớp dữ liệu; cần soạn lại.';}}return {json:$json};";
    w.nodes.push({id:kind+'-triage-check',name,type:'n8n-nodes-base.code',typeVersion:2,position:[600,1000],parameters:{jsCode}});
    w.connections['08 Validate generated fields']={main:[[{node:name,type:'main',index:0}]]};
    w.connections[name]={main:[[{node:'09 Generation succeeded',type:'main',index:0}]]};
    // Review validator must preserve the policy/evidence checks preceding the AI review.
    const reviewer=w.nodes.find(n=>n.name==='12 Validate reviewer response');
    reviewer.parameters.jsCode=reviewer.parameters.jsCode.replace("$('08 Validate generated fields')",`$('${name}')`);
    writeWorkflow(kind==='community'?'phuc-01-community.json':'phuc-02-crisis.json',w);
  }
}
