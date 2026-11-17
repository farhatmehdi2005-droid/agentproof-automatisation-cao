export const scenarios = {
  success: {label:'Achat confirmé', description:'Le simulateur accepte le paiement et crée une commande.', expected:'confirmed'},
  decline: {label:'Paiement refusé', description:'Le simulateur retourne un refus attendu.', expected:'declined'},
  broken: {label:'Bouton de livraison bloqué', description:'Le parcours reste bloqué avant le paiement.', expected:'blocked'},
  technical: {label:'Erreur technique avant paiement', description:'Erreur technique explicitement simulée à la livraison.', expected:'blocked'},
  timeout: {label:'Réponse de paiement incertaine', description:'Le simulateur ne permet pas de connaître le résultat.', expected:'inconclusive'},
  challenge: {label:'Validation 3-D Secure', description:'Le parcours demande une intervention humaine.', expected:'requires_human'}
};
export const steps=['product','cart','shipping','payment','confirmation'];
export const outcomes=['confirmed','declined','blocked','requires_human','inconclusive'];
export function requireScenario(id){if(!Object.hasOwn(scenarios,id)) throw new Error('Scénario inconnu.');return scenarios[id];}
