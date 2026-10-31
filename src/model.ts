// digital: the first rent/buy/VOD date (any service); streaming: a subscription premiere.
export type Medium = 'theatrical' | 'streaming' | 'digital';
export type Release = { id:string; titleId:string; market:string; medium:Medium; service:string|null; offer:string; date:string|null; endDate?:string|null; precision:'day'|'month'|'quarter'|'year'|'unknown'; status:'announced'|'estimated'|'postponed'|'cancelled'|'first_observed'; source:string; sourceUrl:string; revision:number; manual?:boolean; season?:number };
export type Subscription = { id:string; titleId:string; market:string; medium:Medium; services:string[]; rules:string[] };
export function matches(s:Subscription,e:Release) { return s.titleId===e.titleId && s.market===e.market && s.medium===e.medium && (e.medium!=='streaming'||e.offer==='subscription') && (!s.services.length || !!e.service && s.services.includes(e.service)); }
export function material(e:Release) { return JSON.stringify([e.market,e.medium,e.service,e.offer,e.date,e.endDate||null,e.precision,e.status]); }
export function dayInZone(now:Date,zone:string) { return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function due(e:Release,kind:string,now:Date,zone:string,hour:number) {
 if(e.precision!=='day'||!e.date||['postponed','cancelled'].includes(e.status)) return false;
 const days=kind==='week'?7:kind==='day'?1:0;
 const date=new Date(e.date+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()-days);
 const target=date.toISOString().slice(0,10);
 const localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(now));
 return dayInZone(now,zone)===target && localHour>=hour;
}
// Errors carrying an HTTP status. Anything else reaching the API boundary is treated
// as an internal/database failure and answered with a generic 503.
export class HttpError extends Error { status:number; constructor(message:string, status:number) { super(message); this.status=status; } }
export class ValidationError extends HttpError { constructor(message:string) { super(message,400); } }
export class UpstreamError extends HttpError { constructor(message:string) { super(message,502); } }
