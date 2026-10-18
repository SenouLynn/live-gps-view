import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { bearing, sampleRoute, durationSeconds } from './pose.ts';
test('bearing preserves cardinal directions including north wrap', () => {
  assert.equal(bearing(0, 0, 1, 0), 0);
  assert.equal(bearing(0, 0, 0, 1), 90);
  assert.equal(bearing(0, 0, -1, 0), 180);
  assert.equal(bearing(0, 0, 0, -1), 270);
});
test('figure eight clamps time and adds its altitude profile to the base height', () => {
  assert.deepEqual(sampleRoute(-5, 450), sampleRoute(0, 450));
  assert.deepEqual(sampleRoute(125, 450), sampleRoute(120, 450));
  assert.equal(sampleRoute(0, 600).ellipsoidHeightM, 600);
  assert.equal(sampleRoute(60, 600).ellipsoidHeightM, 720);
  const start = sampleRoute(0,450), crossing = sampleRoute(60,450), end = sampleRoute(120,450);
  assert.ok(Math.abs(start.longitudeDeg-crossing.longitudeDeg)<1e-9);
  assert.ok(Math.abs(start.latitudeDeg-crossing.latitudeDeg)<1e-9);
  assert.ok(Math.abs(start.longitudeDeg-end.longitudeDeg)<1e-9);
  assert.ok(Math.abs(start.latitudeDeg-end.latitudeDeg)<1e-9);
  assert.equal(end.ellipsoidHeightM,start.ellipsoidHeightM);
  assert.ok(sampleRoute(30,450).longitudeDeg>start.longitudeDeg);
  assert.ok(sampleRoute(90,450).longitudeDeg<start.longitudeDeg);
  assert.ok(sampleRoute(30,450).pitchDeg>0);
  assert.ok(sampleRoute(90,450).pitchDeg<0);
  for(let t=0;t<120;t+=.25) {
    const a=sampleRoute(t,450),b=sampleRoute(t+.01,450);
    const delta=(bearing(a.latitudeDeg,a.longitudeDeg,b.latitudeDeg,b.longitudeDeg)-a.headingDeg+540)%360-180;
    assert.ok(Math.abs(delta)<.2);
  }
});

import { terrainHeightAt, resolveHeight } from './altitude.ts';
test('AGL adds terrain height, including below-ellipsoid terrain', () => {
  assert.equal(resolveHeight('agl', 25, 300), 325);
  assert.equal(resolveHeight('agl', 25, -32), -7);
  assert.equal(resolveHeight('ellipsoid', 25, 300), 25);
  assert.equal(resolveHeight('agl', 25, undefined), undefined);
  assert.equal(resolveHeight('agl', 25, NaN), undefined);
});
test('terrain profile interpolates continuously and supports seeks and endpoints', () => {
  assert.equal(terrainHeightAt([100, 120, 80], 0.125), 110);
  assert.equal(terrainHeightAt([100, 120, 80], 0.5), 80);
  assert.equal(terrainHeightAt([100, 120, 80], 0), 100);
  assert.equal(terrainHeightAt([100, 120, 80], 900), 80);
  assert.equal(terrainHeightAt([], 0), undefined);
  assert.equal(terrainHeightAt([100, NaN], 0.125), undefined);
});

