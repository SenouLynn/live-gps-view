export const aircraftModels = [
  { id:'c172', name:'Cessna 172', family:'Light aircraft', file:'c172.glb', creator:'e737', source:'https://sketchfab.com/3d-models/cessna-172-64cddaee5aff470682659a8c08525046', radius:7 },
  { id:'bell206', name:'Bell 206 JetRanger', family:'Helicopter', file:'bell206.glb', creator:'terran4627', source:'https://sketchfab.com/3d-models/bell-206-jetranger-d2f7ba1d671549d4b26aaf834139a1dd', radius:8.24 },
  { id:'citation2', name:'Cessna Citation II', family:'Business jet', file:'citation2.glb', creator:'BlenderCommunityHead', source:'https://sketchfab.com/3d-models/1990-cessna-citation-texture-detailed-exterior-a78839624fe64900a8352cb23462350a', radius:11.24 },
  { id:'atr72', name:'ATR 72-600', family:'Regional turboprop', file:'atr72.glb', creator:'Oyan3D', source:'https://sketchfab.com/3d-models/atr-72-600-1e1a7186f7444d288675262fcee44744', radius:19.49 },
  { id:'b789', name:'Boeing 787-9', family:'Widebody airliner', file:'b789.glb', creator:'Nobilis 2', source:'https://sketchfab.com/3d-models/boeing-787-9-b6711e2e698e4e469675c1154a50b7a3', radius:44.08 },
  { id:'airplane', name:'Boeing 747', family:'Four-engine airliner', file:'airplane.glb', creator:'zairiq-123', source:'https://sketchfab.com/3d-models/boeing-747-9b16672038ba48f98e6d80a159044ed9', radius:48 },
  { id:'mq9', name:'MQ-9', family:'Uncrewed aircraft', file:'mq9.glb', creator:'IProZenoN', source:'https://sketchfab.com/3d-models/mq-9-fabe963feb354c5584b51f9c470c3f7e', radius:12 },
  { id:'jet', name:'Private jet', family:'Generic jet study', file:'jet.glb', creator:'Nick the Name', source:'https://sketchfab.com/3d-models/private-jet-cbdd1de6ced9461e950eafaa302cc82b', radius:15 },
] as const;
export type AircraftModel = typeof aircraftModels[number];
/** Conservative family matching; no inference about military status or a specific registration. */
export function modelForAircraft(type?: string): AircraftModel | undefined {
  const value=type?.trim().toUpperCase();
  const id = value==='C172' ? 'c172' : value && ['B06','B06T'].includes(value) ? 'bell206'
    : value && /^C(500|501|550|551|560)$/.test(value) ? 'citation2'
    : value && /^AT(72|73|75|76)$/.test(value) ? 'atr72'
    : value && /^B78[89X]$/.test(value) ? 'b789'
    : value && /^B74[12348]$/.test(value) ? 'airplane'
    : value && ['MQ9','PRED'].includes(value) ? 'mq9' : undefined;
  return aircraftModels.find(model=>model.id===id);
}
