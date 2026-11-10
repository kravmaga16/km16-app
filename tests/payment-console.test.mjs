import assert from 'node:assert/strict';
import {splitAmount,validateOrder} from '../rules.mjs';
for(const total of [63000,61000,45500])for(const count of [1,3,4]){const amounts=splitAmount(total,count);assert.equal(amounts.length,count);assert.equal(amounts.reduce((a,b)=>a+b,0),total);}
const annual={kind:'annual',draft:false,min_age:6,max_age:8,amount:45500},data={count:3,first_name:'Test',last_name:'Enfant',birth_date:'2018-01-01',phone:'0612345678',guardian_name:'Parent',license:true,terms:true,privacy:true,installments:true};
assert.equal(validateOrder(annual,data,'2026-11-10').amounts.reduce((a,b)=>a+b,0),45500);
assert.throws(()=>validateOrder(annual,{...data,guardian_name:''},'2026-11-10'),/Représentant/);
assert.throws(()=>validateOrder(annual,{...data,installments:false},'2026-11-10'),/confirmations/);
assert.throws(()=>validateOrder({...annual,kind:'single'},data,'2026-11-10'),/paiement/);
console.log('PASS: installments preserve totals, minor guardian required, installment consent required, single purchases cannot be split');
