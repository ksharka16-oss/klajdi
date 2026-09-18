const tidy=value=>String(value||'').replace(/\s+/g,' ').trim();
const isoDate=value=>{const match=String(value||'').match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);if(!match)return null;const[,day,month,year]=match;return`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`};
const amountValue=value=>{const normalized=String(value||'').replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');const number=Number(normalized);return Number.isFinite(number)&&number>0?number:null};
const firstMatch=(text,patterns)=>{for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return tidy(match[1])}return null};

export function parseInvoiceText(rawText){
  const text=String(rawText||'').replace(/\r/g,'\n'),singleLine=text.replace(/\s+/g,' ');
  const supplier=firstMatch(text,[/(?:fornitore|emittente|ragione sociale)\s*[:\-]?\s*([^\n]{3,100})/i]);
  const amount=amountValue(firstMatch(singleLine,[/\b(?:TOTALE\s+(?:DA PAGARE|DOVUTO|FATTURA|DOCUMENTO|RETTA)|IMPORTO\s+TOTALE|TOTALE)\D{0,25}(?:€\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i,/(?:€\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\s+(?:TOTALE(?:\s+(?:RETTA|DA PAGARE|DOVUTO|FATTURA|DOCUMENTO))?|IMPORTO\s+TOTALE)\b/i,/€\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i]));
  const invoiceNumber=firstMatch(singleLine,[/(?:numero\s+fattura|n[.°º]\s*fattura|fattura\s+n[.°º]?)\s*[:\-]?\s*([A-Z0-9/_-]{2,40})/i]);
  const iuv=firstMatch(singleLine,[/\bIUV\s*[:\-]?\s*([0-9 ]{12,25})/i,/\b([0-9 ]{12,25})\s+CODICE\s+IUV\b/i])?.replace(/\s/g,'')||null;
  const issuedOn=isoDate(firstMatch(singleLine,[/(?:data\s+(?:documento|emissione)|emessa\s+il)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i]));
  const dueOn=isoDate(firstMatch(singleLine,[/(?:scadenza|pagare\s+entro)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i]));
  const extracted={supplier,amount,invoice_number:invoiceNumber,iuv,issued_on:issuedOn,due_on:dueOn};
  const found=Object.values(extracted).filter(Boolean).length;
  return{extracted,confidence:Math.min(.95,.25+found*.11)};
}

async function recognizeImages(images,onProgress){
  const{createWorker}=await import('tesseract.js');
  const worker=await createWorker('ita+eng',1,{logger:event=>{if(event.progress)onProgress?.(Math.round(event.progress*100),event.status)}});
  try{const parts=[];for(let index=0;index<images.length;index++){onProgress?.(0,`Pagina ${index+1} di ${images.length}`);const result=await worker.recognize(images[index]);parts.push(result.data.text)}return parts.join('\n')}finally{await worker.terminate()}
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
