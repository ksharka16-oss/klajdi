export const cleanBankText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const supplierWords=value=>cleanBankText(value).split(' ').filter(word=>word.length>3&&!['comune','pagamento','bonifico','addebito','fattura'].includes(word));
const distanceInDays=(left,right)=>right?Math.abs((Date.parse(left)-Date.parse(right))/86400000):999;
export function bankMatchConfidence(invoice,row){
  if(row.kind!=='expense'||Math.abs(Number(invoice.amount)-Number(row.amount))>=0.01||distanceInDays(row.occurred_on,invoice.due_on??invoice.issued_on)>45)return 0;
  const description=cleanBankText(row.description),digits=description.replace(/\D/g,''),iuv=String(invoice.iuv??'').replace(/\D/g,''),tokens=supplierWords(invoice.supplier);
  if((iuv.length>=8&&digits.includes(iuv))||(tokens.length>0&&tokens.filter(word=>description.includes(word)).length>=Math.min(2,tokens.length)))return 1;
  return .8
}
