export const money=(value,currency='EUR')=>new Intl.NumberFormat('it-IT',{style:'currency',currency}).format(Number(value||0));
export function transactionsCsv(rows=[],accounts=[]){
  const sourceLabels={manual:'Manuale',bank:'Banca',invoice:'Fattura',email:'Gmail',import:'Importazione'},cell=value=>`"${String(value??'').replaceAll('"','""')}"`,headers=['Data','Tipo','Descrizione','Categoria','Conto','IBAN finale','Importo','Valuta','Origine','Note'];
  const body=rows.map(row=>{const account=accounts.find(item=>String(item.id)===String(row.account_id)),type=row.is_transfer?'Trasferimento':row.kind==='income'?'Entrata':'Spesa',signed=(row.kind==='income'?1:-1)*Number(row.amount||0);return[row.occurred_on||'',type,row.description||'',row.is_transfer?'Trasferimento tra conti':row.categories?.name||'Senza categoria',account?.institution||account?.name||'',account?.iban_last4||'',signed.toFixed(2).replace('.',','),row.currency||'EUR',sourceLabels[row.source]||'Registrato',row.notes||''].map(cell).join(';')});
  return `\uFEFF${headers.map(cell).join(';')}\r\n${body.join('\r\n')}`
}
export const monthKey=(date=new Date())=>date.toISOString().slice(0,7);
export function calculateSummary(transactions,invoices,month=monthKey()){
  const financial=transactions.filter(t=>!t.is_transfer),income=financial.filter(t=>t.kind==='income'&&t.occurred_on?.startsWith(month)).reduce((s,t)=>s+Number(t.amount),0);
  const expenses=financial.filter(t=>t.kind==='expense'&&t.occurred_on?.startsWith(month)).reduce((s,t)=>s+Number(t.amount),0);
  const balance=transactions.reduce((s,t)=>s+(t.kind==='income'?1:-1)*Number(t.amount),0);
  const unpaid=invoices.filter(i=>i.status==='to_pay'),review=invoices.filter(i=>i.status==='to_review');
  return{income,expenses,balance,unpaid,review,savings:income-expenses};
}
export function invoiceDueState(dueOn,today=new Date().toISOString().slice(0,10)){
  if(!dueOn)return{key:'no_date',label:'Senza data',days:null};
  const due=Date.parse(`${dueOn}T00:00:00Z`),now=Date.parse(`${today}T00:00:00Z`);if(Number.isNaN(due)||Number.isNaN(now))return{key:'no_date',label:'Senza data',days:null};
  const days=Math.round((due-now)/86400000);if(days<0)return{key:'overdue',label:`Scaduta da ${Math.abs(days)} ${Math.abs(days)===1?'giorno':'giorni'}`,days};if(days===0)return{key:'today',label:'Scade oggi',days};if(days<=7)return{key:'soon',label:`Scade tra ${days} ${days===1?'giorno':'giorni'}`,days};return{key:'later',label:`Scade tra ${days} giorni`,days}
}
export function pagopaPaymentData(invoice={}){
  const extracted=invoice.extracted_data||{},noticeCode=String(invoice.iuv||extracted.iuv||extracted.notice_code||'').replace(/\D/g,''),ocrText=String(invoice.ocr_text||''),labeledTaxId=ocrText.match(/(?:cod(?:ice)?\.?\s*fiscale\s+(?:dell['’]?\s*)?ente\s+creditore|c\.?\s*f\.?\s*ente\s+creditore)\s*[:\-]?\s*(\d{11})/i)?.[1],creditorTaxId=String(extracted.creditor_tax_id||extracted.creditor_fiscal_code||labeledTaxId||'').replace(/\D/g,'');
  if(noticeCode.length<15||noticeCode.length>18)return null;
  return{noticeCode,creditorTaxId:creditorTaxId.length===11?creditorTaxId:'',amount:Number(invoice.amount||extracted.amount||0)}
}
export function bankBalanceSummary(accounts=[]){
  const unique=new Map();for(const[index,account]of accounts.filter(account=>account.external_provider==='enablebanking').entries()){const institution=String(account.institution||account.name||'').trim().toLocaleLowerCase('it-IT'),key=institution&&account.iban_last4?`${institution}:${account.iban_last4}`:account.id||`row:${index}`,previous=unique.get(key);if(!previous||String(account.updated_at||'')>String(previous.updated_at||''))unique.set(key,account)}
  const connected=[...unique.values()],eur=connected.filter(account=>(account.currency||'EUR').toUpperCase()==='EUR'),total=eur.reduce((sum,account)=>sum+Number(account.current_balance||0),0);
  return{accounts:connected,total,currency:'EUR'};
}
export function bankTransactionsForAccount(transactions=[],accountId='all'){
  return accountId==='all'?transactions:transactions.filter(transaction=>transaction.account_id===accountId);
}
export function spendingInsights(transactions,month=monthKey()){
  const[year,number]=month.split('-').map(Number),previous=new Date(Date.UTC(year,number-2,1)).toISOString().slice(0,7),expenses=transactions.filter(row=>row.kind==='expense'&&!row.is_transfer);
  const current=expenses.filter(row=>row.occurred_on?.startsWith(month)),previousRows=expenses.filter(row=>row.occurred_on?.startsWith(previous)),currentTotal=current.reduce((sum,row)=>sum+Number(row.amount),0),previousTotal=previousRows.reduce((sum,row)=>sum+Number(row.amount),0),groups=new Map();
  for(const row of current){const name=row.categories?.name||'Senza categoria';groups.set(name,(groups.get(name)||0)+Number(row.amount))}
  const categories=[...groups].map(([name,amount])=>({name,amount,percentage:currentTotal?amount/currentTotal*100:0})).sort((left,right)=>right.amount-left.amount);
  return{month,previous,currentTotal,previousTotal,difference:currentTotal-previousTotal,categories,top:categories[0]||null}
}
export function budgetProgress(transactions,budgets,month=monthKey()){
  return budgets.map(budget=>{const spent=transactions.filter(row=>row.kind==='expense'&&!row.is_transfer&&row.category_id===budget.category_id&&row.occurred_on?.startsWith(month)).reduce((sum,row)=>sum+Number(row.amount),0),limit=Number(budget.monthly_limit),percentage=limit?spent/limit*100:0;return{...budget,spent,limit,remaining:Math.max(0,limit-spent),percentage,status:percentage>=100?'exceeded':percentage>=80?'warning':'ok'}})
}
export function uncategorizedBankTransactions(transactions=[]){
  return transactions.filter(row=>row.source==='bank'&&!row.is_transfer&&!row.transfer_status&&!row.category_id)
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
