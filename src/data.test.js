import{describe,it}from'node:test';
import assert from'node:assert/strict';
import{calculateSummary}from'./data.js';
describe('calculateSummary',()=>{it('counts each transaction once and separates monthly totals',()=>{const rows=[{kind:'income',amount:2000,occurred_on:'2026-09-01'},{kind:'expense',amount:350,occurred_on:'2026-09-02'},{kind:'expense',amount:100,occurred_on:'2026-08-31'}];const r=calculateSummary(rows,[{status:'to_pay'},{status:'to_review'}],'2026-09');assert.equal(r.income,2000);assert.equal(r.expenses,350);assert.equal(r.balance,1550);assert.equal(r.unpaid.length,1);assert.equal(r.review.length,1)})});