import { parseTelemetry, VehicleState, fresh, cameraAxes } from './telemetry/yalb.ts';
const observed = '2026-10-15T15:00:00Z';
function positionFrame(extra = {}, vehicleId = { systemId: 1, componentId: 1 }) {
  return JSON.stringify({ vehicleId, globalPosition: { latDeg: 37.77, lonDeg: -122.42, altMslM: 10, hdgCdeg: 9000, timeBootMs: 1000, observedAt: observed, ...extra } });
}
test('YALB protobuf JSON preserves normalized units and unknown heading', () => {
  const event = parseTelemetry(positionFrame());
  assert.equal(event?.id, '1:1');
  assert.equal(event?.kind, 'position');
  if (event?.kind === 'position') { assert.equal(event.value.msl, 10); assert.equal(event.value.heading, 90); }
  const unknown = parseTelemetry(positionFrame({ hdgCdeg: 65535 }));
  if (unknown?.kind === 'position') assert.equal(unknown.value.heading, undefined);
  const zero = parseTelemetry(JSON.stringify({ vehicleId: { systemId: 1, componentId: 1 }, globalPosition: { observedAt: observed } }));
  assert.ok(zero?.kind === 'position' && zero.value.lat === 0 && zero.value.msl === 0);
  for (const frame of ['bad json', positionFrame({ latDeg: 91 }), positionFrame({ altMslM: '10' }), positionFrame({ observedAt: 'bad' }), positionFrame({}, { systemId: 0, componentId: 1 })]) {
    assert.equal(parseTelemetry(frame), undefined);
  }
});
test('vehicle state separates identities, rejects old fixes and clears attitude on reboot', () => {
  const state = new VehicleState();
  state.accept(parseTelemetry(positionFrame())!);
  state.accept(parseTelemetry(positionFrame({ altMslM: 200, observedAt: '2026-10-15T14:59:59Z' }))!);
  assert.equal(state.vehicles.get('1:1')?.position?.msl, 10);
  state.accept(parseTelemetry(positionFrame({ altMslM: 40 }, { systemId: 2, componentId: 1 }))!);
  assert.equal(state.vehicles.get('2:1')?.position?.msl, 40);
  state.accept(parseTelemetry(JSON.stringify({ vehicleId: { systemId: 1, componentId: 1 }, attitude: { observedAt: observed, timeBootMs: 1000, yawRad: 1 } }))!);
  state.accept(parseTelemetry(positionFrame({ timeBootMs: 10, observedAt: '2026-10-15T15:00:01Z' }))!);
  assert.equal(state.vehicles.get('1:1')?.attitude, undefined);
});
test('freshness rejects stale bootstrap and future clock mismatches', () => {
  const now = Date.parse(observed);
  assert.equal(fresh(now - 3000, now), false);
  assert.equal(fresh(now + 2000, now), false);
  assert.equal(fresh(now - 100, now), true);
});
test('FRD/NED attitude maps north, east, nose-up and right-wing-down correctly', () => {
  assert.deepEqual(cameraAxes(0, 0, 0).direction, [0, 1, 0]);
  const east = cameraAxes(Math.PI / 2, 0, 0);
  assert.ok(Math.abs(east.direction[0] - 1) < 1e-12);
  assert.ok(cameraAxes(0, Math.PI / 6, 0).direction[2] > 0);
  assert.ok(cameraAxes(0, 0, Math.PI / 6).up[0] > 0);
  const { direction: d, up: u } = cameraAxes(1, 0.3, 0.7);
  assert.ok(Math.abs(d.reduce((n, x, i) => n + x * u[i], 0)) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-12);
});

import { parseAircraft, aircraftPose } from './telemetry/aircraft.ts';
const aircraftNow = 1792076400000;
const aircraftRow = { hex: 'a12345', flight: ' TEST123 ', lat: 37.8, lon: -122.4, alt_geom: 10000, alt_baro: 9800, seen_pos: 2, track: 90, gs: 200, geom_rate: 600 };
test('aircraft feed uses geometric feet as ellipsoid meters and preserves source age', () => {
  const [a] = parseAircraft({ now: aircraftNow, ac: [aircraftRow] });
  assert.equal(a.height, 3048);
  assert.equal(a.observed, aircraftNow - 2000);
  assert.equal(a.callsign, 'TEST123');
  assert.ok(Math.abs(a.speed! - 102.8888) < 1e-6);
  assert.equal(parseAircraft({ now: aircraftNow / 1000, ac: [aircraftRow] })[0].observed, a.observed);
});
test('aircraft without valid geometric altitude, fresh position or airborne state are skipped', () => {
  for (const extra of [{ alt_geom: undefined }, { alt_geom: null }, { alt_baro: 'ground' }, { lat: 95 }, { seen_pos: 60 }, { seen_pos: -1 }, { hex: 'invalid' }]) {
    assert.deepEqual(parseAircraft({ now: aircraftNow, ac: [{ ...aircraftRow, ...extra }] }), []);
  }
  assert.throws(() => parseAircraft({ ac: [] }));
});
test('aircraft prediction is bounded, then held and expired', () => {
  const [a] = parseAircraft({ now: aircraftNow, ac: [{ ...aircraftRow, seen_pos: 0 }] });
  const p = aircraftPose(a, aircraftNow + 5000)!;
  assert.ok(p.lon > a.lon); assert.equal(p.state, 'PREDICTED');
  const held = aircraftPose(a, aircraftNow + 20000)!;
  assert.equal(held.state, 'HELD');
  assert.equal(held.lon, aircraftPose(a, aircraftNow + 10000)!.lon);
  assert.equal(aircraftPose(a, aircraftNow + 31000), undefined);
  assert.equal(aircraftPose(a, aircraftNow - 2000), undefined);
});

