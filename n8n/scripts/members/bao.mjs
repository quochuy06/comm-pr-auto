import { buildWorkflow, writeWorkflow } from "../workflow-builder.mjs";
export function build() {
  const definitions = {
    repurpose: { file: 'bao-01-repurpose.json', name:'Bảo · 01 · Chuyển thể đa nền tảng',webhook:'repurpose-content',
      instruction:'Chuyển thể bài PR gốc sang đúng ba nền tảng Facebook, LinkedIn và X. Giữ nguyên dữ kiện, không thêm giá, thành tích, ưu đãi, cam kết hay số liệu. X tối đa 280 ký tự (kể cả khoảng trắng), LinkedIn tối đa 3000 ký tự, Facebook tối đa 12000 ký tự. Trả JSON {variants:[{platform:"Facebook"|"LinkedIn"|"X",headline:string,content:string}]}. Viết gọn để phù hợp giới hạn. Mọi phiên bản phải được người duyệt xem trước khi đăng.',
      validate:"Array.isArray(d.variants)&&d.variants.length===3&&new Set(d.variants.map(x=>x.platform)).size===3&&d.variants.every(x=>['Facebook','LinkedIn','X'].includes(x.platform)&&typeof x.headline==='string'&&typeof x.content==='string'&&x.content.length>0&&x.content.length<=({X:280,LinkedIn:3000,Facebook:12000}[x.platform]))" },
    report: {file:'bao-02-report.json',name:'Bảo · 02 · Báo cáo chiến dịch',webhook:'campaign-report',
      instruction:'Nhận xét dữ liệu chiến dịch dựa CHỈ trên metrics và definitions đã tính sẵn. Không tính lại, không tạo số liệu reach/impression, không so sánh kỳ trước nếu chưa có dữ liệu kỳ trước. Khi mẫu ít hoặc tỷ lệ là null, nói rõ chưa đủ dữ liệu. Không xem kế hoạch/suy đoán là kết quả đã đạt. Trả JSON {summary:string,recommendations:string[] tối đa 10 đề xuất}. Các đề xuất là việc nên làm trong tương lai.',
      validate:"typeof d.summary==='string'&&d.summary.length>0&&Array.isArray(d.recommendations)&&d.recommendations.length<=10&&d.recommendations.every(x=>typeof x==='string')" },
  };
  for(const [kind,s] of Object.entries(definitions)) {
    const w=buildWorkflow(kind,{...s,format:"if($json.ok){$json.result.requiresHuman=true;}return {json:$json};"});
    w.nodes.find(n=>n.name==='16 Persist result in backend').parameters.url='http://172.17.0.1:5000/api/workflow-internal/callback/'+kind;
    if(kind==='report') {
      w.nodes.push({id:'weekly-report-trigger',name:'18 Weekly report schedule',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[0,1000],parameters:{rule:{interval:[{field:'weeks',weeksInterval:1,triggerAtDay:[1],triggerAtHour:8,triggerAtMinute:0}]}}});
      w.nodes.push({id:'weekly-report-queue',name:'19 Queue weekly snapshots',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[300,1000],parameters:{method:'POST',url:'http://172.17.0.1:5000/api/workflow-internal/weekly-reports',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options:{timeout:60000}},credentials:{httpHeaderAuth:{id:'comm-pr-callback',name:'Comm PR Internal Token'}}});
      w.connections['18 Weekly report schedule']={main:[[{node:'19 Queue weekly snapshots',type:'main',index:0}]]};
      w.settings.timezone='Asia/Ho_Chi_Minh';
    }
    writeWorkflow(s.file,w);
  }
}
