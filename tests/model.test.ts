import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matches,due,dayInZone,type Release,type Subscription} from '../src/model.ts';
const event:Release={id:'r',titleId:'t',market:'US',medium:'streaming',service:'Netflix',offer:'subscription',date:'2026-11-13',precision:'day',status:'announced',source:'Official announcement',sourceUrl:'https://example.com',revision:1};
const sub:Subscription={id:'s',titleId:'t',market:'US',medium:'streaming',services:[],rules:['announced','changed','week','day','release']};
test('follows match category, market, offer and selected service',()=>{
 assert.equal(matches(sub,event),true);
 for(const change of [{medium:'theatrical'},{market:'GB'},{offer:'rent'},{titleId:'other'}])assert.equal(matches(sub,{...event,...change} as Release),false);
 assert.equal(matches({...sub,services:['Apple TV']},event),false);
 assert.equal(matches({...sub,services:['Netflix']},event),true);
});
test('date-only release stays fixed while reminder hour follows Colombo',()=>{
 assert.equal(dayInZone(new Date('2026-11-12T20:00Z'),'Asia/Colombo'),'2026-11-13');
 assert.equal(due(event,'release',new Date('2026-11-13T03:29Z'),'Asia/Colombo',9),false);
 assert.equal(due(event,'release',new Date('2026-11-13T03:30Z'),'Asia/Colombo',9),true);
 assert.equal(due({...event,precision:'year'},'release',new Date('2026-11-13T04:00Z'),'Asia/Colombo',9),false);
 assert.equal(due({...event,status:'postponed'},'release',new Date('2026-11-13T04:00Z'),'Asia/Colombo',9),false);
});