import { aircraftFollowPose } from './telemetry/aircraft.ts';
test('aircraft selection resolves position without requiring reported course', () => {
  const [aircraft] = parseAircraft({ now: aircraftNow, ac: [{ ...aircraftRow, track: undefined, seen_pos: 0 }] });
  const pose = aircraftFollowPose(aircraft, aircraftNow, 45)!;
  assert.equal(pose.lat, aircraft.lat);
  assert.equal(pose.heading, 45);
  assert.equal(pose.headingInferred, true);
  assert.equal(aircraftFollowPose(aircraft, aircraftNow + 31000, 45), undefined);
  assert.equal(aircraftFollowPose(undefined, aircraftNow, 45), undefined);
  const reported = aircraftFollowPose({ ...aircraft, course: 90 }, aircraftNow, 45)!;
  assert.equal(reported.heading, 90);
  assert.equal(reported.headingInferred, false);
});

import * as Cesium from 'cesium';
import { projectTrafficPoint } from './trafficProjection.ts';
test('traffic projection never sends selected, co-located, near-eye or behind-eye points to Cesium', () => {
  const scene = { camera: { positionWC: new Cesium.Cartesian3(100, 0, 0), directionWC: new Cesium.Cartesian3(1, 0, 0) } } as Cesium.Scene;
  let calls = 0;
  const project = () => { calls++; return new Cesium.Cartesian2(10, 20); };
  for (const [point, selected] of [
    [new Cesium.Cartesian3(200, 0, 0), true],
    [new Cesium.Cartesian3(100, 0, 0), false],
    [new Cesium.Cartesian3(100.000001, 0, 0), false],
    [new Cesium.Cartesian3(99, 0, 0), false],
    [new Cesium.Cartesian3(NaN, 0, 0), false],
  ] as const) assert.equal(projectTrafficPoint(scene, point, selected, project), undefined);
  assert.equal(calls, 0);
  assert.deepEqual(projectTrafficPoint(scene, new Cesium.Cartesian3(200, 0, 0), false, project), new Cesium.Cartesian2(10, 20));
  assert.equal(calls, 1);
});

