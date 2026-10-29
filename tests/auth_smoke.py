"""Personal account authentication, multi-device persistence, and revocation."""
import http.cookiejar,json,os,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    env=dict(os.environ,PORT='3099',DB_PATH=tmp+'/lineup.sqlite',APP_TOKEN='',SETUP_KEY='test-setup-key')
    def start():
        p=subprocess.Popen(['node','src/server.ts'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(40):
            try:urllib.request.urlopen('http://127.0.0.1:3099/');return p
            except OSError:time.sleep(.1)
        raise AssertionError('Auth server did not start')
    def stop(p):
        p.terminate()
        try:p.wait(timeout=3)
        except subprocess.TimeoutExpired:p.kill()
    def device():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def api(client,path,method='GET',body=None,origin=None):
        headers={'Content-Type':'application/json'}
        if origin:headers['Origin']=origin
        req=urllib.request.Request('http://127.0.0.1:3099/api/'+path,method=method,headers=headers,data=json.dumps(body).encode() if body is not None else None)
        with client.open(req,timeout=5) as res:return json.load(res)
    def rejected(client,path,status,method='GET',body=None,origin=None):
        try:api(client,path,method,body,origin);raise AssertionError('Request unexpectedly accepted: '+path)
        except urllib.error.HTTPError as err:assert err.code==status,(path,err.code)
    server=start()
    try:
        laptop,phone,guest=device(),device(),device()
        assert api(guest,'auth/status')['setupRequired'] is True
        rejected(guest,'state',401)
        credentials=dict(email='owner@example.com',password='a-long-test-password',setupKey='test-setup-key')
        rejected(guest,'auth/setup',403,'POST',credentials,'https://untrusted.example')
        rejected(guest,'auth/setup',400,'POST',dict(email='owner@example.com',password='short',setupKey='test-setup-key'))
        rejected(guest,'auth/setup',403,'POST',dict(email='owner@example.com',password='a-long-test-password',setupKey='wrong-key'))
        api(laptop,'auth/setup','POST',credentials)
        assert api(laptop,'auth/status')['authenticated'] is True
        rejected(guest,'auth/setup',400,'POST',credentials)
        rejected(guest,'auth/login',401,'POST',dict(email='owner@example.com',password='incorrect-password'))
        api(phone,'auth/login','POST',credentials)
        api(laptop,'subscriptions','POST',dict(titleId='dog-stars',market='US',medium='streaming',services=['Netflix'],rules=['announced','changed'],scope='channel'))
        assert api(phone,'state')['subscriptions'][0]['services']==['Netflix']
        api(phone,'settings','PATCH',dict(market='GB',timezone='Asia/Colombo',hour=10))
        assert api(laptop,'state')['settings']['market']=='GB'
        stop(server);server=start()
        assert api(phone,'auth/status')['authenticated'] is True
        assert api(phone,'state')['subscriptions'][0]['services']==['Netflix']
        assert api(laptop,'state')['settings']['hour']==10
        api(laptop,'auth/password','POST',dict(currentPassword=credentials['password'],password='the-new-long-password'))
        rejected(phone,'state',401)
        rejected(phone,'auth/login',401,'POST',credentials)
        api(phone,'auth/login','POST',dict(email='owner@example.com',password='the-new-long-password'))
        api(phone,'auth/logout','POST',{})
        rejected(phone,'state',401)
        for _ in range(10):rejected(guest,'auth/login',401,'POST',credentials)
        rejected(guest,'auth/login',429,'POST',credentials)
        print('Authentication checks passed: protected API, setup validation, CSRF, password hashing flow, two-device data sync, sessions and data after restart, password revocation, logout, rate limiting.')
    finally:stop(server)
