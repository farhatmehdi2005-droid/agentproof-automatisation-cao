import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAutomationReport,automationMarkdown} from '../src/automation-report.mjs';
const proof={session_id:'session-h',agent_view_url:'https://platform.hcompany.ai/agents/sessions/session-h',environment:'Démo fictive',execution:{outcome:'confirmed',last_step:'confirmation',summary:'Message visible.',order_reference:'',observations:['Confirmation visible']},screenshots:['capture.png']};
test('Une confirmation UI ne devient jamais une preuve bancaire',()=>{const r=buildAutomationReport(proof,null);assert.equal(r.bank_payment_verified,false);assert.equal(r.proof_level,'ui_only');assert.equal(r.checkout_outcome,'confirmed');});
test('Une preuve réutilisée reste identifiée dans le rapport',()=>{const r=buildAutomationReport(proof,null,{executionOrigin:'reused'});assert.match(automationMarkdown(r),/aucune nouvelle exécution/i);assert.equal(r.execution_origin,'reused');});
test('Les références inventées ne deviennent pas des preuves valides',()=>{const analysis={summary:'Analyse',findings:[{observation:'Constate',hypothesis:'Possible',next_check:'Vérifier',evidence_ids:['T01','C01','C99']}]};const r=buildAutomationReport(proof,analysis);assert.deepEqual(r.analysis.findings[0].evidence_ids,['T01','C01']);assert.deepEqual(r.invalid_evidence_references,['C99']);});
test('Un résultat de testeur invalide bloque la génération du rapport',()=>{assert.throws(()=>buildAutomationReport({...proof,execution:{outcome:'paid'}},null),/invalide/);});