import { parseWind, windArrowRotation, weatherFresh } from './layers/weatherData.ts';
import { refreshLayer } from './layers/refresh.ts';
import { radarTime } from '../build/weather-proxy.js';
test('wind validates complete numeric grids and converts meteorological from direction to flow', () => {
  const grid = { centerLat:44.5, centerLon:-73.2, model:'GFS', points:Array.from({length:9},()=>({lat:44.5,lon:-73.2,time:1792083600,speed:4,from:0})) };
  assert.equal(parseWind(grid).points[0].speed,4);
  assert.equal(windArrowRotation(0),180);
  assert.equal(windArrowRotation(90),270);
  assert.throws(()=>parseWind({...grid,points:[...grid.points.slice(0,8),{...grid.points[8],speed:null}]}));
  assert.throws(()=>parseWind({...grid,points:[]}));
  assert.equal(weatherFresh(1000,2000,2000),true);
  assert.equal(weatherFresh(1000,10000,2000),false);
  assert.equal(weatherFresh(900000,1000,2000),false);
});
test('radar time comes from the requested product, not another metadata layer', () => {
  const xml='<Layer><Name>other</Name><Extent name="time" default="2026-10-15T12:00:00Z"/></Layer><Layer><Name>conus_base_reflectivity_mosaic</Name><Extent name="time" default="2026-10-15T13:00:00Z"/></Layer>';
  assert.equal(radarTime(xml),'2026-10-15T13:00:00.000Z');
  assert.throws(()=>radarTime('<Layer><Name>other</Name></Layer>'));
  assert.throws(()=>radarTime('<Layer><Name>conus_base_reflectivity_mosaic</Name><Extent name="time" default="bad"/></Layer>'));
});
test('disabling a refreshing layer aborts work and prevents a late response from scheduling more', async () => {
  let signal: AbortSignal | undefined, complete: (()=>void) | undefined, runs=0, failures=0;
  const layer=refreshLayer(1,async s=>{runs++;signal=s;await new Promise<void>(resolve=>{complete=resolve;});s.throwIfAborted();},()=>{failures++;});
  layer.start();assert.equal(runs,1);layer.stop();assert.equal(signal?.aborted,true);complete!();
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(runs,1);assert.equal(failures,0);
});

import { aircraftModels, modelForAircraft } from './aircraftModels.ts';
import { readFileSync } from 'node:fs';
test('hangar matches known aircraft families conservatively and retains unknown contacts as markers',()=>{
  assert.equal(modelForAircraft('c172')?.id,'c172');
  assert.equal(modelForAircraft('B788')?.id,'b789');
  assert.equal(modelForAircraft('AT76')?.id,'atr72');
  assert.equal(modelForAircraft('B06')?.id,'bell206');
  assert.equal(modelForAircraft('C550')?.id,'citation2');
  assert.equal(modelForAircraft('B744')?.id,'airplane');
  assert.equal(modelForAircraft('MQ9')?.id,'mq9');
  assert.equal(modelForAircraft('F35'),undefined);
  assert.equal(modelForAircraft(undefined),undefined);
});
test('each hangar model is a complete glTF binary with local embedded resources and attribution',()=>{
  const notice=readFileSync(new URL('../public/models/README.md',import.meta.url),'utf8');
  for(const model of aircraftModels){
    const bytes=readFileSync(new URL('../public/models/'+model.file,import.meta.url));
    assert.equal(bytes.toString('utf8',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
    const size=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+size));
    for(const resource of [...(gltf.buffers??[]),...(gltf.images??[])])assert.ok(!resource.uri||resource.uri.startsWith('data:'));
    assert.ok(notice.includes(model.file));assert.ok(notice.includes(model.source));
  }
});

