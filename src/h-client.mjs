import {setTimeout as delay} from 'node:timers/promises';
const terminal=new Set(['completed','failed','interrupted','timed_out']);
export class HClient {
 constructor({key,base='https://agp.eu.hcompany.ai/api/v2',fetchImpl=fetch,pollMs=2500,deadlineMs=300000}){
  const u=new URL(base);if(u.protocol!=='https:'||!['agp.eu.hcompany.ai','agp.hcompany.ai'].includes(u.hostname)||u.pathname.replace(/\/$/,'')!=='/api/v2')throw new Error('Origine API H non autorisée.');
  if(!key)throw new Error('HAI_API_KEY absente. Ajoutez-la dans .env, côté serveur.');
  this.key=key;this.base=base.replace(/\/$/,'');this.fetch=fetchImpl;this.pollMs=pollMs;this.deadlineMs=deadlineMs;
 }
 async request(path,{method='GET',body,idempotencyKey}={}){
  const response=await this.fetch(this.base+path,{method,headers:{Authorization:`Bearer ${this.key}`,...(body?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`API H HTTP ${response.status}. ${response.status===401?'Vérifiez la clé.':response.status===429?'Quota ou limite de concurrence atteint.':'Consultez la session sur H Platform.'}`);
  if(response.status===204)return null;
  return response.json();
 }
 async run({prompt,schema,idempotencyKey,maxSteps=45,maxTime=180,startUrl,instructions,agent=process.env.HAI_AGENT||'h/web-surfer-flash',onSession=()=>{},onStatus=()=>{}}){
  const session=await this.request('/sessions',{method:'POST',idempotencyKey,body:{agent,messages:prompt,timezone:'Europe/Paris',max_steps:maxSteps,max_time_s:maxTime,idle_timeout_s:null,overrides:{'agent.answer_format':schema,...(instructions?{'agent.instructions':instructions}:{}),...(startUrl?{'agent.environments[kind=web].start_url':startUrl}:{})}}});
  if(typeof session.id!=='string'||!/^[\w-]+$/.test(session.id))throw new Error('Identifiant de session H invalide.');
  onSession({id:session.id,url:session.agent_view_url});
  const started=Date.now();let idlePolls=0;let status=typeof session.status==='string'?session.status:session.status?.status;
  while(!terminal.has(status)){
   if(Date.now()-started>this.deadlineMs){await this.request(`/sessions/${session.id}`,{method:'DELETE'}).catch(()=>{});throw new Error('Délai local dépassé. Annulation de la session demandée, résultat de paiement inconnu.');}
   if(status==='idle')idlePolls++;else idlePolls=0;
   if(idlePolls>5||['paused','awaiting_tool_results'].includes(status)){await this.request(`/sessions/${session.id}`,{method:'DELETE'}).catch(()=>{});throw new Error(`Session H en état ${status}. Intervention nécessaire, résultat non confirmé.`);}
   await delay(this.pollMs);
   const snapshot=await this.request(`/sessions/${session.id}/status`);
   status=typeof snapshot.status==='string'?snapshot.status:snapshot.status?.status;
   onStatus(status??'unknown');
  }
  const result=await this.request(`/sessions/${session.id}`);
  if(status!=='completed')throw new Error(`Session H terminée avec ${status}. Aucun succès de paiement déduit.`);
  let answer=result.latest_answer;
  if(typeof answer==='string'){try{answer=JSON.parse(answer);}catch{throw new Error('Réponse H non conforme au JSON attendu.');}}
  if(!answer||typeof answer!=='object')throw new Error('Réponse structurée H absente.');
  return {session,answer};
 }
 async events(id){
  const all=[];for(let page=1;page<=20;page++){
   const value=await this.request(`/sessions/${encodeURIComponent(id)}/events?size=200&page=${page}`);
   const items=value.items??[];all.push(...items);if(items.length<200)break;
  }return all;
 }
 async screenshotResources(events){
  const found=new Map();
  function add(bucket,key){if(!bucket||!key)return;const value=bucket==='screenshots'?key:{bucket,key};found.set(JSON.stringify(value),value);}
  function visit(x){
   if(typeof x==='string'){
    try{const u=new URL(x);if(['agp.eu.hcompany.ai','agp.hcompany.ai'].includes(u.hostname)){const m=u.pathname.match(/\/resources\/([^/]+)\/(.+)$/);if(m&&(/screenshot/.test(m[1])))add(decodeURIComponent(m[1]),decodeURIComponent(m[2]));}}catch{}
    if(/^screenshots\/[\w./-]+\.(png|jpe?g|webp)$/i.test(x))add('screenshots',x.slice(12));
   }else if(x&&typeof x==='object'){if(x.bucket==='screenshots'&&typeof x.key==='string')add(x.bucket,x.key);Object.values(x).forEach(visit);}
  }events.forEach(visit);return [...found.values()].slice(-6);
 }
 async screenshot(id,key){
  const resource=typeof key==='string'?{bucket:'screenshots',key}:key;
  if(!resource||typeof resource.bucket!=='string'||typeof resource.key!=='string')throw new Error('Référence de capture invalide.');
  const path=`/sessions/${encodeURIComponent(id)}/resources/${encodeURIComponent(resource.bucket)}/${resource.key.split('/').map(encodeURIComponent).join('/')}`;
  const first=await this.fetch(this.base+path,{headers:{Authorization:`Bearer ${this.key}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
  let response=first;
  if([301,302,303,307,308].includes(first.status)){
   const location=new URL(first.headers.get('location'),this.base);
   if(location.protocol!=='https:'||!(location.hostname.endsWith('.amazonaws.com')||location.origin===new URL(this.base).origin))throw new Error('Stockage de capture inattendu.');
   // Ne jamais transmettre la clé H au stockage de fichiers.
   response=await this.fetch(location,{redirect:'error',signal:AbortSignal.timeout(30000)});
  }
  if(!response.ok)throw new Error('Capture H indisponible.');
  const type=response.headers.get('content-type')??'';if(!/^image\/(png|jpeg|webp)/.test(type))throw new Error('Format de capture inattendu.');
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8*1024*1024)throw new Error('Capture trop volumineuse.');return {bytes,type};
 }
}
