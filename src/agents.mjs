import fs from 'node:fs/promises';
import {HClient} from './h-client.mjs';
import {diagnose} from './diagnosis.mjs';
import {validExecutor} from './report.mjs';
const executorRules=await fs.readFile(new URL('../agents/executor.txt',import.meta.url),'utf8');
const analystRules=await fs.readFile(new URL('../agents/analyst.txt',import.meta.url),'utf8');
const str={type:'string'};
export const executorSchema={type:'object',additionalProperties:false,properties:{checkout_outcome:{type:'string',enum:['confirmed','declined','blocked','requires_human','inconclusive']},last_step:{type:'string',enum:['product','cart','shipping','payment','confirmation']},summary:str,order_reference:str,observations:{type:'array',items:str}},required:['checkout_outcome','last_step','summary','order_reference','observations']};
export const analystSchema={type:'object',additionalProperties:false,properties:{summary:str,findings:{type:'array',items:{type:'object',additionalProperties:false,properties:{observation:str,hypothesis:str,next_check:str,evidence_ids:{type:'array',items:str}},required:['observation','hypothesis','next_check','evidence_ids']}}},required:['summary','findings']};
export function executorPrompt(url){return `${executorRules}\n\nURL autorisée : ${url}\nOrigine autorisée : ${new URL(url).origin}\nDonnées de test : Camille Test, camille@example.test, 10 rue Exemple, 75001 Paris, France. Tous les champs sont fictifs. Le formulaire utilise un moyen de paiement simulé sans carte. Ne renseigne pas de téléphone si aucun champ n’est affiché. Ne lis pas les paramètres d’URL pour prédire l’issue. Décris ce que tu observes réellement.`;}
export function validAnalyst(a){return a&&typeof a.summary==='string'&&a.summary.length<10000&&Array.isArray(a.findings)&&a.findings.length<=20&&a.findings.every(f=>f&&['observation','hypothesis','next_check'].every(k=>typeof f[k]==='string'&&f[k].length<5000)&&Array.isArray(f.evidence_ids)&&f.evidence_ids.every(x=>typeof x==='string'));}
export async function runAgents(run,{url,persist,saveImage}){
 const h=new HClient({key:process.env.HAI_API_KEY,base:process.env.HAI_API_BASE||undefined});
 const limits={maxSteps:Number(process.env.H_MAX_STEPS)||45,maxTime:Number(process.env.H_MAX_TIME_S)||180};
 run.phase='executor';await persist();
 const execution=await h.run({prompt:executorPrompt(url),schema:executorSchema,idempotencyKey:`${run.id}-executor`,...limits,onSession:x=>{run.sessions.push({role:'Testeur',...x});},onStatus:status=>{run.hStatus=status;}});
 execution.answer={...execution.answer,outcome:execution.answer.checkout_outcome};
 if(!validExecutor(execution.answer))throw new Error('Le compte rendu du testeur H est invalide.');
 run.execution=execution.answer;await persist();
 try{
  const events=await h.events(execution.session.id);const keys=await h.screenshotResources(events);
  for(const key of keys){try{const image=await h.screenshot(execution.session.id,key);const name=await saveImage(image);run.screenshots.push({path:name,source:'H Company',session_id:execution.session.id});}catch{run.warnings.push('Une capture H n’a pas pu être récupérée. Voir le replay de session.');}}
  if(!keys.length)run.warnings.push('Aucune référence de capture reconnue dans les événements H. Le replay reste disponible dans H Platform.');
 }catch{run.warnings.push('Événements H indisponibles. Le rapport ne prétend pas contenir des captures.');}
 run.phase='analyst';await persist();
 const input={classification_confirmee:diagnose(run.telemetry),configuration_sandbox:run.sandbox??null,testeur:run.execution,journal_sandbox:run.telemetry,limites:'Le journal confirme uniquement les opérations du simulateur maison. Aucune connexion à un prestataire de paiement.'};
 try{
  const result=await h.run({prompt:analystRules+'\n\nDONNÉES À ANALYSER :\n'+JSON.stringify(input),schema:analystSchema,agent:process.env.HAI_ANALYST_AGENT||process.env.HAI_AGENT||'h/web-surfer-flash',idempotencyKey:`${run.id}-analyst`,maxSteps:8,maxTime:80,onSession:x=>run.sessions.push({role:'Analyste',...x})});
  if(!validAnalyst(result.answer))throw new Error('Réponse analyste invalide.');run.analysis=result.answer;
 }catch{run.warnings.push('Analyse IA indisponible. Le rapport conserve le journal et les constats déterministes.');}
}
