"""The cron route rejects missing/wrong secrets and fails closed without PostgreSQL."""
import json,os,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    env=dict(os.environ,PORT='3095',HOST='127.0.0.1',DB_PATH=tmp+'/test.sqlite',DATABASE_URL='',CRON_SECRET='local-test-secret')
    p=subprocess.Popen(['node','scripts/start.mjs'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(150):
            try:urllib.request.urlopen('http://127.0.0.1:3095/');break
            except OSError:time.sleep(.1)
        else:raise AssertionError('Server did not start')
        for token,status in [('',401),('wrong',401),('local-test-secret',503)]:
            req=urllib.request.Request('http://127.0.0.1:3095/api/cron/reminders',headers={'Authorization':'Bearer '+token})
            try:urllib.request.urlopen(req);raise AssertionError('Job unexpectedly accepted')
            except urllib.error.HTTPError as e:
                assert e.code==status,(e.code,status)
                assert 'error' in json.load(e)
        print('Cron checks passed: authentication enforced; PostgreSQL required for scheduled email.')
    finally:
        p.terminate()
        try:p.wait(timeout=3)
        except subprocess.TimeoutExpired:p.kill()
