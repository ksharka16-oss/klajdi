export const money=(value,currency='EUR')=>new Intl.NumberFormat('it-IT',{style:'currency',currency}).format(Number(value||0));
export const monthKey=(date=new Date())=>date.toISOString().slice(0,7);
export function calculateSummary(transactions,invoices,month=monthKey()){
  const income=transactions.filter(t=>t.kind==='income'&&t.occurred_on?.startsWith(month)).reduce((s,t)=>s+Number(t.amount),0);
  const expenses=transactions.filter(t=>t.kind==='expense'&&t.occurred_on?.startsWith(month)).reduce((s,t)=>s+Number(t.amount),0);
  const balance=transactions.reduce((s,t)=>s+(t.kind==='income'?1:-1)*Number(t.amount),0);
  const unpaid=invoices.filter(i=>i.status==='to_pay'),review=invoices.filter(i=>i.status==='to_review');
  return{income,expenses,balance,unpaid,review,savings:income-expenses};
}
export function spendingInsights(transactions,month=monthKey()){
  const[year,number]=month.split('-').map(Number),previous=new Date(Date.UTC(year,number-2,1)).toISOString().slice(0,7),expenses=transactions.filter(row=>row.kind==='expense');
  const current=expenses.filter(row=>row.occurred_on?.startsWith(month)),previousRows=expenses.filter(row=>row.occurred_on?.startsWith(previous)),currentTotal=current.reduce((sum,row)=>sum+Number(row.amount),0),previousTotal=previousRows.reduce((sum,row)=>sum+Number(row.amount),0),groups=new Map();
  for(const row of current){const name=row.categories?.name||'Senza categoria';groups.set(name,(groups.get(name)||0)+Number(row.amount))}
  const categories=[...groups].map(([name,amount])=>({name,amount,percentage:currentTotal?amount/currentTotal*100:0})).sort((left,right)=>right.amount-left.amount);
  return{month,previous,currentTotal,previousTotal,difference:currentTotal-previousTotal,categories,top:categories[0]||null}
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

const normalizedHeader=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function csvCells(line,delimiter){
  const cells=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){const char=line[i];if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(char===delimiter&&!quoted){cells.push(value.trim());value=''}else value+=char}
  cells.push(value.trim());return cells
}
function bankDate(value){
  const text=String(value||'').trim(),iso=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/),it=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  const parts=iso?[iso[1],iso[2],iso[3]]:it?[it[3],it[2],it[1]]:null;if(!parts)return null;
  const result=`${parts[0]}-${String(parts[1]).padStart(2,'0')}-${String(parts[2]).padStart(2,'0')}`;return Number.isNaN(Date.parse(`${result}T00:00:00Z`))?null:result
}
function bankAmount(value){
  let text=String(value||'').replace(/[€\s]/g,'').trim();if(!text)return null;
  if(text.includes(',')&&text.includes('.'))text=text.lastIndexOf(',')>text.lastIndexOf('.')?text.replace(/\./g,'').replace(',','.'):text.replace(/,/g,'');else if(text.includes(','))text=text.replace(',','.');
  const amount=Number(text.replace(/[^0-9+.-]/g,''));return Number.isFinite(amount)&&amount!==0?amount:null
}
export function parseBankCsv(text=''){
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());if(lines.length<2)return{rows:[],error:'Il file CSV non contiene movimenti.'};
  const first=lines[0],delimiter=first.includes('\t')?'\t':(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?';':',';
  const headers=csvCells(first,delimiter).map(normalizedHeader),find=(names)=>headers.findIndex(header=>names.some(name=>header===name||header.includes(name)));
  const dateIndex=find(['data contabile','data operazione','data valuta','data']),descriptionIndex=find(['descrizione','causale','dettagli','operazione']),amountIndex=find(['importo','ammontare']),debitIndex=find(['uscite','addebiti','dare']),creditIndex=find(['entrate','accrediti','avere']);
  if(dateIndex<0||descriptionIndex<0||(amountIndex<0&&debitIndex<0&&creditIndex<0))return{rows:[],error:'Servono le colonne Data, Descrizione/Causale e Importo oppure Entrate/Uscite.'};
  const rows=[];
  for(const line of lines.slice(1)){const cells=csvCells(line,delimiter),occurred_on=bankDate(cells[dateIndex]),description=String(cells[descriptionIndex]||'').trim();let raw=amountIndex>=0?bankAmount(cells[amountIndex]):null,kind=raw!=null&&raw<0?'expense':'income';if(raw==null&&debitIndex>=0){raw=bankAmount(cells[debitIndex]);if(raw!=null)kind='expense'}if(raw==null&&creditIndex>=0){raw=bankAmount(cells[creditIndex]);if(raw!=null)kind='income'}if(occurred_on&&description&&raw!=null)rows.push({occurred_on,description,amount:Math.abs(raw),kind})}
  return rows.length?{rows}:{rows:[],error:'Non ho trovato righe valide nel file.'}
}
