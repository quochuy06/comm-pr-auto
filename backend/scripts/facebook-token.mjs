import { readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import dotenv from 'dotenv';
const path = new URL('../../.local/facebook.env', import.meta.url);
const original = await readFile(path, 'utf8');
const c = dotenv.parse(original);
const required = ['FACEBOOK_APP_ID','FACEBOOK_APP_SECRET','FACEBOOK_USER_ACCESS_TOKEN','FACEBOOK_PAGE_ID','FACEBOOK_GRAPH_API_VERSION'];
for (const key of required) if (!c[key]?.trim()) throw new Error(`Thiếu ${key}`);
if (!/^v\d+\.\d+$/.test(c.FACEBOOK_GRAPH_API_VERSION) || !/^\d+$/.test(c.FACEBOOK_PAGE_ID)) throw new Error('Cấu hình ID/version không hợp lệ');
async function request(route, token, body) {
  let r, data;
  try {
    r = await fetch(`https://graph.facebook.com/${c.FACEBOOK_GRAPH_API_VERSION}/${route}`, {
      method: body ? 'POST' : 'GET', headers: token ? {Authorization:`Bearer ${token}`} : {},
      ...(body ? {body} : {}), redirect:'error', signal:AbortSignal.timeout(20000),
    });
    data = await r.json();
  } catch { throw new Error('Không kết nối được Meta; cấu hình hiện có được giữ nguyên.'); }
  if (!r.ok || data.error) throw new Error(`Meta từ chối (HTTP ${r.status}, mã ${Number(data.error?.code)||0}); không hiển thị nội dung chứa token.`);
  return data;
}
try {
  const expected = ['pages_show_list','pages_read_engagement','pages_manage_posts','pages_read_user_content','pages_manage_engagement','pages_manage_metadata','read_insights'];
  if (process.argv.includes('--messenger')) expected.push('pages_messaging');
  const permissions = await request('me/permissions', c.FACEBOOK_USER_ACCESS_TOKEN);
  const granted = (permissions.data||[]).filter(p=>p.status==='granted').map(p=>p.permission);
  const missing = expected.filter(p=>!granted.includes(p));
  console.log(JSON.stringify({granted:expected.filter(p=>granted.includes(p)),missing}));
  if (missing.length) throw new Error('Token chưa đủ quyền. Chưa thay token Page.');
  const result = await request('oauth/access_token', null, new URLSearchParams({
    grant_type:'fb_exchange_token',client_id:c.FACEBOOK_APP_ID,client_secret:c.FACEBOOK_APP_SECRET,fb_exchange_token:c.FACEBOOK_USER_ACCESS_TOKEN,
  }));
  if (typeof result.access_token !== 'string' || !result.access_token || /\s/.test(result.access_token)) throw new Error('Meta chưa trả token dài hạn hợp lệ.');
  let page, after;
  for(let i=0;i<20;i++) {
    const route = 'me/accounts?fields=id,name,access_token,tasks&limit=100'+(after?'&after='+encodeURIComponent(after):'');
    const accounts = await request(route,result.access_token);
    page = (accounts.data||[]).find(p=>p.id===c.FACEBOOK_PAGE_ID);
    if(page || !accounts.paging?.next) break;
    after=accounts.paging?.cursors?.after;
    if(!after) break;
  }
  if(!page?.access_token) throw new Error('Token mới chưa được cấp cho Page đã cấu hình.');
  const identity=await request('me?fields=id,name',page.access_token);
  if(identity.id!==c.FACEBOOK_PAGE_ID) throw new Error('Danh tính token Page không khớp.');
  const exchangedAt=new Date().toISOString();
  const expires=Number(result.expires_in);
  const expiresAt=Number.isFinite(expires)&&expires>0?new Date(Date.now()+expires*1000).toISOString():'';
  const changes={FACEBOOK_USER_ACCESS_TOKEN:result.access_token,FACEBOOK_PAGE_ACCESS_TOKEN:page.access_token,FACEBOOK_TOKEN_EXCHANGED_AT:exchangedAt,FACEBOOK_USER_TOKEN_EXPIRES_AT:expiresAt};
  let updated=original;
  for(const [key,value] of Object.entries(changes)) {
    const re=new RegExp('^'+key+'=.*$','m');
    updated=re.test(updated)?updated.replace(re,()=>key+'='+value):updated.trimEnd()+'\n'+key+'='+value+'\n';
  }
  if(await readFile(path,'utf8')!==original) throw new Error('Tệp đã thay đổi trong lúc kiểm tra; chưa ghi đè.');
  const temporary=new URL('../../.local/facebook.env.exchange-'+process.pid,import.meta.url);
  try { await writeFile(temporary,updated,{mode:0o600,flag:'wx'}); await chmod(temporary,0o600); await rename(temporary,path); }
  finally { await unlink(temporary).catch(()=>{}); }
  const receipt={pageId:identity.id,pageName:identity.name,granted:expected,exchangedAt,userTokenExpiresAt:expiresAt||null,pageTokenExpiry:'Chưa có thông tin ngày hết hạn; vẫn có thể bị thu hồi.',tasks:page.tasks||[],postsSent:0};
  await writeFile(new URL('../../.local/facebook-token-check.json',import.meta.url),JSON.stringify(receipt,null,2),{mode:0o600});
  console.log(JSON.stringify(receipt));
} catch(e) { console.error(e.message); process.exitCode=1; }
