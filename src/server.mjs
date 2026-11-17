import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {scenarios,requireScenario} from './scenarios.mjs';
import {buildReport,markdownReport,redact} from './report.mjs';
import {runAgents} from './agents.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.md':'text/markdown; charset=utf-8'};
export async function createApp({dataDir=path.join(ROOT,'data'),publicBase=process.env.PUBLIC_BASE_URL||'',token=process.env.DASHBOARD_TOKEN||'',paymentSimulationEnabled=process.env.PAYMENT_SIMULATION_ENABLED!=='false'}={}){
 if(publicBase&&new URL(publicBase).protocol!=='https:')throw new Error('PUBLIC_BASE_URL doit utiliser HTTPS.');
 if(publicBase&&!token)throw new Error('Définir DASHBOARD_TOKEN avant d’exposer le tableau de bord.');
 await fs.mkdir(dataDir,{recursive:true});const runs=new Map();
 for(const f of await fs.readdir(dataDir)){if(/^[a-f0-9-]+\.json$/.test(f)){try{const r=JSON.parse(await fs.readFile(path.join(dataDir,f),'utf8'));if(['queued','executor','analyst'].includes(r.phase)){r.phase='error';r.infrastructureError='Serveur redémarré pendant le test. Vérifier la session H avant de recommencer.';r.report=buildReport(r);}runs.set(r.id,r);}catch{}}}
 const saves=new Map();
 async function persist(run){const previous=saves.get(run.id)??Promise.resolve();const next=previous.catch(()=>{}).then(async()=>{const temp=path.join(dataDir,run.id+'.tmp');await fs.writeFile(temp,JSON.stringify(run,null,2));await fs.rename(temp,path.join(dataDir,run.id+'.json'));});saves.set(run.id,next);await next;}
 function addEvent(run,type,message,extra={}){const e={id:`E${String(run.telemetry.length+1).padStart(3,'0')}`,timestamp:new Date().toISOString(),type,message,...extra};run.telemetry.push(e);return e;}
 function reply(res,code,data,type='application/json; charset=utf-8'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(type.startsWith('application/json')?JSON.stringify(data):data);}
 async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16000)throw new Error('Requête trop volumineuse.');}return JSON.parse(text||'{}');}
 const loginSessions=new Map();
 function authorized(req){if(!token)return true;const sid=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('checkout_session='))?.slice(17);if(sid&&loginSessions.get(sid)>Date.now())return true;const raw=Buffer.from((req.headers.authorization??'').replace(/^Basic /,''),'base64').toString();const candidate=raw.slice(raw.indexOf(':')+1);const a=Buffer.from(candidate),b=Buffer.from(token);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
 async function finish(run){run.report=buildReport(run);run.phase='done';await persist(run);}
 async function startH(run,base){try{await runAgents(run,{url:`${base}/demo?run=${run.id}`,persist:()=>persist(run),saveImage:async({bytes,type})=>{const name=`${run.id}-${crypto.randomUUID()}.${type.includes('jpeg')?'jpg':type.includes('webp')?'webp':'png'}`;await fs.writeFile(path.join(dataDir,name),bytes);return `/api/evidence/${name}`;}});await finish(run);}catch(err){run.phase='error';run.infrastructureError=redact(err.message);run.report=buildReport(run);await persist(run);}}
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
   const isDemo=pathname==='/demo'||pathname==='/demo.js'||pathname==='/demo.css'||pathname==='/checkout-state.mjs'||pathname.startsWith('/api/demo/');
   if(pathname==='/login'&&req.method==='POST'){
    if(req.headers.origin&&req.headers.origin!==publicBase&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return reply(res,403,{error:'Origine non autorisée.'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048)return reply(res,413,{error:'Requête trop longue.'});}
    const a=Buffer.from(new URLSearchParams(raw).get('password')||''),b=Buffer.from(token);
    if(a.length&&a.length===b.length&&crypto.timingSafeEqual(a,b)){const sid=crypto.randomBytes(32).toString('hex');loginSessions.set(sid,Date.now()+28800000);res.writeHead(303,{'Location':'/','Set-Cookie':`checkout_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${publicBase?'; Secure':''}`});return res.end();}
    return reply(res,401,'Mot de passe incorrect. Revenez à la page précédente.','text/plain; charset=utf-8');
   }
   if(!isDemo&&!authorized(req))return reply(res,401,`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion · CheckoutProof</title><style>body{margin:0;background:#101820;color:#eef5f2;font:17px system-ui;display:grid;place-items:center;min-height:100vh}main{max-width:380px;padding:32px}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border-radius:8px;border:1px solid #6a857a}button{background:#98ecc4;font-weight:bold;cursor:pointer}p{color:#afc1b9}</style><main><h1>CheckoutProof</h1><p>Connectez-vous pour lancer les agents de test et consulter les rapports.</p><form method="post" action="/login"><label for="password">Mot de passe du tableau de bord</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Se connecter</button></form></main></html>`,'text/html; charset=utf-8');
   if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`&&req.headers.origin!==publicBase)return reply(res,403,{error:'Origine non autorisée.'});
   if(req.method==='GET'&&pathname==='/api/config')return reply(res,200,{scenarios,keyConfigured:Boolean(process.env.HAI_API_KEY),hReady:Boolean(process.env.HAI_API_KEY&&publicBase),publicBase,scope:'sandbox-only'});
   if(req.method==='GET'&&pathname==='/api/runs')return reply(res,200,[...runs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>({id:r.id,mode:r.mode,scenario:r.scenario,createdAt:r.createdAt,phase:r.phase,outcome:r.report?.outcome,assessment:r.report?.assessment})));
   if(req.method==='POST'&&pathname==='/api/runs'){
    const input=await body(req);requireScenario(input.scenario);if(!['manual','hcompany'].includes(input.mode))throw new Error('Mode invalide.');
    if(input.mode==='hcompany'&&(!process.env.HAI_API_KEY||!publicBase))return reply(res,409,{error:'Le mode H nécessite HAI_API_KEY et une PUBLIC_BASE_URL HTTPS accessible au navigateur cloud.'});
    if([...runs.values()].some(r=>r.mode==='hcompany'&&['queued','executor','analyst'].includes(r.phase)))return reply(res,409,{error:'Un test H est déjà en cours. Attendez sa fin.'});
    if(runs.size>=100)return reply(res,409,{error:'Limite J2 de 100 tests atteinte. Archiver le dossier data avant de redémarrer.'});
    const run={id:crypto.randomUUID(),createdAt:new Date().toISOString(),mode:input.mode,scenario:input.scenario,sandbox:{payment_enabled:paymentSimulationEnabled,shipping_mode:input.scenario==='technical'?'technical_error':input.scenario==='broken'||!paymentSimulationEnabled?'sandbox_limitation':'available'},phase:input.mode==='manual'?'manual':'queued',telemetry:[],screenshots:[],sessions:[],warnings:[]};runs.set(run.id,run);await persist(run);
    reply(res,201,{id:run.id,demoUrl:`/demo?run=${run.id}`});if(input.mode==='hcompany')void startH(run,publicBase.replace(/\/$/,''));return;
   }
   const demoMatch=pathname.match(/^\/api\/demo\/([a-f0-9-]+)(?:\/(event|shipping|pay))?$/);
   if(demoMatch){
    const run=runs.get(demoMatch[1]);if(!run)return reply(res,404,{error:'Session de démonstration introuvable.'});
    if(req.method==='GET'&&!demoMatch[2])return reply(res,200,{scenario:run.scenario,description:scenarios[run.scenario].description,closed:!['manual','executor','queued'].includes(run.phase),sandbox:run.sandbox??null,paid:run.telemetry.some(e=>e.type==='order.confirmed')});
    if(req.method!=='POST')return reply(res,405,{error:'Méthode interdite.'});
    if(!['manual','executor','queued'].includes(run.phase))return reply(res,409,{error:'Ce test est terminé. Lancez-en un nouveau.'});
    const input=await body(req);
    if(demoMatch[2]==='event'){
     if(input.event==='checkout.timeout'||input.event==='checkout.error'||input.event==='checkout.state'){
      const type=input.event;if(type==='checkout.state'&&!['idle','processing','payment','blocked','error','completed'].includes(input.state))throw Error('État invalide.');
      if(run.telemetry.length>=150)return reply(res,429,{error:'Journal complet.'});
      addEvent(run,type,type==='checkout.timeout'?'Délai de transition vers le paiement dépassé.':type==='checkout.error'?'Erreur frontend avant paiement.':`État de l’interface : ${input.state}`,{step:'shipping',source:'frontend',state:input.state,timeout_ms:input.timeout_ms});await persist(run);return reply(res,200,{ok:true});
     }
     if(!['product','cart','shipping','payment','confirmation'].includes(input.step))throw new Error('Étape invalide.');
     if(run.telemetry.length>=150)return reply(res,429,{error:'Journal de test complet.'});
     addEvent(run,'step.viewed',`Écran ${input.step} affiché.`,{step:input.step});if(input.step==='payment')addEvent(run,'payment.viewed','Étape de paiement simulé atteinte.',{step:'payment',source:'frontend'});await persist(run);return reply(res,200,{ok:true});
    }
    if(demoMatch[2]==='shipping'){
     if(!input.complete)return reply(res,422,{error:'Les champs fictifs de livraison sont incomplets.'});
     // Aucune donnée personnelle du formulaire n’est enregistrée.
     const prior=run.telemetry.find(e=>e.type==='shipping.blocked');
     if(!run.telemetry.some(e=>e.type==='shipping.saved'))addEvent(run,'shipping.saved','Formulaire fictif de livraison rempli.',{step:'shipping'});
     const mode=run.sandbox?.shipping_mode??(run.scenario==='broken'?'sandbox_limitation':'available');
     if(prior||mode!=='available'){
      const intentional=mode==='sandbox_limitation';const reason=intentional?'payment_step_disabled_in_sandbox':'unexpected_frontend_error';
      const e=prior??addEvent(run,'shipping.blocked',intentional?'Parcours volontairement arrêté avant paiement dans ce scénario sandbox.':'Erreur technique simulée avant paiement.',{step:'shipping',intentional,reason,source:'sandbox'});
      await persist(run);return reply(res,200,{event:'shipping.blocked',blocked:true,intentional:e.intentional,reason:e.reason,nextStep:null});
     }
     await persist(run);return reply(res,200,{event:'shipping.saved',blocked:false,nextStep:'payment'});
    }
    if(demoMatch[2]==='pay'){
     if(!run.telemetry.some(e=>e.type==='shipping.saved')||run.telemetry.some(e=>e.type==='shipping.blocked'))return reply(res,409,{error:'La livraison n’est pas validée.'});
     if(!run.telemetry.some(e=>e.type==='payment.viewed'))return reply(res,409,{error:'Étape paiement non atteinte.'});
     const prior=run.telemetry.find(e=>['order.confirmed','payment.declined','payment.unknown','authentication.required'].includes(e.type));
     if(prior)return reply(res,200,{outcome:prior.outcome,reference:prior.reference,message:prior.message,idempotent:true});
     addEvent(run,'payment.submitted','Une seule soumission au simulateur de paiement.',{step:'payment'});
     let result;
     if(run.scenario==='success'){const reference='DEMO-'+run.id.slice(0,8).toUpperCase();result={outcome:'confirmed',reference,message:`Commande confirmée en mode test : ${reference}.`};addEvent(run,'order.created',result.message,{...result,step:'confirmation'});addEvent(run,'order.confirmed',result.message,{...result,step:'confirmation'});}
     if(run.scenario==='decline'){result={outcome:'declined',message:'Paiement refusé par le simulateur : test_declined.'};addEvent(run,'payment.failed',result.message,{...result,step:'payment'});addEvent(run,'payment.declined',result.message,{...result,step:'payment'});}
     if(run.scenario==='timeout'){result={outcome:'inconclusive',message:'Réponse du simulateur indisponible. Résultat inconnu, ne pas payer une seconde fois.'};addEvent(run,'payment.unknown',result.message,{...result,step:'payment'});}
     if(run.scenario==='challenge'){result={outcome:'requires_human',message:'Validation 3-D Secure de démonstration : intervention humaine requise.'};addEvent(run,'authentication.required',result.message,{...result,step:'payment'});}
     await persist(run);return reply(res,200,result);
    }
   }
   const runMatch=pathname.match(/^\/api\/runs\/([a-f0-9-]+)(?:\/(finish|report\.json|report\.md))?$/);
   if(runMatch){
    const run=runs.get(runMatch[1]);if(!run)return reply(res,404,{error:'Test introuvable.'});
    if(req.method==='POST'&&runMatch[2]==='finish'){
     if(run.mode!=='manual')return reply(res,409,{error:'L’agent H termine lui-même ce test.'});
     if(run.phase!=='done')await finish(run);return reply(res,200,run.report);
    }
    if(req.method==='GET'&&runMatch[2]){
     if(!run.report)return reply(res,409,{error:'Rapport pas encore disponible.'});
     res.setHeader('Content-Disposition',`attachment; filename="checkoutproof-${run.id}.${runMatch[2].endsWith('md')?'md':'json'}"`);
     return reply(res,200,runMatch[2].endsWith('md')?markdownReport(run.report):run.report,runMatch[2].endsWith('md')?'text/markdown; charset=utf-8':undefined);
    }
    if(req.method==='GET')return reply(res,200,{...run,telemetry:run.telemetry.map(e=>({...e,message:redact(e.message)}))});
   }
   if(req.method==='GET'&&pathname.startsWith('/api/evidence/')){
    const name=pathname.slice(14);if(!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(name))return reply(res,400,{error:'Nom de capture invalide.'});
    try{return reply(res,200,await fs.readFile(path.join(dataDir,name)),MIME[path.extname(name)]);}catch{return reply(res,404,{error:'Capture indisponible.'});}
   }
   if(req.method==='GET'){
    const files={'/':'index.html','/app.js':'app.js','/app.css':'app.css','/demo':'demo.html','/demo.js':'demo.js','/demo.css':'demo.css','/checkout-state.mjs':'checkout-state.mjs'};
    if(files[pathname])return reply(res,200,await fs.readFile(path.join(ROOT,'public',files[pathname])),MIME[path.extname(files[pathname])]);
   }
   return reply(res,404,{error:'Page introuvable.'});
  }catch(err){return reply(res,400,{error:redact(err.message)});}
 });
 return {server,runs};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {server}=await createApp();const port=Number(process.env.PORT)||3087;const host=process.env.HOST||'127.0.0.1';server.listen(port,host,()=>console.log(`CheckoutProof : http://${host}:${port}`));
}
