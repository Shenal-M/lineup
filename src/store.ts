import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {matches,material,due,type Release,type Subscription} from './model.ts';
export function openStore(path='data/reel.sqlite') {
 if(path!==':memory:') mkdirSync(path.slice(0,path.lastIndexOf('/'))||'.',{recursive:true});
 const db=new DatabaseSync(path); db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,event_id TEXT,revision INTEGER,body TEXT,state TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0);`);
 const all=(kind:string):any[]=>db.prepare('SELECT body FROM records WHERE kind=?').all(kind).map((r:any)=>JSON.parse(r.body));
 const get=(kind:string,id:string):any=>{const r:any=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.body):null;};
 const put=(kind:string,v:any)=>db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(kind,v.id,JSON.stringify(v));
 const enqueue=(s:Subscription,e:Release,kind:string)=> {const id=`${s.id}:${e.id}:${e.revision}:${kind}`;db.prepare('INSERT OR IGNORE INTO outbox(id,event_id,revision,body) VALUES(?,?,?,?)').run(id,e.id,e.revision,JSON.stringify({id,subscriptionId:s.id,eventId:e.id,titleId:e.titleId,kind,date:e.date,medium:e.medium,service:e.service,createdAt:new Date().toISOString()}));};
 function upsert(e:Release) {
  db.exec('BEGIN IMMEDIATE');
  try {
   const prev=get('releases',e.id);
   if(prev?.manual&&!e.manual){put('observations',{...e,id:randomUUID(),observedAt:new Date().toISOString(),eventId:e.id});db.exec('COMMIT');return prev;}
   const changed=prev&&material(prev)!==material(e);
   const next={...e,revision:prev?prev.revision+(changed?1:0):1};
   put('observations',{...e,id:randomUUID(),observedAt:new Date().toISOString(),eventId:e.id});put('releases',next);
   if(changed) db.prepare("UPDATE outbox SET state='superseded' WHERE event_id=? AND state='pending'").run(e.id);
   for(const s of all('subscriptions')) if(matches(s,next)) {
    const kind=(!prev?.date&&e.date)?'announced':changed?'changed':null;
    if(kind&&s.rules.includes(kind)) enqueue(s,next,kind);
   }
   db.exec('COMMIT'); return next;
  }catch(err){db.exec('ROLLBACK');throw err;}
 }
 function tick(now=new Date()) {
  const settings=get('settings','user')||{timezone:'Asia/Colombo',hour:9};
  for(const s of all('subscriptions')) for(const e of all('releases')) if(matches(s,e)) for(const kind of ['week','day','release']) if(s.rules.includes(kind)&&due(e,kind,now,settings.timezone,settings.hour)) enqueue(s,e,kind);
  for(const row of db.prepare("SELECT * FROM outbox WHERE state='pending'").all() as any[]) {
   const e=get('releases',row.event_id);const body=JSON.parse(row.body); const s=get('subscriptions',body.subscriptionId);
   if(!e||e.revision!==row.revision||!s||!matches(s,e)||!s.rules.includes(body.kind)){db.prepare("UPDATE outbox SET state='superseded' WHERE id=?").run(row.id);continue;}
   put('notifications',{...body,read:false});db.prepare("UPDATE outbox SET state='delivered' WHERE id=?").run(row.id);
  }
 }
 function unfollow(id:string) {db.prepare("DELETE FROM records WHERE kind='subscriptions' AND id=?").run(id);for(const row of db.prepare("SELECT id,body FROM outbox WHERE state='pending'").all() as any[])if(JSON.parse(row.body).subscriptionId===id)db.prepare("UPDATE outbox SET state='superseded' WHERE id=?").run(row.id);}
 return {db,all,get,put,upsert,tick,unfollow};
}
