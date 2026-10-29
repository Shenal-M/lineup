export function seed(store:any) {
 if(store.get('settings','user'))return;
 store.put('settings',{id:'user',market:'US',timezone:'Asia/Colombo',hour:9});
 const titles=[
 ['dog-stars','The Dog Stars','movie',2026,'A lone pilot and his unlikely companion search for a new beginning in a world transformed.','Adventure · Drama','Ridley Scott','#c1a681','#343b36','THE DOG\nSTARS'],
 ['dune','Dune: Prophecy','tv',2027,'Two Harkonnen sisters confront forces that threaten the future of humankind and establish the fabled Bene Gesserit.','Science fiction · Drama','Season 2','#caac7d','#242b2c','DUNE\nPROPHECY'],
 ['odyssey','The Odyssey','movie',2026,'A mythic journey across the sea, following Odysseus on his perilous voyage home.','Adventure · Fantasy','Christopher Nolan','#c7c4ad','#204a52','THE\nODYSSEY'],
 ['orbital','Orbital','tv',2026,'Six strangers aboard a remote space station watch the world below begin to change.','Science fiction · Thriller','Season 1','#bcc9d1','#172839','ORBITAL'],
 ['afterlight','Afterlight','movie',2026,'A photographer returns to her coastal hometown and discovers the stories left in the shadows.','Drama · Mystery','Independent cinema','#d5aa79','#624e3e','AFTERLIGHT'],
 ['wild','The Wild North','tv',2026,'An intimate journey through the last great wilderness and the lives that call it home.','Documentary · Nature','Season 1','#b3c2a0','#263f36','THE WILD\nNORTH'],
 ['blue','A Different Blue','movie',2026,'A chance encounter brings two musicians together for one unforgettable summer.','Romance · Drama','Independent cinema','#9ebdc1','#38495e','A DIFFERENT\nBLUE'],
 ['signal','The Last Signal','movie',2027,'An unexpected transmission draws a retired astronomer back to the edge of discovery.','Science fiction · Mystery','Coming next year','#b69b8a','#41363b','THE LAST\nSIGNAL']
 ];
 titles.forEach(([id,name,mediaType,year,synopsis,genre,credit,ink,bg,art])=>store.put('titles',{id,name,mediaType,year,synopsis,genre,credit,ink,bg,art,demo:true}));
 const events=[['dog-stars','theatrical',null,'2026-11-06','day'],['odyssey','streaming','Prime Video','2026-11-12','day'],['orbital','streaming','Apple TV','2026-11-13','day'],['afterlight','theatrical',null,'2026-11-20','day'],['wild','streaming','Netflix','2026-11-20','day'],['blue','theatrical',null,'2026-11-27','day'],['dog-stars','streaming',null,null,'unknown'],['dune','streaming','HBO Max','2027-01-01','year'],['signal','theatrical',null,'2027-04-01','quarter']];
 events.forEach(([titleId,medium,service,date,precision],i)=>store.upsert({id:`demo-${i}`,titleId,market:'US',medium,service,date,precision,offer:medium==='streaming'?'subscription':'ticket',status:precision==='day'?'announced':'estimated',source:'Illustrative sample — not verified release information',sourceUrl:'',revision:1}));
}
