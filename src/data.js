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
export const invoiceFileTypes=['application/pdf','image/jpeg','image/png','image/webp'];
export function validateInvoiceFile(file){
  if(!file)return'';
  if(!invoiceFileTypes.includes(file.type))return'Sono ammessi soltanto PDF, JPG, PNG e WEBP.';
  if(file.size>10485760)return'Il documento non può superare 10 MB.';
  return'';
}
export const storageFileName=name=>String(name||'documento').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'documento';
export function mergeFinancialExtractions(base={},results=[]){
  const extracted={...base},ordered=[...results].sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0));
  for(const result of ordered)for(const[key,value]of Object.entries(result.extracted||{}))if(value!=null&&value!==''&&(extracted[key]==null||extracted[key]===''))extracted[key]=value;
  return{extracted,confidence:Math.max(0,...ordered.map(result=>Number(result.confidence||0)))};
}
