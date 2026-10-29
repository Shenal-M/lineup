import {openStore} from './store.ts';
const store=openStore(process.env.DB_PATH||'data/reel.sqlite');store.tick();store.db.close();console.log('Reminder outbox checked.');
