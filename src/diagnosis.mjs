// Classification déterministe : les textes de l'IA ne peuvent pas modifier ces faits.
export function diagnose(events){
 const has=t=>events.some(e=>e.type===t);
 const viewed=has('payment.viewed')||events.some(e=>e.type==='step.viewed'&&e.step==='payment');
 const submitted=has('payment.submitted');const created=submitted&&viewed&&(has('order.created')||has('order.confirmed'));
 const block=events.findLast(e=>e.type==='shipping.blocked');const timed=has('checkout.timeout');
 let status='inconclusive',block_type=block?'unknown':null;
 if(block?.intentional===true&&block.reason==='payment_step_disabled_in_sandbox')block_type='sandbox_limitation';
 else if(block?.intentional===false&&block.reason==='unexpected_frontend_error')block_type='technical_error';
 else if(block?.reason==='missing_configuration')block_type='configuration';
 else if(timed)block_type='timeout';
 else if(has('checkout.error'))block_type='technical_error';
 if(viewed&&submitted&&created)status='success';
 else if(viewed&&submitted&&(has('payment.failed')||has('payment.declined')))status='payment_failed';
 else if(block_type==='technical_error'||has('checkout.error'))status='failed';
 const state=events.filter(e=>e.type==='checkout.state').at(-1);
 // Anciennes traces : un blocage seul ne prouve pas un problème UX.
 const ux=Boolean(block&&state?.state==='processing'&&Date.parse(state.timestamp)<=Date.parse(block.timestamp));
 return {status,payment_tested:viewed&&submitted,payment_reached:viewed,payment_submitted:submitted,order_created:created,block_detected:Boolean(block||timed||has('checkout.error')),block_type,diagnostic_confidence:block_type==='unknown'?'non vérifié':'élevé',ux_processing_stuck:ux,
 conclusion:!viewed&&!submitted?"Le parcours s’est arrêté avant le paiement. Aucun défaut du module de paiement ne peut être confirmé.":created?"Le simulateur a créé une commande après soumission. Aucun débit bancaire réel n’a été testé.":"Le paiement simulé a été atteint ; seuls les événements enregistrés permettent de qualifier son résultat."};
}
