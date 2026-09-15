import test from'node:test';
import assert from'node:assert/strict';
import{classifyEmail}from'../supabase/functions/_shared/classification.js';

test('una mail normale non diventa fattura',()=>assert.equal(classifyEmail('Ciao','Mario','Come stai?',[]),'normal'));
test('la parola fattura senza allegato resta normale',()=>assert.equal(classifyEmail('Informazioni fattura','Azienda','Nessun documento',[]),'normal'));
test('fattura con PDF viene riconosciuta',()=>assert.equal(classifyEmail('La tua fattura','Fornitore','Documento allegato',['fattura.pdf']),'invoice'));
test('una promozione viene ignorata anche se cita fatture',()=>assert.equal(classifyEmail('Offerta sulle fatture','Newsletter','Sconto',['promo.pdf']),'ignore'));
