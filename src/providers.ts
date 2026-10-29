// Provider credentials stay server-side. Generic digital dates never become subscription premieres.
async function json(url:string,headers:any={}) {const r=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Source returned HTTP ${r.status}`);return r.json();}
async function tmdb(path:string) {if(!process.env.TMDB_TOKEN)throw new Error('TMDB_TOKEN is not configured');return json('https://api.themoviedb.org/3'+path,{Authorization:`Bearer ${process.env.TMDB_TOKEN}`});}
export async function searchTMDB(q:string) {const d:any=await tmdb('/search/multi?query='+encodeURIComponent(q));return d.results.filter((x:any)=>['movie','tv'].includes(x.media_type)).map((x:any)=>({id:`tmdb-${x.media_type}-${x.id}`,tmdbId:x.id,name:x.title||x.name,mediaType:x.media_type,year:Number((x.release_date||x.first_air_date||'').slice(0,4))||null,synopsis:x.overview,poster:x.poster_path?'https://image.tmdb.org/t/p/w500'+x.poster_path:null,demo:false,genre:x.media_type==='tv'?'TV series':'Movie',credit:'TMDB catalogue'}));}
export async function importTheatrical(store:any,market:string,from:string,to:string) {
 const data:any=await tmdb(`/discover/movie?region=${market}&with_release_type=2%7C3&release_date.gte=${from}&release_date.lte=${to}`);
 let count=0;
 for(const movie of data.results) {
  const id=`tmdb-movie-${movie.id}`;store.put('titles',{id,tmdbId:movie.id,name:movie.title,mediaType:'movie',year:Number(movie.release_date?.slice(0,4)),synopsis:movie.overview,poster:movie.poster_path?'https://image.tmdb.org/t/p/w500'+movie.poster_path:null,demo:false,genre:'Movie',credit:'TMDB catalogue'});
  const dates:any=await tmdb(`/movie/${movie.id}/release_dates`);
  const regional=dates.results.find((r:any)=>r.iso_3166_1===market);
  for(const type of [2,3]) {
   const records=(regional?.release_dates||[]).filter((r:any)=>r.type===type).sort((a:any,b:any)=>a.release_date.localeCompare(b.release_date));
   const r=records[0];if(!r)continue;
   store.upsert({id:`tmdb-${movie.id}-${market}-${type}`,titleId:id,market,medium:'theatrical',service:null,offer:'ticket',date:r.release_date.slice(0,10),precision:'day',status:'announced',source:`TMDB · ${type===2?'limited theatrical':'theatrical'}`,sourceUrl:`https://www.themoviedb.org/movie/${movie.id}/releases`,revision:1});count++;
  }
 }
 store.put('health',{id:'tmdb',state:'ok',updatedAt:new Date().toISOString(),note:`Imported ${count} regional events (first discovery page).`});return count;
}
export async function importTVmaze(store:any,date:string) {
 const rows:any=await json(`https://api.tvmaze.com/schedule/web?date=${date}`);let count=0;
 for(const ep of rows) {
  const show=ep._embedded?.show;if(!show)continue;
  // Global web schedules cannot establish country-specific streaming premieres.
  const country=show.webChannel?.country?.code;if(!country||ep.number!==1)continue;
  const id=`tvmaze-${show.id}`;
  store.put('titles',{id,name:show.name,mediaType:'tv',year:Number((show.premiered||'').slice(0,4)),synopsis:(show.summary||'').replace(/<[^>]*>/g,''),poster:show.image?.medium,genre:(show.genres||[]).join(' · '),credit:`Season ${ep.season}`,demo:false});
  // Store the schedule as an observation until its market and subscription offer are verified.
  store.put('observations',{id:`tvmaze-${ep.id}`,titleId:id,season:ep.season,episode:ep.number,market:country,service:show.webChannel.name,date:ep.airdate||null,source:'TVmaze web schedule',sourceUrl:ep.url,observedAt:new Date().toISOString(),note:'Schedule observation only; subscription availability unverified.'});count++;
 }
 return count;
}
export async function hydrateTitle(title:any) {
 if(!title.tmdbId)return title;
 const d:any=await tmdb(`/${title.mediaType}/${title.tmdbId}`);
 return {...title,synopsis:d.overview||title.synopsis,genre:(d.genres||[]).map((g:any)=>g.name).join(' · '),seasons:title.mediaType==='tv'?(d.seasons||[]).filter((s:any)=>s.season_number>0).map((s:any)=>({number:s.season_number,name:s.name,episodeCount:s.episode_count})):undefined};
}
export async function hydrateSeason(title:any,number:number) {
 const d:any=await tmdb(`/tv/${title.tmdbId}/season/${number}`);
 // Air dates are metadata only. They do not establish a regional streaming premiere.
 return {...title,id:`${title.id}-season-${number}`,parentId:title.id,season:number,name:`${title.name} · Season ${number}`,synopsis:d.overview||title.synopsis,credit:`Season ${number} · ${(d.episodes||[]).length} episodes`,seasons:undefined,episodes:(d.episodes||[]).map((e:any)=>({number:e.episode_number,name:e.name,originalAirDate:e.air_date})),poster:d.poster_path?'https://image.tmdb.org/t/p/w500'+d.poster_path:title.poster};
}
