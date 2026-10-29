"""Isolated HTTP integration check. Requires local socket access."""
import json, os, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    env = dict(os.environ, PORT='3097', DB_PATH=tmp+'/db.sqlite', APP_TOKEN='integration-test-token')
    server = subprocess.Popen(['node', 'scripts/start.mjs'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def request(path, method='GET', data=None, auth=True):
        headers = {'Content-Type':'application/json'}
        if auth: headers['Authorization']='Bearer integration-test-token'
        req=urllib.request.Request('http://127.0.0.1:3097'+path, method=method, headers=headers, data=json.dumps(data).encode() if data is not None else None)
        return urllib.request.urlopen(req, timeout=5)
    def api(path, method='GET', data=None):
        return json.load(request('/api/'+path,method,data))
    try:
        for _ in range(150):
            try:
                assert request('/').status==200
                break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('Server did not start: '+server.stderr.read().decode())
        assert request('/search').status==200
        assert request('/following').status==200
        assert request('/settings').status==200
        try:
            request('/api/state', auth=False)
            raise AssertionError('Missing authentication was accepted')
        except urllib.error.HTTPError as e: assert e.code==401
        initial=api('state');assert len(initial['titles'])==8
        assert len(api('search?q=Dune'))==1
        assert api('titles/dune')['name']=='Dune: Prophecy'
        sub=api('subscriptions','POST',dict(titleId='dog-stars',market='US',medium='streaming',services=['Netflix'],rules=['announced','changed']))
        release=api('releases','POST',dict(titleId='dog-stars',market='US',medium='streaming',service='Netflix',offer='subscription',date='2027-03-12',precision='day',status='announced',source='Integration test announcement',sourceUrl='https://example.com/announcement'))
        first=api('state');assert len(first['notifications'])==1
        assert first['notifications'][0]['kind']=='announced'
        api('releases/'+release['id'],'PATCH',dict(date='2027-04-16'))
        changed=api('state');assert len(changed['notifications'])==2
        assert any(n['kind']=='changed' for n in changed['notifications'])
        assert len(api('state')['notifications'])==2
        api('settings','PATCH',dict(market='GB',timezone='Asia/Colombo',hour=10))
        assert api('state')['settings']['market']=='GB'
        api('subscriptions/'+urllib.parse.quote(sub['id'], safe=''),'DELETE')
        assert len(api('state')['subscriptions'])==0
        channels=[]
        for service in ['Netflix','Apple TV']:
            channels.append(api('subscriptions','POST',dict(titleId='dog-stars',market='US',medium='streaming',services=[service],rules=['announced','changed'],scope='channel')))
        assert channels[0]['id']!=channels[1]['id']
        assert len(api('state')['subscriptions'])==2
        api('subscriptions/'+urllib.parse.quote(channels[0]['id'],safe=''),'DELETE')
        remaining=api('state')['subscriptions'];assert len(remaining)==1 and remaining[0]['services']==['Apple TV']
        try:
            api('releases/'+release['id'],'PATCH',dict(sourceUrl='javascript:alert(1)'))
            raise AssertionError('Unsafe source URL accepted')
        except urllib.error.HTTPError as e: assert e.code==400
        print('HTTP integration passed: assets, authentication, search, details, follow, release edits, reminders, settings, unfollow, source validation.')
    finally:
        server.terminate()
        try: server.wait(timeout=3)
        except subprocess.TimeoutExpired: server.kill()
