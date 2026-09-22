const tidy=value=>String(value||'').replace(/\s+/g,' ').trim();
const isoDate=value=>{const match=String(value||'').match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);if(!match)return null;const[,day,month,year]=match;return`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`};
const amountValue=value=>{const normalized=String(value||'').replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');const number=Number(normalized);return Number.isFinite(number)&&number>0?number:null};
const firstMatch=(text,patterns)=>{for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return tidy(match[1])}return null};
const ignoredHeading=/^(?:fattura|bolla|documento(?:\s+di\s+trasporto)?|ddt|d\.d\.t\.|ricevuta|destinatario|cliente|spett(?:abile)?|pagina|data|numero|codice|partita\s+iva)\b/i;
const supplierFromHeading=text=>String(text||'').split('\n').map(tidy).find(line=>line.length>=4&&line.length<=100&&/[a-zà-ÿ]{3}/i.test(line)&&!ignoredHeading.test(line)&&!/^\d/.test(line))||null;

export function parseInvoiceText(rawText){
  const text=String(rawText||'').replace(/\r/g,'\n'),singleLine=text.replace(/\s+/g,' ');
  const supplier=firstMatch(text,[/(?:fornitore|emittente|ragione\s+sociale|mittente|cedente|ente\s+creditore)\s*[:\-]?\s*([^\n]{3,100})/i])||supplierFromHeading(text);
  const amount=amountValue(firstMatch(singleLine,[/\b(?:TOTALE\s+(?:DA\s+PAGARE|DOVUTO|FATTURA|DOCUMENTO|RETTA|NETTO)|IMPORTO\s+(?:TOTALE|DA\s+PAGARE)|TOTALE)\D{0,25}(?:€\s*)?(\d[\d.\s]*[,.]\d{2})/i,/(?:€\s*)?(\d[\d.\s]*[,.]\d{2})\s+(?:TOTALE(?:\s+(?:RETTA|DA\s+PAGARE|DOVUTO|FATTURA|DOCUMENTO))?|IMPORTO\s+TOTALE)\b/i,/€\s*(\d[\d.\s]*[,.]\d{2})/i]));
  const invoiceNumber=firstMatch(singleLine,[/(?:numero\s+fattura|n[.°º]\s*fattura|fattura\s+n[.°º]?)\s*[:\-]?\s*([A-Z0-9/_-]{2,40})/i,/(?:ddt|d\.d\.t\.|bolla)\s*(?:n(?:umero)?[.°º]?)?\s*[:\-]?\s*([A-Z0-9/_-]{2,40})/i,/(?:numero\s+documento|documento(?:\s+di\s+trasporto)?\s+n(?:umero)?[.°º]?)\s*[:\-]?\s*([A-Z0-9/_-]{2,40})/i]);
  const iuv=firstMatch(singleLine,[/\bIUV\s*[:\-]?\s*([0-9 ]{12,25})/i,/\b([0-9 ]{12,25})\s+CODICE\s+IUV\b/i])?.replace(/\s/g,'')||null;
  const issuedOn=isoDate(firstMatch(singleLine,[/(?:data\s+(?:documento|emissione|ddt|bolla)|emessa\s+il)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i,/(?:\bddt\b|\bbolla\b|documento\s+di\s+trasporto)\D{0,60}\bdata\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i,/\bdata\s*[:\-]\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i]));
  const dueOn=isoDate(firstMatch(singleLine,[/(?:scadenza|pagare\s+entro|entro\s+il)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i]));
  const extracted={supplier,amount,invoice_number:invoiceNumber,iuv,issued_on:issuedOn,due_on:dueOn};
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

async function recognizeImages(images,onProgress){
  const{createWorker}=await import('tesseract.js');
  const worker=await createWorker('ita+eng',1,{logger:event=>{if(event.progress)onProgress?.(Math.round(event.progress*100),event.status)}});
  try{const parts=[];for(let index=0;index<images.length;index++){onProgress?.(0,'Pagina '+(index+1)+' di '+images.length);const image=typeof File!=='undefined'&&images[index] instanceof File?await prepareImage(images[index]):images[index],result=await worker.recognize(image,{rotateAuto:true});parts.push(result.data.text)}return parts.join('\n')}finally{await worker.terminate()}
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
