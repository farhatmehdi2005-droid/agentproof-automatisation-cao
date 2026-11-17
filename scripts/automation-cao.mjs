import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {HClient} from '../src/h-client.mjs';
import {analystSchema,validAnalyst} from '../src/agents.mjs';
import {validExecutor,redact} from '../src/report.mjs';
import {buildAutomationReport,automationMarkdown} from '../src/automation-report.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);const reuse=args.includes('--reuse-proof');
if(args.some(a=>a!=='--reuse-proof')){console.error('Option inconnue. Option disponible : --reuse-proof');process.exit(1);}
const start=Date.now();let lastStatus;
async function runTester(){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts/test-saucedemo.mjs')],{cwd:root,env:process.env,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Testeur non terminé. Aucun succès supposé.')));});}
try{
 if(!process.env.HAI_API_KEY)throw new Error('Ajoutez HAI_API_KEY dans .env avant de lancer la chaîne H.');
 if(!reuse){console.log('1/3 : nouvelle exécution du testeur H sur la démo publique.');await runTester();}else console.log('1/3 : réutilisation explicite d’une preuve H existante. Aucun nouveau test navigateur.');
 const proof=JSON.parse(await fs.readFile(path.join(root,'docs/test-h-reel.json'),'utf8'));
 if(!validExecutor(proof.execution))throw new Error('Compte rendu testeur invalide. Analyse interrompue.');
 const evidence=[{id:'T01',description:'Compte rendu du testeur H'},...(proof.screenshots??[]).map((filename,i)=>({id:`C${String(i+1).padStart(2,'0')}`,filename}))];
 for(const e of evidence.filter(e=>e.filename)){if(path.basename(e.filename)!==e.filename)throw new Error('Nom de capture invalide.');await fs.access(path.join(root,'docs',e.filename));}
 const rules=await fs.readFile(path.join(root,'agents/analyst-public-demo.txt'),'utf8');
 const context={expected_target:'SauceDemo, volontairement choisi pour cette démonstration publique. La boutique locale n’est pas la cible de cette commande.',execution_origin:reuse?'reused':'fresh',environment:proof.environment,testeur:proof.execution,evidence,proof_limits:'Les captures sont référencées mais ne sont pas jointes à cet appel. Ne prétends pas les avoir regardées. Tu analyses le compte rendu textuel du testeur. Aucun journal PSP ou backend n’est fourni. Cite T01 pour le texte. Les captures C01 et suivantes sont à vérifier dans le replay par le lecteur.'};
 console.log('2/3 : analyse H des preuves textuelles et de leurs limites.');
 const h=new HClient({key:process.env.HAI_API_KEY});let analystSession;
 const output=await h.run({agent:process.env.HAI_ANALYST_AGENT||'h/web-surfer-flash',instructions:rules,prompt:rules+'\n\nDONNÉES À ANALYSER\n'+JSON.stringify(context),schema:analystSchema,idempotencyKey:'checkoutproof-cao-'+crypto.randomUUID(),maxSteps:5,maxTime:60,onSession:s=>{analystSession=s;console.log('Session analyste : '+s.url);},onStatus:s=>{if(lastStatus!==s){console.log('État H : '+s);lastStatus=s;}}});
 if(!validAnalyst(output.answer))throw new Error('Analyse H invalide. Rapport final non généré.');
 const report=buildAutomationReport(proof,output.answer,{analystSession,executionOrigin:reuse?'reused':'fresh',elapsedSeconds:Math.round((Date.now()-start)/1000)});
 await fs.mkdir(path.join(root,'data'),{recursive:true});
 await fs.writeFile(path.join(root,'data/rapport-automatisation.json'),JSON.stringify(report,null,2));
 await fs.writeFile(path.join(root,'data/rapport-automatisation.md'),automationMarkdown(report));
 console.log('3/3 : rapports enregistrés dans data/rapport-automatisation.json et .md.');
 console.log('Résultat : '+report.checkout_outcome+' (preuve UI, aucun paiement bancaire vérifié).');
}catch(e){console.error(redact(e.message));process.exitCode=1;}
