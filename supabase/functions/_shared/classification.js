export function classifyEmail(subject='',sender='',snippet='',files=[]){
  const text=`${subject} ${sender} ${snippet}`.toLowerCase();
  if(/newsletter|unsubscribe|promozion|offerta|sconto|marketing|pubblicit/.test(text))return'ignore';
  if(/pagamento (ricevuto|avvenuto|confermato)|conferma (del )?pagamento|payment confirmation/.test(text))return'payment_confirmation';
  if(/pagopa|\biuv\b/.test(text))return'pagopa';
  const financialFile=files.some(name=>/\.(pdf|jpg|jpeg|png|webp)$/i.test(name));
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

export function financialStatus(classification='',subject='',sender='',snippet='',files=[]){
  if(['receipt','payment_confirmation'].includes(classification))return'paid';
  if(['invoice','pagopa'].includes(classification))return'to_pay';
  const text=`${subject} ${sender} ${snippet}`.toLowerCase();
  const financialFile=files.some(name=>/\.(pdf|jpg|jpeg|png|webp)$/i.test(name));
  if(classification==='financial_document'&&financialFile&&strongInvoiceSignals(text)>=3)return'to_review';
  return null;
}

export function gmailRollingRange(now=new Date(),days=30){
  const day=now.toISOString().slice(0,10);
  return{window:`last-${days}-days:${day}`,query:`newer_than:${days}d`};
}
