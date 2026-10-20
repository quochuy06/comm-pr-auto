#!/usr/bin/env python3
"""Install the three workflows into the existing local n8n, with private backups.
Run explicitly from the project root. Secrets never enter tracked workflow JSON.
"""
import json, pathlib, subprocess, tempfile, os, datetime, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2]
CONTAINER=os.environ.get('N8N_CONTAINER','n8n')
PRIVATE=ROOT/'.local'; PRIVATE.mkdir(exist_ok=True,mode=0o700)
def run(args):
    result=subprocess.run(args,capture_output=True,text=True)
    if result.returncode: raise RuntimeError('Command failed: '+' '.join(args[:4])+' (inspect container logs locally)')
    return result.stdout
def sql(query):
    script='const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/home/node/.n8n/database.sqlite",{readOnly:true});console.log(JSON.stringify(db.prepare('+json.dumps(query)+').all()));'
    return json.loads(run(['docker','exec',CONTAINER,'node','-e',script]))
workflows=sql('SELECT id,name,nodes FROM workflow_entity WHERE isArchived=0')
current=next((w for w in workflows if any(n.get('type')=='n8n-nodes-base.webhook' and n.get('parameters',{}).get('path')=='generate-post' for n in json.loads(w['nodes']))),None)
if not current: raise RuntimeError('No existing generate-post workflow found; select the target workflow first.')
project=next((w['projectId'] for w in sql('SELECT "workflowId","projectId" FROM shared_workflow') if w['workflowId']==current['id']),None)
if not project: raise RuntimeError('Cannot determine workflow owner project.')
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup=PRIVATE/'backups';backup.mkdir(exist_ok=True,mode=0o700)
run(['docker','exec',CONTAINER,'node','-e','const {DatabaseSync,backup}=require("node:sqlite");const db=new DatabaseSync("/home/node/.n8n/database.sqlite",{readOnly:true});backup(db,"/tmp/comm-pr-before.sqlite").then(()=>db.close());'])
with (backup/f'n8n-{stamp}.sqlite').open('wb') as f:
    subprocess.run(['docker','exec',CONTAINER,'cat','/tmp/comm-pr-before.sqlite'],stdout=f,check=True)
os.chmod(backup/f'n8n-{stamp}.sqlite',0o600)
env={}
for line in (ROOT/'backend/.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1);env[k.strip()]=v.strip().strip('"').strip("'")
secret=env.get('N8N_CALLBACK_SECRET')
if not secret or len(secret)<32: raise RuntimeError('Backend internal token is missing or too short.')
key=env.get('GEMINI_API_KEY')
for node in json.loads(current['nodes']):
    for h in node.get('parameters',{}).get('headerParameters',{}).get('parameters',[]):
        if not key and h.get('name','').lower()=='x-goog-api-key' and h.get('value') and h['value']!='YOUR_GEMINI_API_KEY': key=h['value']
credentials=[{'id':'comm-pr-callback','name':'Comm PR Internal Token','type':'httpHeaderAuth','data':{'name':'x-comm-token','value':secret}}]
if key: credentials.append({'id':'comm-pr-gemini','name':'Comm PR Gemini','type':'httpHeaderAuth','data':{'name':'x-goog-api-key','value':key}})
elif not any(c['id']=='comm-pr-gemini' for c in sql('SELECT id FROM credentials_entity')): raise RuntimeError('Gemini key not found. Configure Comm PR Gemini credential in n8n.')
ids={'content':current['id'],'image':'commPRImage01','planning':'commPRPlanning01','publishing':'commPRPublish01','community':'commPRCommunity1','crisis':'commPRCrisis01'}
files={'content':'hoang-01-content.json','image':'hoang-02-image.json','planning':'huy-01-planning.json','publishing':'huy-02-publishing.json','community':'agent-3-community.json','crisis':'agent-4-crisis.json'}
bundle=[]
for kind,filename in files.items():
    w=json.loads((ROOT/'n8n/workflows'/filename).read_text());w['id']=ids[kind]
    # Linux default Docker bridge. Override when using another Docker network.
    for n in w['nodes']:
        if n.get('parameters',{}).get('url','').startswith('https://generativelanguage.googleapis.com/v1beta/models/'):
            model=env.get('GEMINI_MODEL','gemini-3.5-flash-lite')
            if not model.replace('-','').replace('.','').isalnum(): raise RuntimeError('Invalid GEMINI_MODEL')
            n['parameters']['url']='https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent'
        if n['name']=='14a Download and stage image': n['parameters']['url']=os.environ.get('BACKEND_CALLBACK_BASE','http://172.17.0.1:5000')+'/api/webhooks/prepare-image'
        if n.get('parameters',{}).get('url','').startswith('http://172.17.0.1:5000/'):
            n['parameters']['url']=n['parameters']['url'].replace('http://172.17.0.1:5000',os.environ.get('BACKEND_CALLBACK_BASE','http://172.17.0.1:5000'))
    bundle.append(w)
try:
    with tempfile.TemporaryDirectory(prefix='n8n-import-',dir=PRIVATE) as temp:
        for name,data in [('credentials',credentials),('workflows',bundle)]:
            p=pathlib.Path(temp)/(name+'.json');p.write_text(json.dumps(data));p.chmod(0o600)
            # stdin creates the container file as the n8n user without exposing credentials in argv.
            payload=p.read_bytes()
            result=subprocess.run(['docker','exec','-i',CONTAINER,'node','-e',f'let b=[];process.stdin.on("data",x=>b.push(x));process.stdin.on("end",()=>require("fs").writeFileSync("/tmp/comm-pr-{name}.json",Buffer.concat(b),{{mode:384}}));'],input=payload,capture_output=True)
            if result.returncode: raise RuntimeError('Unable to stage import')
        run(['docker','exec',CONTAINER,'n8n','import:credentials','--input=/tmp/comm-pr-credentials.json','--projectId='+project])
        run(['docker','exec',CONTAINER,'n8n','import:workflow','--input=/tmp/comm-pr-workflows.json','--projectId='+project])
        for workflow_id in ids.values(): run(['docker','exec',CONTAINER,'n8n','publish:workflow','--id='+workflow_id])
finally:
    run(['docker','exec',CONTAINER,'node','-e','for(const p of ["/tmp/comm-pr-credentials.json","/tmp/comm-pr-workflows.json","/tmp/comm-pr-before.sqlite"]){try{require("fs").unlinkSync(p)}catch{}}'])
(PRIVATE/'workflow-ids.json').write_text(json.dumps(ids,indent=2))
run(['docker','restart',CONTAINER])
for attempt in range(45):
    try:
        with urllib.request.urlopen('http://localhost:5678/healthz/readiness', timeout=2) as response:
            if response.status == 200:
                time.sleep(2)
                break
    except Exception:
        pass
    time.sleep(1)
else:
    raise RuntimeError('Workflows installed but n8n is not ready yet; check container logs.')
print(f'Installed and published {len(bundle)} workflows. Existing content workflow ID preserved. Backup in .local/backups; secrets stored as n8n credentials.')
