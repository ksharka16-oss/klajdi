import test from'node:test';
import assert from'node:assert/strict';
import{classifyEmail,extractFinancialFields,financialStatus,gmailRollingRange,supportedFinancialAttachment}from'../supabase/functions/_shared/classification.js';

test('una mail normale non diventa fattura',()=>assert.equal(classifyEmail('Ciao','Mario','Come stai?',[]),'normal'));
test('la parola fattura senza allegato resta normale',()=>assert.equal(classifyEmail('Informazioni fattura','Azienda','Nessun documento',[]),'normal'));
test('fattura con PDF viene riconosciuta',()=>assert.equal(classifyEmail('La tua fattura','Fornitore','Documento allegato',['fattura.pdf']),'invoice'));
test('una promozione viene ignorata anche se cita fatture',()=>assert.equal(classifyEmail('Offerta sulle fatture','Newsletter','Sconto',['promo.pdf']),'ignore'));
test('una fattura vera senza prova di pagamento risulta da pagare',()=>assert.equal(financialStatus('invoice'),'to_pay'));
test('una conferma di pagamento risulta pagata',()=>assert.equal(financialStatus('payment_confirmation'),'paid'));
test('una mail finanziaria debole non viene mostrata',()=>assert.equal(financialStatus(classifyEmail('Documento','Servizio','In allegato',['documento.pdf']),'Documento','Servizio','In allegato',['documento.pdf']),null));
test('solo un dubbio con segnali molto forti va da controllare',()=>{const input=['Avviso documento','Fornitura','Importo dovuto EUR 120,00 con scadenza 20/09/2026',['documento.pdf']];const classification=classifyEmail(...input);assert.equal(classification,'financial_document');assert.equal(financialStatus(classification,...input),'to_review')});
test('estrae i dati utili senza inventare valori mancanti',()=>{const result=extractFinancialFields('Fattura n. AB-123','Energia Italia <conti@energia.it>','Totale EUR 120,50 con scadenza 20/09/2026 IUV 123456789012345678',['fattura.pdf']);assert.deepEqual(result.data,{supplier:'Energia Italia',amount:120.5,due_on:'2026-09-20',invoice_number:'AB-123',iuv:'123456789012345678',attachment_names:['fattura.pdf']});assert.ok(result.confidence>=.9)});
test('accetta solo allegati finanziari sicuri entro 10 MB',()=>{assert.equal(supportedFinancialAttachment({filename:'fattura.pdf',mimeType:'application/pdf',size:1000}),true);assert.equal(supportedFinancialAttachment({filename:'pagina.html',mimeType:'text/html',size:1000}),false);assert.equal(supportedFinancialAttachment({filename:'fattura.pdf',mimeType:'application/pdf',size:10485761}),false)});
test('la ricerca Gmail copre gli ultimi 30 giorni',()=>assert.deepEqual(gmailRollingRange(new Date('2026-09-15T12:00:00Z')),{window:'last-30-days:2026-09-15',query:'newer_than:30d'}));
