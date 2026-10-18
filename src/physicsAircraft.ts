/** Only aircraft with a bundled, tested flight model belong in the physics hangar. */
export const physicsAircraft = [{
  id: 'c172p', name: 'Cessna 172P', visualModelId: 'c172', engine: 'JSBSim', initialAirspeedKt: 100,
  assets: ['aircraft/c172p/c172p.xml', 'engine/eng_io320.xml', 'engine/prop_75in2f.xml'],
}] as const;
export const defaultPhysicsAircraft = physicsAircraft[0];
