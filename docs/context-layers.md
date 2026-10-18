# Context layers: integration scope

Requested: wind, observed weather, military flights, GNSS integrity, and mapped installations. The first slice is implemented: a Layers panel, regional GFS wind arrows and observed NOAA radar in a separate regional map, plus the existing aircraft controls. The remaining items below are the integration backlog.

## Source findings

Inspected God's Eye View commit `4d88dd29f59c1dfb1efb69435112b3b17293d3c7`, particularly `DATA_SOURCES.md`, `src/layers/wind`, `src/layers/gnss`, `src/layers/installations`, and aircraft providers.

| Layer | Reference approach | First useful slice here |
| --- | --- | --- |
| Wind | NOAA GFS / ECMWF IFS 10 m model fields; GRIB byte-range fetching, ecCodes WASM decoding and animated flow | A bounded regional model field with direction/speed, model run time, valid time and reference height. Add animation after data validation. Never call model wind an observation or imply 10 m wind is aircraft-altitude wind. |
| Observed weather | NOAA nowCOAST MRMS radar, GOES infrared, lightning density and product-specific timestamps | Burlington-area radar overlay with latest observation time, opacity, stale/error status and legend. Then add time playback, infrared and lightning density. |
| Military flights | Separate ADSB.lol military feed/registry reconciled with ordinary traffic | Preserve provider classification metadata in the existing aircraft adapter; filter/style identified military contacts without duplicating entities or inventing classification from callsigns. An optional dedicated source can follow. |
| GNSS integrity | ADS-B-reported NIC/NACp and GPS-loss evidence, bounded rolling aggregation | Show sourced per-contact quality facts and sample counts first. Regional aggregation needs explicit time windows, data-origin checks and insufficient-evidence states. Do not label a quality anomaly as confirmed jamming or spoofing. |
| Mapped installations | OpenFreeMap military polygons plus a bundled name index; optional Overpass/Places paths | Bounded public mapped footprints/points near the view, names, feature class and source. Mapping is not evidence of present activity or occupancy. |

## Build order

1. Introduce a compact Layers panel and shared lifecycle: enable/disable, fetch cancellation, refresh/backoff, source timestamp, credits, bounds and error status. Move existing traffic controls into it. Keep camera telemetry independent.
2. Add observed radar and regional wind as separate products. Observed radar and forecast wind must have separate clocks; weather playback must not rewind live aircraft or SITL.
3. Add military classification/filtering to existing traffic, using the same contact identity and cockpit selection.
4. Add mapped installations as optional geographic entities; avoid unsolicited worldwide downloads.
5. Add GNSS evidence inspection, then a separately validated aggregation view if needed.

## Rendering and correctness

- Default new layers off until enabled; stop their work when disabled. Keep budgets per layer so weather cannot stall the cockpit.
- A globe imagery layer alone will not cover Google photogrammetry when the globe is hidden. Radar needs an explicit compatible overlay implementation for the Google scene, or an honest terrain-only availability state. Do not add an invisible WMS layer and call it complete.
- Place wind visualization at a declared reference surface/height. Forecast flow is visualized data, not a simulated force on the vehicle.
- Atmospheric rain/cloud effects, if added, are a separate synthetic presentation. Open-Meteo current conditions are model-derived and must not be relabeled as station observations.
- Distinguish own-vehicle GNSS telemetry from integrity evidence inferred from other aircraft. Neither should overwrite the other.
- Preserve provider timestamps through caching; show stale/missing data rather than empty-as-normal or fabricated replacements.
- Validate each layer first against fixtures (including empty, malformed, stale and unavailable responses), then its public endpoint and browser rendering over both scene types.

## Primary references

- Reference implementation/source inventory: https://github.com/bilawalsidhu/gods-eye-view/blob/4d88dd29f59c1dfb1efb69435112b3b17293d3c7/DATA_SOURCES.md
- NOAA nowCOAST: https://nowcoast.noaa.gov/
- ECMWF Open Data: https://www.ecmwf.int/en/forecasts/datasets/open-data
- Open-Meteo model API: https://open-meteo.com/en/docs
- ADSB.lol API and ODbL attribution: https://www.adsb.lol/docs/open-data/api/
- readsb quality-field definitions: https://github.com/wiedehopf/readsb/blob/dev/README-json.md

Next implementation target: military classification/filtering within existing traffic. Satellite infrared, lightning, GNSS integrity and mapped installations are still pending. The initial weather slice uses Open-Meteo GFS rather than direct GRIB decoding; model run time is not available from that endpoint. A separate inset displays weather over its own aligned basemap in both scene modes; full-scene radar draping and animated wind streamlines remain future work.

## Drone airspace overlay (U.S.)

The sidebar now has independent FAA authorization-ceiling, national-security-restriction, and recreational-fixed-site layers. **Airspace map** suspends the flight camera and opens a regional overhead view; **Return to flight** restores it. Move the map and use **Refresh here** to query a new 1° × 1° region. Polygons classify terrain and 3D tiles; labels and opacity can be adjusted. Click a zone for source properties. All layers default off and their toggles persist in the browser session.

The fixed upstreams are the production services referenced by the FAA map application (https://faa.maps.arcgis.com/apps/webappviewer/index.html?id=9c2e4406710048e19806ebf6a06754ad):

- `FAA_UAS_FacilityMap_Data/FeatureServer/0`: `CEILING` + `UNIT`, authorization thresholds labeled in feet AGL. Zero is a zero-foot threshold, not a blanket no-fly determination.
- `DoD_Mar_13/FeatureServer/0`: national security restriction footprints, with source floor/ceiling values in selected-zone details.
- `Recreational_Flyer_Fixed_Sites/FeatureServer/0`: designated recreational-site boundaries; site access and operating conditions still require verification.

All services are under `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/`. The Vite dev and preview proxy queries bounded envelopes with stable OBJECTID ordering, up to four 1,000-feature pages per layer, and explicitly marks partial coverage. It caches at most 32 region/layer results for five minutes and preserves retrieval and source-edit timestamps. ArcGIS can return rate-limit errors inside HTTP 200; these trigger a shared one-minute cooldown. Invalid or failed data never becomes successful empty coverage. Disabled layers cancel their requests and remove their entities; displayed data expires after ten minutes until refreshed.

These are surface footprints, not vertical airspace volumes or legal flight clearance. Coverage does not include all TFRs, NOTAMs, local restrictions, or international airspace. No green "safe to fly" inference is made from absent features. Metadata schemas were verified against the live FAA services. After an initial rate limit, the running local endpoint returned 483 Burlington-area ceiling polygons with no feature truncation. A Vite setup-hook return-value regression was fixed and covered by the proxy tests. Browser rendering over terrain and Google photogrammetry remains unverified.

### Location-picker update

Airspace browsing now uses the shared location-picker dialog rather than taking over the flight camera. The dedicated viewer has visible zoom, regional-map/globe controls, submitted Photon place search, coordinate entry, click-to-select, and FAA layer toggles. Both startup and the HUD can use it to choose a saved Sandbox starting point. Selecting a point while already in Sandbox updates its in-memory flight state as well as the saved session. Map close pauses its render loop and aborts pending requests. The main-scene airspace layers remain independent.

Verification: the running search route returned Burlington, Vermont and the Burlington airport with valid coordinates, and the shared FAA route returned 483 Burlington-area ceiling polygons. Browser rendering and gestures have not been visually verified.
