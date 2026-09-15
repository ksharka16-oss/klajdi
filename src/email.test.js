import test from'node:test';
import assert from'node:assert/strict';
import{classifyEmail,financialStatus,gmailRollingRange}from'../supabase/functions/_shared/classification.js';

test('una mail normale non diventa fattura',()=>assert.equal(classifyEmail('Ciao','Mario','Come stai?',[]),'normal'));
test('la parola fattura senza allegato resta normale',()=>assert.equal(classifyEmail('Informazioni fattura','Azienda','Nessun documento',[]),'normal'));
test('fattura con PDF viene riconosciuta',()=>assert.equal(classifyEmail('La tua fattura','Fornitore','Documento allegato',['fattura.pdf']),'invoice'));
test('una promozione viene ignorata anche se cita fatture',()=>assert.equal(classifyEmail('Offerta sulle fatture','Newsletter','Sconto',['promo.pdf']),'ignore'));
test('una fattura vera senza prova di pagamento risulta da pagare',()=>assert.equal(financialStatus('invoice'),'to_pay'));
test('una conferma di pagamento risulta pagata',()=>assert.equal(financialStatus('payment_confirmation'),'paid'));
test('una mail finanziaria debole non viene mostrata',()=>assert.equal(financialStatus(classifyEmail('Documento','Servizio','In allegato',['documento.pdf']),'Documento','Servizio','In allegato',['documento.pdf']),null));
test('solo un dubbio con segnali molto forti va da controllare',()=>{const input=['Avviso documento','Fornitura','Importo dovuto EUR 120,00 con scadenza 20/09/2026',['documento.pdf']];const classification=classifyEmail(...input);assert.equal(classification,'financial_document');assert.equal(financialStatus(classification,...input),'to_review')});
test('la ricerca Gmail copre gli ultimi 30 giorni',()=>assert.deepEqual(gmailRollingRange(new Date('2026-09-15T12:00:00Z')),{window:'last-30-days:2026-09-15',query:'newer_than:30d'}));
