export const money=(value,currency='EUR')=>new Intl.NumberFormat('it-IT',{style:'currency',currency}).format(Number(value||0));
export const monthKey=(date=new Date())=>date.toISOString().slice(0,7);
export function calculateSummary(transactions,invoices,month=monthKey()){
  const income=transactions.filter(t=>t.kind==='income'&&t.occurred_on?.startsWith(month)).reduce((s,t)=>s+Number(t.amount),0);
  const expenses=transactions.filter(t=>t.kind==='expense'&&t.occurred_on?.startsWith(month)).reduce((s,t)=>s+Number(t.amount),0);
  const balance=transactions.reduce((s,t)=>s+(t.kind==='income'?1:-1)*Number(t.amount),0);
  const unpaid=invoices.filter(i=>i.status==='to_pay'),review=invoices.filter(i=>i.status==='to_review');
  return{income,expenses,balance,unpaid,review,savings:income-expenses};
}
export const safeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
export function authCredentials(values={}){
  const email=String(values.email||'').trim(),password=String(values.password||'');
  return email&&password?{email,password}:{error:'Inserisci email e password.'};
}
export function authErrorMessage(message=''){
  const normalized=String(message).toLowerCase();
  if(normalized.includes('invalid login credentials'))return 'Email o password non corretti. Se è il primo accesso, premi “Crea account”.';
  if(normalized.includes('email not confirmed'))return 'Email non ancora confermata. Apri il messaggio ricevuto e conferma l’account.';
  if(normalized.includes('user already registered'))return 'Questa email è già registrata. Premi “Accedi”.';
  return message||'Non è stato possibile completare l’accesso.';
}
