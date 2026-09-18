export function classifyEmail(subject='',sender='',snippet='',files=[]){
  const text=`${subject} ${sender} ${snippet}`.toLowerCase();
  if(/attestazione di pagamento contestata/.test(text)&&/inps/.test(text))return'ignore';
  if(/la tua fattura da apple/.test(text)&&/email\.apple\.com/.test(text))return'receipt';
  if(/ricevuta dell['’]ordine google play/.test(text)&&/googleplay-noreply@google\.com/.test(text))return'receipt';
  if(/asilinido@comune\.paderno-dugnano\.mi\.it/.test(text)&&/asili nido|quietanz|fattur|pagamento/.test(text))return'financial_document';
  if(/newsletter|unsubscribe|promozion|offerta|sconto|marketing|pubblicit/.test(text))return'ignore';
  if(familyPaymentSignals(text))return'financial_document';
  if(/pagamento (ricevuto|avvenuto|confermato)|conferma (del )?pagamento|payment confirmation/.test(text))return'payment_confirmation';
  const financialFile=files.some(name=>/\.(pdf|jpg|jpeg|png|webp)$/i.test(name));
  if(/\biuv\D{0,20}\d{10,35}/.test(text)||(financialFile&&/pagopa/.test(text)&&strongInvoiceSignals(text)>=2))return'pagopa';
  if(financialFile&&/ricevuta|scontrino|receipt/.test(text))return'receipt';
  if(financialFile&&/fattura|invoice|bolletta/.test(text))return'invoice';
  if(financialFile&&strongInvoiceSignals(text)>=3)return'financial_document';
  if(/estratto conto|rendiconto|documento finanziario|statement/.test(text))return'financial_document';
  return'normal';
}

function strongInvoiceSignals(text=''){
  return[
    /scadenza|da pagare|importo dovuto|totale dovuto/.test(text),
    /avviso di pagamento|documento contabile|utenza|fornitura/.test(text),
    /(?:€|eur)\s?\d|\d+[,.]\d{2}\s?(?:€|eur)/.test(text),
    /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(text),
  ].filter(Boolean).length;
}

function familyPaymentSignals(text=''){
  return/asilo|nido|mensa scolastica|retta scolastica|condominio|affitto|utenza domestica/.test(text)&&/retta|quota|bolletta|canone|da pagare|avviso di pagamento|scadenza|pagamento/.test(text);
}

export function financialStatus(classification='',subject='',sender='',snippet='',files=[]){
  if(['receipt','payment_confirmation'].includes(classification))return'paid';
  if(['invoice','pagopa'].includes(classification))return'to_pay';
  const text=`${subject} ${sender} ${snippet}`.toLowerCase();
  const financialFile=files.some(name=>/\.(pdf|jpg|jpeg|png|webp)$/i.test(name));
  if(classification==='financial_document'&&/asilinido@comune\.paderno-dugnano\.mi\.it/.test(text)&&/quietanz/.test(text)&&/bonus|inps|scaricare|gi[aà] pagat/.test(text))return null;
  if(classification==='financial_document'&&/asilinido@comune\.paderno-dugnano\.mi\.it/.test(text))return financialFile||/emissione bolletta|avviso di pagamento|retta del mese|importo dovuto|da pagare|scadenza/.test(text)?'to_pay':null;
  if(classification==='financial_document'&&familyPaymentSignals(text))return'to_pay';
  if(classification==='financial_document'&&financialFile&&strongInvoiceSignals(text)>=3)return'to_review';
  return null;
}

function normalizedAmount(value=''){
  const compact=value.replace(/\s/g,'');
  const decimal=compact.includes(',')?compact.replace(/\./g,'').replace(',','.'):compact;
  const amount=Number(decimal);
  return Number.isFinite(amount)&&amount>0?amount:null;
}

function isoDate(value=''){
  const match=value.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if(!match)return null;
  const [,day,month,year]=match,date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`))?null:date;
}

export function extractFinancialFields(subject='',sender='',snippet='',files=[]){
  const text=`${subject} ${snippet}`.replace(/\s+/g,' ').trim();
  const amountPattern='(?:[0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2}|[0-9]{1,6}[,.][0-9]{2})';
  const amountMatch=text.match(new RegExp(`(?:€|eur)\\s*(${amountPattern})|(${amountPattern})\\s*(?:€|eur)`,'i'));
  const dueMatch=text.match(/(?:scadenza|entro il|due date)\D{0,24}(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i);
  const iuvMatch=text.match(/\biuv\s*[:#-]?\s*([0-9]{10,35})/i);
  const numberMatch=text.match(/(?:fattura|invoice)\s*(?:n(?:umero)?\.?|#)?\s*[:#-]?\s*([a-z0-9][a-z0-9\/_-]{2,})/i);
  const namedSender=sender.replace(/<[^>]+>/g,'').replace(/["']/g,'').trim();
  const fallbackSender=(sender.match(/@([^>\s]+)/)?.[1]||'').split('.')[0];
  const result={
    supplier:namedSender||fallbackSender||null,
    amount:normalizedAmount(amountMatch?.[1]||amountMatch?.[2]||''),
    due_on:isoDate(dueMatch?.[1]||''),
    invoice_number:numberMatch?.[1]||null,
    iuv:iuvMatch?.[1]||null,
    attachment_names:files,
  };
  const useful=[result.amount,result.due_on,result.invoice_number,result.iuv].filter(Boolean).length;
  return{data:result,confidence:Math.min(.95,.45+useful*.12+(files.length?0.1:0))};
}

export function supportedFinancialAttachment(file={}){
  const mime=String(file.mimeType||file.mime_type||'').toLowerCase();
  const name=String(file.filename||file.file_name||'').toLowerCase();
  const size=Number(file.size||file.byte_size||0);
  const supported=['application/pdf','image/jpeg','image/png','image/webp'].includes(mime)||/\.(pdf|jpe?g|png|webp)$/.test(name);
  return supported&&size>=0&&size<=10485760;
}

const normalizedIdentifier=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function paymentInvoiceMatch(payment={},invoice={}){
  const paymentIuv=normalizedIdentifier(payment.iuv),invoiceIuv=normalizedIdentifier(invoice.iuv);
  const paymentNumber=normalizedIdentifier(payment.invoice_number),invoiceNumber=normalizedIdentifier(invoice.invoice_number);
  const paymentAmount=Number(payment.amount),invoiceAmount=Number(invoice.amount);
  const amountKnown=paymentAmount>0&&invoiceAmount>0,amountMatches=amountKnown&&Math.abs(paymentAmount-invoiceAmount)<0.01;
  if(amountKnown&&!amountMatches)return{matched:false,confidence:0,reason:'amount_conflict'};
  if(paymentIuv&&invoiceIuv&&paymentIuv===invoiceIuv)return{matched:true,confidence:amountMatches?1:.97,reason:'exact_iuv'};
  if(paymentNumber&&invoiceNumber&&paymentNumber===invoiceNumber&&amountMatches)return{matched:true,confidence:.98,reason:'exact_invoice_number_and_amount'};
  return{matched:false,confidence:0,reason:'insufficient_evidence'};
}

export function autoInvoiceCandidate(classification='',status='',data={},files=[]){
  const amount=Number(data.amount);
  const strongReference=Boolean(data.iuv||data.invoice_number||files.length);
  return status==='to_pay'&&['invoice','pagopa'].includes(classification)&&amount>0&&Boolean(data.supplier)&&strongReference;
}

export function paidExpenseCandidate(classification='',status='',data={}){
  const amount=Number(data.amount);
  return classification==='receipt'&&status==='paid'&&amount>0&&Boolean(data.supplier);
}

export function gmailRollingRange(now=new Date()){
  const month=now.toISOString().slice(0,7),[year,monthNumber]=month.split('-').map(Number);
  const previousDay=new Date(Date.UTC(year,monthNumber-1,0)).toISOString().slice(0,10).replace(/-/g,'/');
  return{window:`current-month-v3:${month}`,query:`after:${previousDay}`};
}
