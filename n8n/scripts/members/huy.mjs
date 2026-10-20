import { buildWorkflow, writeWorkflow } from "../workflow-builder.mjs";
export function build() {
  const planning = buildWorkflow("planning", {
    name: "Huy · 01 · Lập kế hoạch chiến dịch", webhook: "plan-campaign",
    instruction: 'Lập kế hoạch PR tiếng Việt dựa trên mục tiêu, đối tượng và thời gian được cung cấp. Không bịa sự kiện, giá hoặc thông tin sản phẩm. Trả JSON {summary:string,items:[{topic:string,targetAudience:string,tone:string,platform:"Facebook"|"LinkedIn"|"X",suggestedDate:string,rationale:string}]}. Số ý tưởng bằng context.count, tối đa 20. Ngày chỉ là đề xuất, không tự đăng bài.',
    validate: "typeof d.summary==='string'&&Array.isArray(d.items)&&d.items.length>0&&d.items.length<=20&&d.items.every(x=>typeof x.topic==='string'&&typeof x.targetAudience==='string'&&typeof x.tone==='string'&&['Facebook','LinkedIn','X'].includes(x.platform)&&typeof x.suggestedDate==='string'&&typeof x.rationale==='string')",
    format: "if($json.ok){$json.result.requiresHuman=true;}return {json:$json};",
  });
  planning.nodes.find(n=>n.name==='16 Persist result in backend').parameters.url = 'http://172.17.0.1:5000/api/workflow-internal/callback/planning';
  writeWorkflow('huy-01-planning.json', planning);
  const nodes = [], connections = {};
  const add = (name,type,parameters,extra={}) => {nodes.push({id:`publish-${nodes.length+1}`,name,type:`n8n-nodes-base.${type}`,typeVersion: type==='httpRequest'?4.2:type==='code'||type==='webhook'?2:type==='if'?2.2:type==='scheduleTrigger'?1.2:1,position:[(nodes.length%4)*280,Math.floor(nodes.length/4)*220],parameters,...extra});};
  const token = { httpHeaderAuth: {id:'comm-pr-callback',name:'Comm PR Internal Token'} };
  const http = (name,path,method='POST',body='={{ JSON.stringify($json) }}') => add(name,'httpRequest',{method,url:'http://172.17.0.1:5000/api/workflow-internal/'+path,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',...(method==='POST'?{sendBody:true,specifyBody:'json',jsonBody:body}:{}),options:{timeout:30000}},{credentials:token});
  const code = (name,jsCode) => add(name,'code',{jsCode});
  const link=(from,to,branch=0)=>{connections[from]??={main:[]};connections[from].main[branch]??=[];connections[from].main[branch].push({node:to,type:'main',index:0});};
  add('01 Every minute','scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:1}]}});
  add('02 Manual authenticated tick','webhook',{httpMethod:'POST',path:'publish-due',authentication:'headerAuth',responseMode:'onReceived',options:{}},{webhookId:'comm-pr-publisher',credentials:token});
  http('03 Fetch due schedules','due','GET');
  code('04 Validate schedule batch',"if(!Array.isArray($json.schedules)||$json.schedules.length>50)throw new Error('Invalid schedule batch');return {json:$json};");
  add('05 Has due schedules','if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'has-due',leftValue:'={{ $json.schedules.length > 0 }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
  code('06 Expand due items',"return $json.schedules.map(s=>({json:s}));");
  code('07 Bind schedule revision',"return $input.all().map(item=>{const s=item.json;if(typeof s.id!=='string'||!s.updatedAt)throw new Error('Missing schedule revision');return {json:{id:s.id,expectedUpdatedAt:s.updatedAt}};});");
  http('08 Publish atomically','publish');
  code('09 Check publication results',"return $input.all().map(i=>{if(!['PUBLISHED','FAILED','IGNORED','NOT_DUE'].includes(i.json.status))throw new Error('Unexpected publishing result');return i;});");
  code('10 Summarize outcomes',"const rows=$input.all().map(i=>i.json);return {json:{published:rows.filter(x=>x.status==='PUBLISHED').length,failed:rows.filter(x=>x.status==='FAILED').length,ignored:rows.filter(x=>['IGNORED','NOT_DUE'].includes(x.status)).length}};");
  code('11 Empty batch summary',"return {json:{published:0,failed:0,ignored:0}};");
  http('12 Record execution summary','publisher-log');
  link(nodes[0].name,nodes[2].name);link(nodes[1].name,nodes[2].name);
  for(let i=2;i<9;i++)link(nodes[i].name,nodes[i+1].name);
  link('05 Has due schedules','11 Empty batch summary',1);
  link('10 Summarize outcomes','12 Record execution summary');link('11 Empty batch summary','12 Record execution summary');
  writeWorkflow('huy-02-publishing.json',{name:'Huy · 02 · Đăng bài theo lịch',nodes,connections,settings:{executionOrder:'v1',executionTimeout:120,timezone:'Asia/Ho_Chi_Minh'},active:false});
}