import { parseOrbits,constellation,lookAtOrbit,skyPoint,orbitFresh } from './gnss.ts';
import { ecfToLookAngles,geodeticToEcf } from 'satellite.js';
test('GNSS classification separates Galileo from similarly named Indian spacecraft',()=>{
 assert.equal(constellation('GPS BIIR-5 (PRN 22)'),'GPS');
 assert.equal(constellation('GSAT0101 (GALILEO-PFM)'),'Galileo');
 assert.equal(constellation('GSAT-10 (GAGAN/PRN 128)'),'Other');
 assert.equal(constellation('COSMOS 2436 (723)'),'GLONASS');
 assert.equal(constellation('BEIDOU-3 M3 (C21)'),'BeiDou');
});
test('sky projection puts north at top, east right and zenith at center',()=>{
 assert.deepEqual(skyPoint(0,0),{x:160,y:30});
 assert.deepEqual(skyPoint(90,0),{x:290,y:160});
 assert.deepEqual(skyPoint(0,90),{x:160,y:160});
 assert.ok(Math.abs(skyPoint(180,0).y-290)<1e-9);
});
test('GNSS propagation produces physical MEO ranges and deterministic observer angles',()=>{
 const omm=JSON.parse(readFileSync(new URL('../fixtures/gnss-gps-omm.json',import.meta.url),'utf8'));
 const [orbit]=parseOrbits([omm,omm]);assert.equal(parseOrbits([omm,omm]).length,1);
 const observer={lat:44.4759,lon:-73.222,heightM:100},now=orbit.epoch;
 const look=lookAtOrbit(orbit,observer,now)!;
 assert.ok(look);assert.ok(look.azimuth>=0&&look.azimuth<360);assert.ok(look.elevation>=-90&&look.elevation<=90);assert.ok(look.rangeKm>19000&&look.rangeKm<34000);
 lookAtOrbit(orbit,observer,now+3600000);
 const again=lookAtOrbit(orbit,observer,now)!;assert.ok(Math.abs(again.elevation-look.elevation)<1e-7);
 assert.equal(lookAtOrbit(orbit,observer,now+8*86400000),undefined);
 assert.equal(lookAtOrbit(orbit,{...observer,lat:91},now),undefined);
 assert.equal(orbitFresh(now,now+8*86400000),false);
 assert.throws(()=>parseOrbits([{...omm,MEAN_MOTION:0}]));assert.throws(()=>parseOrbits([{...omm,ECCENTRICITY:1}]));
});
test('look-angle calculation uses kilometers for observer height and satellite range',()=>{
 const observer={latitude:0,longitude:0,height:.1};
 const satellite=geodeticToEcf({...observer,height:20200.1});
 const look=ecfToLookAngles(observer,satellite);
 assert.ok(Math.abs(look.elevation-Math.PI/2)<1e-10);assert.ok(Math.abs(look.rangeSat-20200)<1e-8);
});

import { orbitEcfMeters } from './gnss.ts';
test('3D GNSS ECEF coordinates use meters and agree with observer sky angles',()=>{
 const omm=JSON.parse(readFileSync(new URL('../fixtures/gnss-gps-omm.json',import.meta.url),'utf8'));
 const [orbit]=parseOrbits([omm]);const now=orbit.epoch,observer={lat:44.4759,lon:-73.222,heightM:100};
 const point=orbitEcfMeters(orbit,now)!;assert.ok(point);
 assert.ok(Math.hypot(point.x,point.y,point.z)>24000000);assert.ok(Math.hypot(point.x,point.y,point.z)<30000000);
 const angles=ecfToLookAngles({latitude:observer.lat*Math.PI/180,longitude:observer.lon*Math.PI/180,height:observer.heightM/1000},{x:point.x/1000,y:point.y/1000,z:point.z/1000});
 const look=lookAtOrbit(orbit,observer,now)!;assert.ok(Math.abs(angles.elevation*180/Math.PI-look.elevation)<1e-8);
 assert.equal(orbitEcfMeters(orbit,now+8*86400000),undefined);
 const later=orbitEcfMeters(orbit,now+3600000)!;assert.ok(Math.hypot(later.x-point.x,later.y-point.y,later.z-point.z)>1000000);
});

import { satelliteClearOfEarth } from './gnssGeometry.ts';
test('3D satellite markers respect the Earth ellipsoid and never normalize a coincident point',()=>{
 const camera=Cesium.Cartesian3.fromDegrees(0,0,100);
 assert.equal(satelliteClearOfEarth(camera,Cesium.Cartesian3.fromDegrees(0,0,20200000)),true);
 assert.equal(satelliteClearOfEarth(camera,Cesium.Cartesian3.fromDegrees(180,0,20200000)),false);
 assert.equal(satelliteClearOfEarth(camera,camera),false);
 const orbitCamera=Cesium.Cartesian3.fromDegrees(0,0,80000000);
 assert.equal(satelliteClearOfEarth(orbitCamera,Cesium.Cartesian3.fromDegrees(90,0,20200000)),true);
 assert.equal(satelliteClearOfEarth(orbitCamera,Cesium.Cartesian3.fromDegrees(180,0,20200000)),false);
});

