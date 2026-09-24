const tidy=value=>String(value||'').replace(/\s+/g,' ').trim();
const isoDate=value=>{const match=String(value||'').match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);if(!match)return null;const[,day,month,year]=match;return`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`};
const amountValue=value=>{const normalized=String(value||'').replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');const number=Number(normalized);return Number.isFinite(number)&&number>0?number:null};
const firstMatch=(text,patterns)=>{for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return tidy(match[1])}return null};
const ignoredHeading=/^(?:fattura|bolla|documento(?:\s+di\s+trasporto)?|ddt|d\.d\.t\.|ricevuta|destinatario|cliente|spett(?:abile)?|pagina|data|numero|codice|partita\s+iva)\b/i;
const supplierFromHeading=text=>String(text||'').split('\n').map(tidy).find(line=>line.length>=4&&line.length<=100&&/[a-zà-ÿ]{3}/i.test(line)&&!ignoredHeading.test(line)&&!/^\d/.test(line))||null;

export function parseInvoiceText(rawText){
  const text=String(rawText||'').replace(/\r/g,'\n'),singleLine=text.replace(/\s+/g,' ');
  const supplier=firstMatch(text,[/(?:fornitore|emittente|ragione\s+sociale|mittente|cedente|ente\s+creditore|intestato\s+a)\s*[:\-]?\s*([^\n]{3,100})/i])||supplierFromHeading(text);
  const amount=amountValue(firstMatch(singleLine,[/\b(?:TOTALE\s+(?:DA\s+PAGARE|DOVUTO|FATTURA|DOCUMENTO|RETTA|NETTO)|IMPORTO\s+(?:TOTALE|DA\s+PAGARE)|TOTALE)\D{0,25}(?:€\s*)?(\d[\d.\s]*[,.]\d{2})/i,/(?:€\s*)?(\d[\d.\s]*[,.]\d{2})\s+(?:TOTALE(?:\s+(?:RETTA|DA\s+PAGARE|DOVUTO|FATTURA|DOCUMENTO))?|IMPORTO\s+TOTALE)\b/i,/€\s*(\d[\d.\s]*[,.]\d{2})/i,/\b(?:EUR|EURO)\s*(\d[\d.\s]*[,.]\d{2})/i]));
  const paymentReferences=[...singleLine.matchAll(/(?:oggetto\s+(?:del\s+)?pagamento|pagamento\s+sollecito)\D{0,45}\bN[.°º]?\s*([A-Z0-9/_-]{4,40})/gi)].map(match=>tidy(match[1])).sort((a,b)=>b.replace(/\D/g,'').length-a.replace(/\D/g,'').length);
  const invoiceNumber=paymentReferences[0]||firstMatch(singleLine,[/(?:numero\s+fattura|n[.°º]\s*fattura|fattura\s+n[.°º]?)\s*[:\-]?\s*([A-Z0-9/_-]{2,40})/i,/(?:ddt|d\.d\.t\.|bolla)\s*(?:n(?:umero)?[.°º]?)?\s*[:\-]?\s*([A-Z0-9/_-]{2,40})/i,/(?:numero\s+documento|documento(?:\s+di\s+trasporto)?\s+n(?:umero)?[.°º]?)\s*[:\-]?\s*([A-Z0-9/_-]{2,40})/i]);
  const noticeCodes=[...singleLine.matchAll(/\b((?:\d{4}\s+){4}\d{2})\b/g)].map(match=>match[1]),iuvText=firstMatch(singleLine,[/\bIUV\s*[:\-]?\s*([0-9 ]{12,25})/i,/\b([0-9 ]{12,25})\s+CODICE\s+IUV\b/i])||noticeCodes.at(-1)||firstMatch(singleLine,[/\bCODICE\s+AVVISO\s*[:\-]?\s*([0-9 ]{16,25})/i]),iuv=iuvText?.replace(/\s/g,'')||null;
  const creditorTaxId=firstMatch(singleLine,[/(?:cod(?:ice)?\.?\s*fiscale\s+(?:dell['’]?\s*)?ente\s+creditore|c\.?\s*f\.?\s*ente\s+creditore)\s*[:\-]?\s*(\d{11})/i]);
  const issuedOn=isoDate(firstMatch(singleLine,[/(?:data\s+(?:documento|emissione|ddt|bolla)|emess[ao]\s+il)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i,/(?:\bddt\b|\bbolla\b|documento\s+di\s+trasporto)\D{0,60}\bdata\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i,/\bdata\s*[:\-]\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i]));
  const dueOn=isoDate(firstMatch(singleLine,[/(?:scadenza|pagare\s+entro|entro\s+il)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i]));
  const extracted={supplier,amount,invoice_number:invoiceNumber,iuv,creditor_tax_id:creditorTaxId,issued_on:issuedOn,due_on:dueOn};
  const found=Object.values(extracted).filter(Boolean).length;
  return{extracted,confidence:Math.min(.95,.25+found*.11)};
}

async function prepareImage(file){
  if(typeof createImageBitmap!=='function'||typeof document==='undefined')return file;
  let bitmap;
  try{
    bitmap=await createImageBitmap(file);
    const longest=Math.max(bitmap.width,bitmap.height),scale=longest<1800?Math.min(2,2200/Math.max(longest,1)):Math.min(1,2800/longest),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.filter='grayscale(1) contrast(1.25)';context.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas;
  }catch{return file}finally{bitmap?.close?.()}
}

function rotateImage(source,direction){
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{alpha:false});canvas.width=source.height;canvas.height=source.width;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.translate(canvas.width/2,canvas.height/2);context.rotate(direction*Math.PI/2);context.drawImage(source,-source.width/2,-source.height/2);return canvas
}
function paymentDetails(source){
  const sx=Math.round(source.width*.68),sy=Math.round(source.height*.08),sw=Math.max(1,source.width-sx),sh=Math.max(1,Math.round(source.height*.27)),scale=2.5,canvas=document.createElement('canvas');canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.filter='grayscale(1) contrast(1.2)';context.drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height);return canvas
}
function paymentCodeDetails(source){
  const sx=Math.round(source.width*.25),sy=Math.round(source.height*.62),sw=Math.max(1,Math.round(source.width*.52)),sh=Math.max(1,Math.round(source.height*.22)),scale=2.5,canvas=document.createElement('canvas');canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.filter='grayscale(1) contrast(1.2)';context.drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height);return canvas
}
const recognitionScore=result=>{const fields=Object.values(parseInvoiceText(result.data.text).extracted).filter(Boolean).length,markers=(result.data.text.match(/fattura|totale|scadenza|codice\s+avviso|bollettino|ente\s+creditore|euro/gi)||[]).length;return Number(result.data.confidence||0)+fields*18+Math.min(markers,8)*3};

async function recognizeImages(images,onProgress){
  const{createWorker,PSM}=await import('tesseract.js');
  const worker=await createWorker('ita+eng',1,{logger:event=>{if(event.progress)onProgress?.(Math.round(event.progress*100),event.status)}});
  try{const parts=[];for(let index=0;index<images.length;index++){onProgress?.(0,'Pagina '+(index+1)+' di '+images.length);const image=typeof File!=='undefined'&&images[index] instanceof File?await prepareImage(images[index]):images[index];let best=await worker.recognize(image,{rotateAuto:true}),bestImage=image;const fields=Object.values(parseInvoiceText(best.data.text).extracted).filter(Boolean).length;if(typeof HTMLCanvasElement!=='undefined'&&image instanceof HTMLCanvasElement&&(fields<3||Number(best.data.confidence||0)<60)){for(const direction of[-1,1]){onProgress?.(0,'Controllo orientamento');const candidateImage=rotateImage(image,direction),candidate=await worker.recognize(candidateImage);if(recognitionScore(candidate)>recognitionScore(best)){best=candidate;bestImage=candidateImage}}}let text=best.data.text;const paymentDocument=typeof HTMLCanvasElement!=='undefined'&&bestImage instanceof HTMLCanvasElement&&/(?:codice\s+avviso|bollettino|ente\s+creditore)/i.test(text);if(paymentDocument){if(!/(?:€|EUR|EURO)\s*\d[\d.\s]*[,.]\d{2}/i.test(text)){onProgress?.(0,'Leggo importo e scadenza');const details=await worker.recognize(paymentDetails(bestImage),{tessedit_pageseg_mode:PSM.SINGLE_BLOCK});text+='\n'+details.data.text}onProgress?.(0,'Verifico codice avviso');const codes=await worker.recognize(paymentCodeDetails(bestImage),{tessedit_pageseg_mode:PSM.SINGLE_BLOCK});text+='\n'+codes.data.text}parts.push(text)}return parts.join('\n')}finally{await worker.terminate()}
}

async function readPdf(file,onProgress){
  const pdfjs=await import('pdfjs-dist/build/pdf.mjs');
  const workerUrl=(await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise,pages=Math.min(pdf.numPages,5),textParts=[];
  for(let pageNumber=1;pageNumber<=pages;pageNumber++){const page=await pdf.getPage(pageNumber),content=await page.getTextContent();textParts.push(content.items.map(item=>item.str).join(' '))}
  const embedded=textParts.join('\n').trim();
  if(embedded.length>80)return embedded;
  const images=[];
  for(let pageNumber=1;pageNumber<=Math.min(pages,3);pageNumber++){onProgress?.(0,`Preparo pagina ${pageNumber}`);const page=await pdf.getPage(pageNumber),viewport=page.getViewport({scale:1.6}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;images.push(canvas)}
  return recognizeImages(images,onProgress);
}

export async function extractInvoiceDocument(file,onProgress){
  onProgress?.(0,'Avvio analisi');
  const rawText=file.type==='application/pdf'?await readPdf(file,onProgress):await recognizeImages([file],onProgress),text=rawText.slice(0,100000);
  const parsed=parseInvoiceText(text);
  return{text,...parsed};
}
