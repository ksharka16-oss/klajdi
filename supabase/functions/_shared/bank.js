export const cleanBankText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const supplierWords=value=>cleanBankText(value).split(' ').filter(word=>word.length>3&&!['comune','pagamento','bonifico','addebito','fattura'].includes(word));
const distanceInDays=(left,right)=>right?Math.abs((Date.parse(left)-Date.parse(right))/86400000):999;
export function bankMatchConfidence(invoice,row){
  if(row.kind!=='expense'||Math.abs(Number(invoice.amount)-Number(row.amount))>=0.01||distanceInDays(row.occurred_on,invoice.due_on??invoice.issued_on)>45)return 0;
  const description=cleanBankText(row.description),digits=description.replace(/\D/g,''),iuv=String(invoice.iuv??'').replace(/\D/g,''),tokens=supplierWords(invoice.supplier);
  if((iuv.length>=8&&digits.includes(iuv))||(tokens.length>0&&tokens.filter(word=>description.includes(word)).length>=Math.min(2,tokens.length)))return 1;
  return .8
}

const utcDay=value=>Date.parse(`${String(value??'').slice(0,10)}T00:00:00Z`);
export function bankConsentReminder(connection={},today=''){
  if(connection.status!=='linked'||!connection.valid_until)return null;
  const remaining=Math.round((utcDay(connection.valid_until)-utcDay(today))/86400000);
  if(!Number.isFinite(remaining))return null;
  const bank=String(connection.institution_name||'La banca');
  if(remaining<0)return{title:'Collegamento bancario scaduto',body:`${bank} non si aggiorna più. Rinnova l’autorizzazione in SOLDI senza perdere i movimenti già importati.`};
  if(![14,7,3,1,0].includes(remaining))return null;
  if(remaining===0)return{title:'Collegamento bancario in scadenza oggi',body:`Rinnova oggi l’autorizzazione di ${bank} per continuare gli aggiornamenti automatici.`};
  return{title:'Rinnova il collegamento bancario',body:`L’autorizzazione di ${bank} scade tra ${remaining} ${remaining===1?'giorno':'giorni'}. Rinnovala in SOLDI.`};
}

export function bankCategoryName(row={}){
  const text=cleanBankText(row.description);
  if(row.kind==='income'){
    if(/stipendio|salary|emolument|competenze/.test(text))return'Stipendio';
    if(/rimborso|storno|cashback/.test(text))return'Rimborsi';
    return null
  }
  if(/asilo|nido|mensa|scuola|scolastic|retta/.test(text))return'Scuola e asilo';
  if(/enel|plenitude|a2a|hera|energia|luce|gas|acqua|bolletta|tim |vodafone|windtre|fastweb/.test(`${text} `))return'Bollette';
  if(/netflix|spotify|disney|amazon prime|apple\.com\/bill|google play|abbonamento/.test(text))return'Abbonamenti';
  if(/esselunga|conad|coop |lidl|eurospin|carrefour|aldi|supermercat|alimentari/.test(`${text} `))return'Alimentari';
  if(/carburante|benzina|diesel|q8|tamoil|telepass|autostrad|trenitalia|trasport|atm milano|eni station/.test(text))return'Trasporti';
  if(/farmacia|parafarmacia|medic|dentist|ospedal|sanitari/.test(text))return'Salute';
  if(/affitto|condominio|mutuo|ikea|leroy merlin|casa/.test(text))return'Casa';
  return null
}

export function ownTransferKey(description=''){
  const raw=String(description).toUpperCase().replace(/\s/g,''),iban=raw.match(/[A-Z]{2}\d{2}[A-Z0-9]{11,30}/)?.[0];
  if(iban)return`iban:${iban}`;
  const text=cleanBankText(description),card=text.match(/(?:carta|prepagata)\D{0,20}(\d{4})(?:\D|$)/)?.[1];
  return card?`card:${card}`:null
}
export function possibleOwnTransfer(row={},knownKeys=[]){
  if(row.reconciled||row.transfer_status==='confirmed'||row.transfer_status==='rejected')return false;
  const key=ownTransferKey(row.description);
  if(key&&knownKeys.includes(key))return true;
  return/giroconto|trasferimento tra conti|ricarica (?:carta|prepagata)/.test(cleanBankText(row.description))
}
export function ownTransferPairs(rows=[]){
  const available=rows.filter(row=>row.account_id&&!row.reconciled&&row.transfer_status!=='rejected'&&!row.is_transfer),used=new Set(),pairs=[];
  for(const outgoing of available.filter(row=>row.kind==='expense')){
    const candidates=available.filter(incoming=>incoming.kind==='income'&&incoming.account_id!==outgoing.account_id&&!used.has(incoming.id)&&Math.abs(Number(incoming.amount)-Number(outgoing.amount))<.01&&Math.abs((Date.parse(incoming.occurred_on)-Date.parse(outgoing.occurred_on))/86400000)<=3&&(possibleOwnTransfer(outgoing)||possibleOwnTransfer(incoming)));
    if(candidates.length===1&&!used.has(outgoing.id)){pairs.push([outgoing.id,candidates[0].id]);used.add(outgoing.id);used.add(candidates[0].id)}
  }
  return pairs
}
