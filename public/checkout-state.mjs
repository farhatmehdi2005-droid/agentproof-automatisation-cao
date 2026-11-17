export class CheckoutTransition {
 constructor({request,onState=()=>{},record=async()=>{},timeoutMs=12000}){Object.assign(this,{request,onState,record,timeoutMs});this.state='idle';this.attempted=false;}
 set(state,detail={}){this.state=state;this.onState(state,detail);void Promise.resolve(this.record({event:'checkout.state',state})).catch(()=>{});}
 async continue(){
  if(this.attempted)return;this.attempted=true;this.set('processing');
  const controller=new AbortController();let timer;
  try{
   const result=await Promise.race([this.request(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('Délai dépassé'),{name:'TimeoutError'}));},this.timeoutMs);})]);
   if(result.event==='shipping.blocked'){this.set('blocked',result);return;}
   if(result.event==='shipping.saved'&&result.nextStep==='payment'){this.set('payment');return;}
   throw Error('Transition vers le paiement non confirmée.');
  }catch(error){
   this.set('error',{timeout:error.name==='TimeoutError'});
   void Promise.resolve(this.record({event:error.name==='TimeoutError'?'checkout.timeout':'checkout.error',timeout_ms:this.timeoutMs})).catch(()=>{});
  }finally{clearTimeout(timer);}
 }
}