import { aircraftFrame, followCameraPose } from './followCamera.ts';
test('follow camera stays behind course and preserves orthonormal axes at every heading', () => {
  const position = Cesium.Cartesian3.fromDegrees(-73.2,44.47,500);
  for (const courseDeg of [0,90,180,270,359]) {
    const pose = {position,courseDeg,yawDeg:courseDeg,pitchDeg:0,rollDeg:0};
    const camera = followCameraPose(pose,true,40,12);
    const forward = Cesium.Matrix4.multiplyByPointAsVector(aircraftFrame(pose),Cesium.Cartesian3.UNIT_X,new Cesium.Cartesian3());
    const offset = Cesium.Cartesian3.subtract(camera.destination,position,new Cesium.Cartesian3());
    assert.ok(Cesium.Cartesian3.dot(offset,forward)<-39);
    assert.ok(Math.abs(Cesium.Cartesian3.magnitude(offset)-40)<1e-8);
    assert.ok(Math.abs(Cesium.Cartesian3.dot(camera.orientation.direction,camera.orientation.up))<1e-10);
    const target = Cesium.Cartesian3.add(camera.destination,Cesium.Cartesian3.multiplyByScalar(camera.orientation.direction,40,new Cesium.Cartesian3()),new Cesium.Cartesian3());
    assert.ok(Cesium.Cartesian3.distance(target,position)<1e-8);
  }
});
test('stable follow ignores attitude while aircraft follow responds to yaw, pitch and roll', () => {
  const level = {position:Cesium.Cartesian3.fromDegrees(0,0,500),courseDeg:0,yawDeg:0,pitchDeg:0,rollDeg:0};
  const banked = {...level,yawDeg:30,pitchDeg:20,rollDeg:45};
  assert.deepEqual(followCameraPose(level,true,40,12),followCameraPose(banked,true,40,12));
  const stable = followCameraPose(banked,true,40,12), body = followCameraPose(banked,false,40,12);
  assert.ok(Cesium.Cartesian3.distance(stable.destination,body.destination)>10);
  assert.ok(Cesium.Cartesian3.distance(stable.orientation.up,body.orientation.up)>.5);
});

test('synthetic bank follows turn direction, reverses between lobes and stays bounded', () => {
  for (let t = 0; t < durationSeconds; t += .1) {
    const pose = sampleRoute(t, 100), next = sampleRoute(t + .001, 100);
    const turn = (next.headingDeg - pose.headingDeg + 540) % 360 - 180;
    assert.ok(Number.isFinite(pose.rollDeg));
    assert.ok(Math.abs(pose.rollDeg) <= 35);
    if (Math.abs(pose.rollDeg) > .01) assert.equal(Math.sign(pose.rollDeg), Math.sign(turn));
    assert.ok(Math.abs(next.rollDeg - pose.rollDeg) < .02);
  }
  assert.ok(sampleRoute(30,100).rollDeg > 0);
  assert.ok(sampleRoute(90,100).rollDeg < 0);
  for (const t of [0,60,120]) assert.ok(Math.abs(sampleRoute(t,100).rollDeg) < 1e-10);
});

test('aircraft attitude raises the nose on climb and lowers the right wing on right bank', () => {
  const position = Cesium.Cartesian3.fromDegrees(0,0,500);
  const pose = {position,courseDeg:0,yawDeg:0,pitchDeg:10,rollDeg:25};
  const frame = aircraftFrame(pose);
  const localUp = Cesium.Cartesian3.UNIT_X; // ECEF up at lat/lon 0.
  const nose = Cesium.Matrix4.multiplyByPointAsVector(frame,Cesium.Cartesian3.UNIT_X,new Cesium.Cartesian3());
  const right = Cesium.Matrix4.multiplyByPointAsVector(frame,new Cesium.Cartesian3(0,-1,0),new Cesium.Cartesian3());
  assert.ok(Cesium.Cartesian3.dot(nose,localUp) > 0);
  assert.ok(Cesium.Cartesian3.dot(right,localUp) < 0);
  const descending = aircraftFrame({...pose,pitchDeg:-10,rollDeg:-25});
  assert.ok(Cesium.Matrix4.multiplyByPointAsVector(descending,Cesium.Cartesian3.UNIT_X,new Cesium.Cartesian3()).x < 0);
  assert.ok(Cesium.Matrix4.multiplyByPointAsVector(descending,new Cesium.Cartesian3(0,-1,0),new Cesium.Cartesian3()).x > 0);
});

