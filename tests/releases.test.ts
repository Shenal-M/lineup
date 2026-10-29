import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matches,due,dayInZone,type Release,type Subscription} from '../src/model.ts';
import {openStore} from '../src/store.ts';
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
test('follow before a date exists receives later announcement once',()=>{
 const s=openStore(':memory:');s.put('subscriptions',sub);s.upsert({...event,date:null,precision:'unknown'});s.tick();assert.equal(s.all('notifications').length,0);
 s.upsert(event);s.tick(new Date('2026-10-01T00:00Z'));s.tick(new Date('2026-10-01T00:00Z'));assert.equal(s.all('notifications').length,1);assert.equal(s.all('notifications')[0].kind,'announced');s.db.close();
});
test('postponement supersedes pending older alerts and worker retries do not duplicate',()=>{
 const s=openStore(':memory:');s.put('subscriptions',sub);s.upsert(event);
 s.upsert({...event,date:'2026-12-01',status:'postponed'});s.tick(new Date('2026-11-13T04:00Z'));s.tick(new Date('2026-11-13T04:00Z'));
 assert.equal(s.all('notifications').length,1);assert.equal(s.all('notifications')[0].kind,'changed');
 const old:any=s.db.prepare("SELECT state FROM outbox WHERE revision=1").get();assert.equal(old.state,'superseded');s.db.close();
});
test('metadata edits do not advance revision; manual corrections survive imports',()=>{
 const s=openStore(':memory:');s.upsert(event);const a=s.upsert({...event,source:'Updated attribution'});assert.equal(a.revision,1);
 s.upsert({...event,date:'2026-12-01',manual:true});const b=s.upsert(event);assert.equal(b.date,'2026-12-01');assert.equal(b.revision,2);assert.equal(s.all('observations').length,4);s.db.close();
});
test('selected service follow remains waiting when another service arrives',()=>{
 const s=openStore(':memory:');s.put('subscriptions',{...sub,services:['Apple TV']});s.upsert(event);s.tick(new Date('2026-11-13T04:00Z'));assert.equal(s.all('notifications').length,0);s.db.close();
});
test('release-day reminders are deduplicated across repeated worker checks',()=>{
 const s=openStore(':memory:');s.upsert(event);s.put('subscriptions',sub);s.tick(new Date('2026-11-13T04:00Z'));s.tick(new Date('2026-11-13T06:00Z'));assert.equal(s.all('notifications').length,1);assert.equal(s.all('notifications')[0].kind,'release');s.db.close();
});
test('channel follows coexist and only notify for their own service',()=>{
 const s=openStore(':memory:');
 s.put('subscriptions',{...sub,id:'netflix',services:['Netflix']});
 s.put('subscriptions',{...sub,id:'apple',services:['Apple TV']});
 s.upsert(event);s.tick(new Date('2026-10-01T00:00Z'));
 assert.equal(s.all('notifications').length,1);assert.equal(s.all('notifications')[0].subscriptionId,'netflix');
 s.unfollow('netflix');s.upsert({...event,id:'apple-event',service:'Apple TV'});s.tick(new Date('2026-10-01T00:00Z'));
 assert.equal(s.all('notifications').length,2);assert.equal(s.all('subscriptions').length,1);assert.equal(s.all('subscriptions')[0].id,'apple');s.db.close();
});
