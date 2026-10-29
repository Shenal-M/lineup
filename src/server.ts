import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {openStore} from './store.ts';
import {createAuth} from './auth.ts';
import {seed} from './seed.ts';
import {searchTMDB,importTheatrical,hydrateTitle,hydrateSeason} from './providers.ts';
const store=openStore(process.env.DB_PATH||'data/reel.sqlite');seed(store);
const auth=createAuth(store.db);
const port=Number(process.env.PORT||3000);
function validateRelease(e:any) {
 if(!store.get('titles',e.titleId)||!['US','GB','LK'].includes(e.market)||!['theatrical','streaming'].includes(e.medium)||!['day','month','quarter','year','unknown'].includes(e.precision)||!['announced','estimated','postponed','cancelled','first_observed'].includes(e.status))throw Error('Invalid release fields');
 if(e.precision==='unknown')e.date=null;
 else if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||new Date(e.date+'T12:00Z').toISOString().slice(0,10)!==e.date)throw Error('Enter a valid date');
 if(!e.source?.trim())throw Error('A source note is required');
 if(e.sourceUrl&&!/^https?:\/\//.test(e.sourceUrl))throw Error('Source must be an HTTP URL');
 if(e.medium==='streaming'&&e.offer!=='subscription')throw Error('Only subscription premieres are supported');
 return e;
}
const server=http.createServer(async(req,res)=>{
 const send=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try {
 const u=new URL(req.url||'/',`http://localhost:${port}`);
 if(u.pathname.startsWith('/api/')) {
  if(!['GET','HEAD'].includes(req.method||'')) {const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)return send(403,{error:'Cross-origin write rejected'});}
  let body:any={};if(['POST','PATCH'].includes(req.method||'')){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)return send(413,{error:'Request too large'});}body=JSON.parse(raw||'{}');}
  const signedIn=auth.authenticated(req);
  if(u.pathname==='/api/auth/status'&&req.method==='GET')return send(200,{setupRequired:!auth.user(),setupKeyRequired:!!process.env.SETUP_KEY,authenticated:signedIn,user:signedIn?auth.user():null});
  const address=req.socket.remoteAddress||'local';
  if(u.pathname==='/api/auth/setup'&&req.method==='POST'){
   if(process.env.COOKIE_SECURE==='true'&&!process.env.SETUP_KEY&&!auth.user())return send(503,{error:'Configure SETUP_KEY on the server before creating the hosted account.'});
   const key=String(body.setupKey||'');const expectedKey=process.env.SETUP_KEY;
   if(expectedKey&&(Buffer.byteLength(key)!==Buffer.byteLength(expectedKey)||!timingSafeEqual(Buffer.from(key),Buffer.from(expectedKey))))return send(403,{error:'The setup key is incorrect.'});
   return send(200,{user:await auth.setup(String(body.email||'').trim(),String(body.password||''),res)});
  }
  if(u.pathname==='/api/auth/login'&&req.method==='POST') {const result=await auth.signIn(String(body.email||'').trim(),String(body.password||'').slice(0,257),address,res);return send(result.status,result);}
  if(u.pathname==='/api/auth/logout'&&req.method==='POST'){auth.logout(req,res);return send(200,{ok:true});}
  const bearer=req.headers.authorization||'';const expected=process.env.APP_TOKEN?'Bearer '+process.env.APP_TOKEN:'';
  const serviceAuth=!!expected&&Buffer.byteLength(bearer)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(bearer),Buffer.from(expected));
  if(!signedIn&&!serviceAuth)return send(401,{error:'Sign in to access your Lineup.'});
  if(u.pathname==='/api/auth/password'&&req.method==='POST'){if(!signedIn)return send(401,{error:'Sign in first.'});await auth.changePassword(String(body.currentPassword||''),String(body.password||''),address,res);return send(200,{ok:true});}
  if(u.pathname==='/api/state'&&req.method==='GET'){store.tick();return send(200,{titles:store.all('titles'),releases:store.all('releases'),subscriptions:store.all('subscriptions'),settings:store.get('settings','user'),notifications:store.all('notifications'),health:store.all('health'),sources:{tmdb:!!process.env.TMDB_TOKEN,streaming:false}});}
  if(u.pathname==='/api/search'&&req.method==='GET'){const q=(u.searchParams.get('q')||'').slice(0,200);if(!q.trim())return send(200,[]);if(process.env.TMDB_TOKEN){const rows=await searchTMDB(q);rows.forEach(t=>store.put('titles',t));return send(200,rows);}return send(200,store.all('titles').filter(t=>t.name.toLowerCase().includes(q.toLowerCase())));}
  const titleRoute=u.pathname.match(/^\/api\/titles\/([^/]+)(?:\/seasons\/(\d+))?$/);
  if(titleRoute&&req.method==='GET') {
   const title=store.get('titles',decodeURIComponent(titleRoute[1]));if(!title)return send(404,{error:'Title not found'});
   if(!process.env.TMDB_TOKEN||!title.tmdbId)return send(200,title);
   const season=titleRoute[2]?Number(titleRoute[2]):null;
   if(season!==null&&(season<1||season>100))throw Error('Invalid season');
   const hydrated=season!==null?await hydrateSeason(title,season):await hydrateTitle(title);
   store.put('titles',hydrated);return send(200,hydrated);
  }
  if(u.pathname==='/api/subscriptions'&&req.method==='POST'){
   if(!store.get('titles',body.titleId)||!['US','GB','LK'].includes(body.market)||!['theatrical','streaming'].includes(body.medium)||!Array.isArray(body.services)||body.services.some((s:any)=>typeof s!=='string')||!Array.isArray(body.rules)||body.rules.some((r:any)=>!['announced','changed','week','day','release'].includes(r)))return send(400,{error:'Invalid follow preferences'});
   if(body.scope==='channel'&&body.services.length>1)return send(400,{error:'Choose one channel per notification toggle'});
   const base=`${body.titleId}:${body.market}:${body.medium}`;
   const id=body.scope==='channel'?`${base}:channel:${encodeURIComponent(body.services[0]||'any')}`:(body.id&&store.get('subscriptions',body.id)?.titleId===body.titleId&&store.get('subscriptions',body.id)?.market===body.market&&store.get('subscriptions',body.id)?.medium===body.medium?body.id:base);store.put('subscriptions',{...body,id});return send(200,{id});
  }
  if(u.pathname.startsWith('/api/subscriptions/')&&req.method==='DELETE'){store.unfollow(decodeURIComponent(u.pathname.slice(19)));return send(200,{ok:true});}
  if(u.pathname==='/api/settings'&&req.method==='PATCH'){
   try{new Intl.DateTimeFormat('en',{timeZone:body.timezone});}catch{throw Error('Invalid timezone');}
   if(!['US','GB','LK'].includes(body.market)||!Number.isInteger(body.hour)||body.hour<0||body.hour>23)throw Error('Invalid settings');
   store.put('settings',{id:'user',market:body.market,timezone:body.timezone,hour:body.hour});return send(200,{ok:true});
  }
  if(u.pathname==='/api/releases'&&req.method==='POST'){const e=validateRelease({...body,id:randomUUID(),revision:1,manual:true});return send(200,store.upsert(e));}
  if(u.pathname.startsWith('/api/releases/')&&req.method==='PATCH'){const id=u.pathname.split('/').pop()!;const e=store.get('releases',id);if(!e)return send(404,{error:'Release not found'});return send(200,store.upsert(validateRelease({...e,...body,id,manual:true})));}
  if(u.pathname==='/api/import'&&req.method==='POST'){
   if(!['US','GB','LK'].includes(body.market)||!/^\d{4}-\d{2}-01$/.test(body.from))throw Error('Invalid import range');
   const d=new Date(body.from+'T12:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);
   try{return send(200,{count:await importTheatrical(store,body.market,body.from,d.toISOString().slice(0,10))});}catch(e:any){store.put('health',{id:'tmdb',state:'error',updatedAt:new Date().toISOString(),note:e.message});throw e;}
  }
  if(u.pathname==='/api/notifications/read'&&req.method==='POST'){store.all('notifications').forEach(n=>store.put('notifications',{...n,read:true}));return send(200,{ok:true});}
  return send(404,{error:'Not found'});
 }
 const files:Record<string,string>={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=files[u.pathname];if(!file)return send(404,{error:'Not found'});
 res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript','Content-Security-Policy':"default-src 'self'; img-src 'self' https://image.tmdb.org https://static.tvmaze.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(new URL('../public/'+file,import.meta.url)));
 }catch(e:any){send(400,{error:e.message||'Request failed'});}
});
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Lineup is running at http://localhost:${port}`));
setInterval(()=>store.tick(),60000).unref();
