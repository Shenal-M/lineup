"""Verify a pre-Next SQLite library and owner session work without migration or reset."""
import json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    env=dict(os.environ,PORT='3096',HOST='127.0.0.1',DB_PATH=tmp+'/legacy.sqlite',APP_TOKEN='',SETUP_KEY='')
    fixture=r"""
import {openStore} from './src/store.ts';
import {createAuth} from './src/auth.ts';
import {seed} from './src/seed.ts';
const store=openStore(process.env.DB_PATH);seed(store);
let cookie='';const auth=createAuth(store.db);
await auth.setup('legacy@example.com','a-legacy-owner-password',{setHeader:(key,value)=>{cookie=value.split(';')[0];}});
store.put('settings',{id:'user',market:'GB',timezone:'Asia/Colombo',hour:10});
store.put('subscriptions',{id:'legacy-sub',titleId:'dog-stars',market:'GB',medium:'streaming',services:['Netflix'],rules:['announced','changed']});
const event={id:'legacy-release',titleId:'dog-stars',market:'GB',medium:'streaming',service:'Netflix',offer:'subscription',date:null,precision:'unknown',status:'announced',source:'Legacy official announcement',sourceUrl:'https://example.com/announcement',revision:1,manual:true};
store.upsert(event);store.upsert({...event,date:'2027-02-12',precision:'day'});
store.db.close();console.log(JSON.stringify({cookie}));
"""
    old=json.loads(subprocess.check_output(['node','--input-type=module','-e',fixture],cwd=ROOT,env=env,text=True))
    server=subprocess.Popen(['node','scripts/start.mjs'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    def api(path):
        req=urllib.request.Request('http://127.0.0.1:3096/api/'+path,headers={'Cookie':old['cookie']})
        return json.load(urllib.request.urlopen(req,timeout=5))
    try:
        for _ in range(150):
            try:
                status=api('auth/status');break
            except OSError:time.sleep(.1)
        else:raise AssertionError('Next.js server did not start')
        assert status['authenticated'] and not status['setupRequired']
        assert status['user']['email']=='legacy@example.com'
        data=api('state')
        assert data['settings']['market']=='GB' and data['settings']['hour']==10
        assert data['subscriptions'][0]['id']=='legacy-sub'
        event=next(e for e in data['releases'] if e['id']=='legacy-release')
        assert event['revision']==2 and event['manual'] and event['date']=='2027-02-12'
        assert len(data['notifications'])==1 and data['notifications'][0]['kind']=='announced'
        assert len(api('state')['notifications'])==1
        print('Migration checks passed: existing owner, session, library, preferences, revisions, manual source and queued notification preserved by Next.js.')
    finally:
        server.terminate()
        try:server.wait(timeout=3)
        except subprocess.TimeoutExpired:server.kill()
