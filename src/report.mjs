import {diagnose} from './diagnosis.mjs';
import {scenarios,steps,outcomes} from './scenarios.mjs';
export const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const redact = value => String(value??'').replace(/\bhk-[\w-]+\b/g,'[CLÉ MASQUÉE]').replace(/\b(?:\d[ -]?){13,19}\b/g,'[NUMÉRO MASQUÉ]');
export function validExecutor(value){
  return value && typeof value==='object' && outcomes.includes(value.outcome) && steps.includes(value.last_step) && typeof value.summary==='string' && value.summary.length<10000 && typeof value.order_reference==='string' && Array.isArray(value.observations) && value.observations.length<=30 && value.observations.every(x=>typeof x==='string'&&x.length<4000);
}
export function observedResult(events){
  if(diagnose(events).status==='success') return {outcome:'confirmed',step:'confirmation'};
  if(diagnose(events).status==='payment_failed') return {outcome:'declined',step:'payment'};
  if(events.some(e=>e.type==='authentication.required')) return {outcome:'requires_human',step:'payment'};
  if(events.some(e=>e.type==='payment.unknown')) return {outcome:'inconclusive',step:'payment'};
  if(events.some(e=>e.type==='shipping.blocked')) return {outcome:'blocked',step:'shipping'};
  const last=events.filter(e=>e.type==='step.viewed').at(-1);
  return {outcome:'inconclusive',step:last?.step??'product'};
}
export function buildReport(run){
  const observed=observedResult(run.telemetry);
  const expected=scenarios[run.scenario].expected;
  const last=run.telemetry.filter(e=>!['step.viewed','cart.added','shipping.saved','checkout.state'].includes(e.type)).at(-1);
  const contradiction=Boolean(run.execution && run.execution.outcome!==observed.outcome && !(['blocked','inconclusive'].includes(run.execution.outcome)&&['blocked','inconclusive'].includes(observed.outcome)));
  const diagnosis=diagnose(run.telemetry);
  const assessment=run.infrastructureError?'inconclusive':observed.outcome===expected?'matched':observed.outcome==='inconclusive'?'inconclusive':'mismatched';
  const defaultHypothesis=diagnosis.block_type==='sandbox_limitation'?'Limitation volontaire confirmée par intentional=true et reason=payment_step_disabled_in_sandbox. Aucun défaut de paiement démontré.':diagnosis.block_type==='technical_error'?'Erreur technique simulée confirmée ; aucune cause sur un site réel n’est établie.':observed.outcome==='blocked'?'La validation de livraison semble empêcher la transition. La cause racine reste à confirmer.':observed.outcome==='inconclusive'?'Les éléments disponibles ne permettent pas de conclure au résultat du paiement.':'Aucune cause de panne établie.';
  const allowedEvidence=new Set(run.telemetry.map(e=>e.id));
  const analysis=run.analysis?{...run.analysis,confidence:'non vérifié',findings:run.analysis.findings.map(f=>({...f,evidence_ids:f.evidence_ids.filter(id=>allowedEvidence.has(id))}))}:null;
  return {...diagnosis,sandbox:run.sandbox??null,id:run.id,created_at:run.createdAt,completed_at:new Date().toISOString(),mode:run.mode,scenario:run.scenario,scenario_label:scenarios[run.scenario].label,environment:'Boutique fictive, simulateur maison. Aucun débit et aucune connexion à un PSP.',outcome:observed.outcome,last_step:observed.step,expected_outcome:expected,assessment,contradiction,summary:last?.message??'Aucune preuve suffisante pour conclure.',order_reference:run.telemetry.find(e=>e.type==='order.confirmed')?.reference??null,execution:run.execution??null,analysis,hypothesis:defaultHypothesis,evidence:run.telemetry.map(e=>({...e,message:redact(e.message)})),screenshots:run.screenshots??[],sessions:run.sessions??[],warnings:[...(run.warnings??[]),...(contradiction?['Le compte rendu du testeur contredit le journal de la boutique. Le rapport conserve ce dernier comme résultat de référence du simulateur.']:[])],infrastructure_error:run.infrastructureError??null,duration_s:Math.round((Date.now()-Date.parse(run.createdAt))/1000),limits:['Le résultat concerne ce scénario dans cette boutique fictive.','La confirmation provient du simulateur maison, sans preuve de débit bancaire.','Le diagnostic local est déterministe. Seul le mode H Company utilise des agents IA.']};
}
export function markdownReport(r){
 const yn=v=>v?'oui':'non';
 return `# Rapport de test du checkout

## Résumé
Statut global : ${r.status}
Étape maximale atteinte : ${r.last_step}
Paiement testé : ${yn(r.payment_tested)}
Commande créée : ${yn(r.order_created)}
Blocage détecté : ${yn(r.block_detected)}
Type de blocage : ${r.block_type??'aucun'}
Confiance du diagnostic : ${r.diagnostic_confidence}
Problème UX de traitement permanent : ${r.ux_processing_stuck?'confirmé par la télémétrie':'non démontré dans ce test'}

## Parcours observé
${r.evidence.filter(e=>e.type==='step.viewed').map((e,i)=>`${i+1}. ${e.step}`).join('\n')}

## Événements de preuve
${r.evidence.map(e=>`- ${e.id} — ${e.type} — ${e.step??'non renseignée'} — ${e.timestamp??'non renseigné'} — ${e.message} — ${JSON.stringify({reason:e.reason,intentional:e.intentional,source:e.source,state:e.state})}`).join('\n')}

## Diagnostic principal
${r.summary}
${r.conclusion}

## Hypothèses
Confiance : non vérifié. ${r.hypothesis}
${r.analysis?`Analyse IA non vérifiée (ne remplace pas le journal) : ${r.analysis.summary}\n`+r.analysis.findings.map(f=>`- Confiance : non vérifié. Observation déclarée : ${f.observation}. Hypothèse : ${f.hypothesis}. Vérification : ${f.next_check}. Preuves : ${f.evidence_ids.join(', ')}`).join('\n'):'Analyse IA non exécutée.'}

## Problèmes détectés
- Paiement : ${r.status==='payment_failed'?'refus simulé confirmé':'défaut non démontré'}.
- Frontend / UX : ${r.ux_processing_stuck?'traitement permanent confirmé':'traitement permanent non démontré'}.
- Sandbox / configuration : ${r.block_type??'aucun blocage établi'}.
- Performance : ${r.block_type==='timeout'?'délai dépassé':'aucun dépassement établi'}.
- Données de test : synthétiques, sans carte.

## Limites du test
${r.limits.map(x=>'- '+x).join('\n')}
- Étape paiement atteinte : ${yn(r.payment_reached)}. Soumission : ${yn(r.payment_submitted)}.
- Autorisation du paiement dans le sandbox : ${r.block_type==='sandbox_limitation'?'désactivé explicitement pour ce test':'non déduite de la seule absence de paiement'}.
- Étapes non testées : ${r.payment_reached?'aucune opération bancaire réelle':'paiement et confirmation'}.
${r.warnings.join('\n')}

## Recommandations
1. ${r.block_type==='sandbox_limitation'?'Activer le paiement simulé ou choisir un scénario disponible pour tester le paiement.':r.block_detected?'Examiner les événements et la configuration avant une nouvelle tentative.':'Tester ensuite un refus et une erreur avant paiement.'}
2. Ne jamais resoumettre un paiement dont le résultat est incertain.

## Conclusion
${r.conclusion}
${r.infrastructure_error??''}
`;
}