test('steeper altitude ramps produce visible pitch with smooth level transitions', () => {
  assert.ok(sampleRoute(30,100).pitchDeg > 15);
  assert.ok(sampleRoute(90,100).pitchDeg < -15);
  for (const t of [0,22,38,60,82,98,120]) {
    assert.ok(Math.abs(sampleRoute(t,100).pitchDeg) < 1e-10);
    assert.ok(Math.abs(sampleRoute(t+.001,100).pitchDeg-sampleRoute(t-.001,100).pitchDeg) < .001);
  }
  assert.equal(sampleRoute(22,100).ellipsoidHeightM,100);
  assert.equal(sampleRoute(38,100).ellipsoidHeightM,220);
  assert.equal(sampleRoute(82,100).ellipsoidHeightM,220);
  assert.equal(sampleRoute(98,100).ellipsoidHeightM,100);
  for (let t=.01;t<120;t+=.1) {
    const pose=sampleRoute(t,100);
    assert.ok(pose.heightOffsetM >= 0 && pose.heightOffsetM <= 120);
    const slope=(sampleRoute(t+.001,100).heightOffsetM-sampleRoute(t-.001,100).heightOffsetM)/.002;
    if(Math.abs(slope)>.001) assert.equal(Math.sign(pose.pitchDeg),Math.sign(slope));
  }
});

import { sampleDemoDirector, demoDirectorCamera } from './flightDirector.ts';
test('demo director keeps synthetic intent separate from motion and attitude', () => {
  const sample=sampleDemoDirector(26), route=sampleRoute(26,0), lead=sampleRoute(28,0);
  assert.equal(sample.motion.courseDeg,route.headingDeg);
  assert.equal(sample.motion.climbDeg,route.pitchDeg);
  assert.equal(sample.command?.headingDeg,lead.headingDeg);
  assert.equal(sample.command?.pitchDeg,lead.pitchDeg);
  assert.equal(sample.command?.provenance,'synthetic');
  assert.equal(sample.command?.timeSeconds,sample.timeSeconds);
  assert.notEqual(sample.attitude.yawDeg,sample.motion.courseDeg);
  assert.notEqual(sample.command?.headingDeg,sample.motion.courseDeg);
  assert.deepEqual(sampleDemoDirector(-5),sampleDemoDirector(0));
  assert.deepEqual(sampleDemoDirector(200),sampleDemoDirector(120));
});
test('director camera is deterministic across seeks and inherits only partial bank', () => {
  const position=Cesium.Cartesian3.fromDegrees(-73.2,44.47,500);
  const first=demoDirectorCamera(30,position);
  demoDirectorCamera(90,position);
  assert.deepEqual(demoDirectorCamera(30,position),first);
  const delayed=sampleDemoDirector(29.65);
  assert.equal(first.rollDeg,delayed.attitude.rollDeg*.3);
  assert.equal(first.pitchDeg,delayed.attitude.pitchDeg*.7);
  assert.equal(first.yawDeg,delayed.attitude.yawDeg);
  assert.equal(first.position,position);
});

import { steeringError, formatSteer, currentCommand } from './flightDirector.ts';
test('director steering error wraps heading and drops stale commands', () => {
  const base = { timeSeconds: 10, motion: { courseDeg: 355, climbDeg: 1 }, attitude: { yawDeg: 355, pitchDeg: 1, rollDeg: 0 } };
  const fresh = { ...base, command: { timeSeconds: 10, headingDeg: 5, pitchDeg: -1, provenance: 'synthetic' as const } };
  const error = steeringError(fresh)!;
  assert.ok(Math.abs(error.rightDeg - 10) < 1e-9 && Math.abs(error.upDeg + 2) < 1e-9);
  assert.equal(formatSteer(error), 'R 10.0° · down 2.0°');
  assert.equal(formatSteer({ rightDeg: -3.25, upDeg: 0 }), 'L 3.3° · 0.0°');
  const stale = { ...base, command: { ...fresh.command, timeSeconds: 9.4 } };
  assert.equal(currentCommand(stale), undefined);
  assert.equal(steeringError(stale), undefined);
  assert.equal(steeringError(base), undefined);
});

