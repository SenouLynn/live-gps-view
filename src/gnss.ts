import { json2satrec, propagate, gstime, eciToEcf, ecfToLookAngles, type SatRec, type OMMJsonObject } from 'satellite.js';
export type Constellation='GPS'|'Galileo'|'GLONASS'|'BeiDou'|'Other';
export interface Orbit {id:number;name:string;epoch:number;group:Constellation;record:SatRec}
export interface Observer{lat:number;lon:number;heightM:number}
export function constellation(name:string):Constellation{
  if(/^GPS\b/i.test(name))return 'GPS';
  if(/GALILEO/i.test(name)||/^GSAT\d{4}/i.test(name))return 'Galileo';
  if(/^(COSMOS|GLONASS)\b/i.test(name))return 'GLONASS';
  if(/^BEIDOU/i.test(name))return 'BeiDou';
  return 'Other';
}
export function parseOrbits(data:unknown):Orbit[]{
  if(!Array.isArray(data)||data.length>1000)throw new Error('Invalid orbital catalog');
  const unique=new Map<number,Orbit>();
  for(const row of data){
    if(!row||typeof row!=='object')continue;
    const r=row as Record<string,unknown>;
    if(typeof r.OBJECT_NAME!=='string'||typeof r.EPOCH!=='string'||typeof r.NORAD_CAT_ID!=='number'||!Number.isInteger(r.NORAD_CAT_ID))continue;
    const epoch=Date.parse(/Z$/.test(r.EPOCH)?r.EPOCH:r.EPOCH+'Z');
    const numeric=['MEAN_MOTION','ECCENTRICITY','INCLINATION','RA_OF_ASC_NODE','ARG_OF_PERICENTER','MEAN_ANOMALY'];
    if(!Number.isFinite(epoch)||!numeric.every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))||Number(r.MEAN_MOTION)<=0||Number(r.ECCENTRICITY)<0||Number(r.ECCENTRICITY)>=1||Number(r.INCLINATION)<0||Number(r.INCLINATION)>180)continue;
    try{const record=json2satrec(row as OMMJsonObject);if(record.error===0)unique.set(r.NORAD_CAT_ID,{id:r.NORAD_CAT_ID,name:r.OBJECT_NAME.slice(0,100),epoch,group:constellation(r.OBJECT_NAME),record});}catch{/* Skip malformed elements without stopping the catalog. */}
  }
  if(!unique.size)throw new Error('No usable orbital elements');return [...unique.values()];
}
export function orbitFresh(epoch:number,now:number){return now-epoch>=-86400000&&now-epoch<=7*86400000;}
export function lookAtOrbit(orbit:Orbit,observer:Observer,now:number){
  if(!orbitFresh(orbit.epoch,now)||![observer.lat,observer.lon,observer.heightM,now].every(Number.isFinite)||Math.abs(observer.lat)>90||Math.abs(observer.lon)>180)return undefined;
  try{
    const date=new Date(now),result=propagate(orbit.record,date);if(!result)return undefined;
    const position=eciToEcf(result.position,gstime(date));
    const angles=ecfToLookAngles({latitude:observer.lat*Math.PI/180,longitude:observer.lon*Math.PI/180,height:observer.heightM/1000},position);
    const azimuth=(angles.azimuth*180/Math.PI+360)%360,elevation=angles.elevation*180/Math.PI;
    if(![azimuth,elevation,angles.rangeSat].every(Number.isFinite))return undefined;
    return{azimuth,elevation,rangeKm:angles.rangeSat};
  }catch{return undefined;}
}
export function skyPoint(azimuth:number,elevation:number,radius=130){
  const r=(90-elevation)/90*radius,a=azimuth*Math.PI/180;
  return{x:160+Math.sin(a)*r,y:160-Math.cos(a)*r};
}

/** Earth-fixed meters for Cesium, using the same time and orbital model as the sky plot. */
export function orbitEcfMeters(orbit:Orbit,now:number){
  if(!orbitFresh(orbit.epoch,now))return undefined;
  try{
    const date=new Date(now),result=propagate(orbit.record,date);if(!result)return undefined;
    const position=eciToEcf(result.position,gstime(date));
    if(![position.x,position.y,position.z].every(Number.isFinite))return undefined;
    return{x:position.x*1000,y:position.y*1000,z:position.z*1000};
  }catch{return undefined;}
}
