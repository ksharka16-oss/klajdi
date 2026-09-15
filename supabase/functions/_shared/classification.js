export function classifyEmail(subject='',sender='',snippet='',files=[]){
  const text=`${subject} ${sender} ${snippet}`.toLowerCase();
  if(/newsletter|unsubscribe|promozion|offerta|sconto|marketing|pubblicit/.test(text))return'ignore';
  if(/pagamento (ricevuto|avvenuto|confermato)|conferma (del )?pagamento|payment confirmation/.test(text))return'payment_confirmation';
  if(/pagopa|\biuv\b/.test(text))return'pagopa';
  if(/ricevuta|scontrino|receipt/.test(text))return'receipt';
  const financialFile=files.some(name=>/\.(pdf|jpg|jpeg|png|webp)$/i.test(name));
  if(financialFile&&/fattura|invoice|bolletta/.test(text))return'invoice';
  if(/estratto conto|rendiconto|documento finanziario|statement/.test(text))return'financial_document';
  return'normal';
}

export function gmailRollingRange(now=new Date(),days=30){
  const day=now.toISOString().slice(0,10);
  return{window:`last-${days}-days:${day}`,query:`newer_than:${days}d`};
}