import { initialSandboxState, stepSandbox, sandboxGroundSpeedMps } from './sandboxFlight.ts';
test('keyboard sandbox coordinates bank and heading while pitch controls altitude', () => {
  const start=initialSandboxState();
  let right=start,left=start,up=start,down=start;
  for(let i=0;i<600;i++) {
    right=stepSandbox(right,{pitch:0,bank:1},1/120);
    left=stepSandbox(left,{pitch:0,bank:-1},1/120);
    up=stepSandbox(up,{pitch:1,bank:0},1/120);
    down=stepSandbox(down,{pitch:-1,bank:0},1/120);
  }
  assert.ok(right.rollDeg>35&&right.headingDeg>start.headingDeg);
  assert.ok(left.rollDeg< -35&&left.headingDeg<start.headingDeg);
  assert.ok(up.pitchDeg>24&&up.ellipsoidHeightM>start.ellipsoidHeightM);
  assert.ok(down.pitchDeg< -24&&down.ellipsoidHeightM<start.ellipsoidHeightM);
  const before=right.headingDeg;
  for(let i=0;i<600;i++)right=stepSandbox(right,{pitch:0,bank:0},1/120);
  assert.ok(Math.abs(right.rollDeg)<.02);
  assert.ok(right.headingDeg>before);
  const level=stepSandbox(start,{pitch:0,bank:0},.1);
  const north=(level.latitudeDeg-start.latitudeDeg)*111320;
  const east=(level.longitudeDeg-start.longitudeDeg)*111320*Math.cos(start.latitudeDeg*Math.PI/180);
  assert.ok(Math.abs(Math.hypot(north,east)-sandboxGroundSpeedMps*.1)<1e-6);
  assert.equal(level.ellipsoidHeightM,start.ellipsoidHeightM);
});
test('sandbox bounds attitude, wraps heading and limits altitude', () => {
  let state={...initialSandboxState(),headingDeg:359,ellipsoidHeightM:3999};
  for(let i=0;i<1200;i++)state=stepSandbox(state,{pitch:1,bank:1},1/120);
  assert.ok(state.headingDeg>=0&&state.headingDeg<360);
  assert.ok(state.rollDeg<=40&&state.pitchDeg<=25);
  assert.ok(state.ellipsoidHeightM<=4000);
  let low={...initialSandboxState(),ellipsoidHeightM:101};
  for(let i=0;i<1200;i++)low=stepSandbox(low,{pitch:-1,bank:0},1/120);
  assert.ok(low.ellipsoidHeightM>=100);
  assert.deepEqual(initialSandboxState(),initialSandboxState());
});

test('holding keys progressively builds commands and reverses smoothly', () => {
  let state=initialSandboxState();
  const held={pitch:1,bank:1};
  for(let i=0;i<12;i++)state=stepSandbox(state,held,1/120);
  assert.ok(Math.abs(state.commandBankDeg-1.5)<1e-10);
  assert.ok(Math.abs(state.commandPitchDeg-1)<1e-10);
  assert.ok(state.rollDeg<1);
  for(let i=0;i<228;i++)state=stepSandbox(state,held,1/120);
  assert.ok(Math.abs(state.commandBankDeg-30)<1e-9);
  assert.ok(Math.abs(state.commandPitchDeg-20)<1e-9);
  const reverse=stepSandbox(state,{pitch:-1,bank:-1},1/120);
  assert.ok(reverse.commandBankDeg<state.commandBankDeg&&reverse.commandBankDeg>0);
  assert.ok(reverse.commandPitchDeg<state.commandPitchDeg&&reverse.commandPitchDeg>0);
  const release=stepSandbox(state,{pitch:0,bank:0},1/120);
  assert.ok(release.commandBankDeg<state.commandBankDeg&&release.commandBankDeg>0);
});
