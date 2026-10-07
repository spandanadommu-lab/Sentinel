import type {
  Alert,
  AffectedZone,
  DataSource,
  FloodReading,
  Incident,
  RescueOperation,
  RescueTeam,
  Resource,
  Shelter,
  SystemEvent,
  WeatherReading,
} from "@workspace/api-zod";

export const demoId = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ago = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60_000);

const riskLevel = (score: number): AffectedZone["riskLevel"] =>
  score >= 81 ? "CRITICAL" : score >= 61 ? "HIGH" : score >= 31 ? "MODERATE" : "LOW";

export const incidents: Incident[] = [
  { id: demoId(1), title: "Penna river flooding — Zone 4", type: "FLOOD", severity: "CRITICAL", status: "ACTIVE", priority: "P1", description: "River levels are rising after sustained rainfall. A section of the eastern access road is reported blocked; verify routes before dispatch.", location: "Kadapa · Zone 4", lat: 14.4673, lng: 78.8242, riskScore: 87, estimatedPopulation: 18400, assignedTeamId: demoId(21), source: "Regional operations desk", classification: "SIMULATED", riskFactors: ["High rainfall", "Rising river conditions", "High population exposure", "Shelter pressure", "Rescue route partially blocked"], updatedAt: ago(8) },
  { id: demoId(2), title: "Low-lying wards under flood watch", type: "FLOOD", severity: "HIGH", status: "ACTIVE", priority: "P1", description: "Runoff is accumulating near the drainage channel. Monitoring teams report water entering low-lying lanes.", location: "Proddatur · Ward 11", lat: 14.7502, lng: 78.5484, riskScore: 74, estimatedPopulation: 12600, assignedTeamId: demoId(22), source: "Regional operations desk", classification: "SIMULATED", riskFactors: ["Heavy rainfall", "Drainage congestion", "Moderate shelter capacity"], updatedAt: ago(19) },
  { id: demoId(3), title: "Hill-slope movement reported", type: "LANDSLIDE", severity: "HIGH", status: "MONITORING", priority: "P2", description: "A slope movement has been reported beside the hill road. The extent and road status require field confirmation.", location: "Rayachoti · Hill road", lat: 14.0576, lng: 78.7511, riskScore: 68, estimatedPopulation: 2400, assignedTeamId: null, source: "District control room", classification: "SIMULATED", riskFactors: ["Slope instability", "Rainfall forecast", "Single access road"], updatedAt: ago(43) },
  { id: demoId(4), title: "Urban waterlogging", type: "STORM", severity: "MODERATE", status: "ACTIVE", priority: "P2", description: "Localized waterlogging has affected several streets. No structural damage has been confirmed.", location: "Jammalamadugu · Market area", lat: 14.8467, lng: 78.3857, riskScore: 53, estimatedPopulation: 4100, assignedTeamId: demoId(24), source: "Field report", classification: "SIMULATED", riskFactors: ["Short-duration heavy rainfall", "Road access disruption"], updatedAt: ago(66) },
  { id: demoId(5), title: "Heat-health advisory", type: "HEATWAVE", severity: "MODERATE", status: "MONITORING", priority: "P3", description: "Elevated daytime temperatures increase health risk for outdoor workers and people without cooling access.", location: "Kamalapuram", lat: 14.5986, lng: 78.6521, riskScore: 41, estimatedPopulation: 7900, assignedTeamId: null, source: "Weather monitoring", classification: "SIMULATED", riskFactors: ["High daytime temperature", "Outdoor exposure"], updatedAt: ago(95) },
  { id: demoId(6), title: "Bridge approach erosion", type: "FLOOD", severity: "HIGH", status: "ACTIVE", priority: "P2", description: "Erosion is reported at the approach to a local bridge. Route restrictions are pending engineering assessment.", location: "Mydukur · South approach", lat: 14.7304, lng: 78.1463, riskScore: 71, estimatedPopulation: 5200, assignedTeamId: demoId(25), source: "Infrastructure liaison", classification: "SIMULATED", riskFactors: ["Rising runoff", "Bridge approach erosion", "Limited alternate routes"], updatedAt: ago(112) },
  { id: demoId(7), title: "Brush fire near dry farmland", type: "FIRE", severity: "LOW", status: "CONTAINED", priority: "P3", description: "A small brush fire has been contained. Crews are checking for remaining hotspots.", location: "Badvel · Outer fields", lat: 14.7448, lng: 79.0642, riskScore: 24, estimatedPopulation: 380, assignedTeamId: demoId(27), source: "Fire service report", classification: "SIMULATED", riskFactors: ["Dry vegetation"], updatedAt: ago(154) },
  { id: demoId(8), title: "Aftershock monitoring", type: "EARTHQUAKE", severity: "LOW", status: "RESOLVED", priority: "P3", description: "A minor tremor report was reviewed. No damage or injuries were reported in the scenario data.", location: "Pulivendula", lat: 14.4218, lng: 78.2258, riskScore: 18, estimatedPopulation: 0, assignedTeamId: null, source: "USGS public feed / demo scenario", classification: "SIMULATED", riskFactors: ["Low reported magnitude", "No verified impact"], updatedAt: ago(284) },
];

export const zones: AffectedZone[] = [
  { id: demoId(101), incidentId: demoId(1), name: "Flood Zone 4", location: "Kadapa · Penna river bend", lat: 14.4673, lng: 78.8242, riskScore: 87, riskLevel: "CRITICAL", estimatedPopulation: 18400, riskFactors: ["High rainfall", "Rising river", "High population exposure", "Shelter pressure"], classification: "SIMULATED" },
  { id: demoId(102), incidentId: demoId(2), name: "Ward 11 lowlands", location: "Proddatur", lat: 14.7502, lng: 78.5484, riskScore: 74, riskLevel: "HIGH", estimatedPopulation: 12600, riskFactors: ["Heavy rainfall", "Drainage congestion"], classification: "SIMULATED" },
  { id: demoId(103), incidentId: demoId(3), name: "Hill Road slope", location: "Rayachoti", lat: 14.0576, lng: 78.7511, riskScore: 68, riskLevel: "HIGH", estimatedPopulation: 2400, riskFactors: ["Slope instability", "Rainfall forecast"], classification: "SIMULATED" },
  { id: demoId(104), incidentId: demoId(4), name: "Market drainage basin", location: "Jammalamadugu", lat: 14.8467, lng: 78.3857, riskScore: 53, riskLevel: "MODERATE", estimatedPopulation: 4100, riskFactors: ["Localized waterlogging"], classification: "SIMULATED" },
  { id: demoId(105), incidentId: demoId(6), name: "South bridge approach", location: "Mydukur", lat: 14.7304, lng: 78.1463, riskScore: 71, riskLevel: "HIGH", estimatedPopulation: 5200, riskFactors: ["Erosion", "Limited alternate routes"], classification: "SIMULATED" },
  { id: demoId(106), incidentId: null, name: "Penna downstream corridor", location: "Kadapa district", lat: 14.3943, lng: 78.9001, riskScore: 62, riskLevel: "HIGH", estimatedPopulation: 9300, riskFactors: ["Downstream runoff", "Forecast rainfall"], classification: "SIMULATED" },
  { id: demoId(107), incidentId: null, name: "Canal-side settlements", location: "Kamalapuram", lat: 14.5986, lng: 78.6521, riskScore: 46, riskLevel: "MODERATE", estimatedPopulation: 3600, riskFactors: ["Canal overflow potential"], classification: "SIMULATED" },
  { id: demoId(108), incidentId: null, name: "Low crossing — eastern route", location: "Chennur", lat: 14.5337, lng: 78.7703, riskScore: 83, riskLevel: "CRITICAL", estimatedPopulation: 2100, riskFactors: ["Low crossing", "Route interruption"], classification: "SIMULATED" },
  { id: demoId(109), incidentId: null, name: "Agricultural runoff area", location: "Badvel", lat: 14.7448, lng: 79.0642, riskScore: 28, riskLevel: "LOW", estimatedPopulation: 1600, riskFactors: ["Seasonal runoff"], classification: "SIMULATED" },
  { id: demoId(110), incidentId: null, name: "North drainage catchment", location: "Proddatur district", lat: 14.8024, lng: 78.4872, riskScore: 58, riskLevel: "MODERATE", estimatedPopulation: 5700, riskFactors: ["Drainage load", "Rainfall forecast"], classification: "SIMULATED" },
];

export const shelters: Shelter[] = [
  { id: demoId(201), name: "Kadapa Municipal School", location: "Kadapa · Old town", lat: 14.4691, lng: 78.8248, capacity: 1200, occupancy: 1030, occupancyPercent: 86, status: "NEAR_CAPACITY", contact: "+91 8562 240 100", resources: [{ name: "Water", quantity: 3200, unit: "L" }, { name: "Food kits", quantity: 820, unit: "kits" }, { name: "Medicine", quantity: 140, unit: "packs" }], updatedAt: ago(14), classification: "SIMULATED" },
  { id: demoId(202), name: "Riverbank Community Hall", location: "Kadapa · River road", lat: 14.4512, lng: 78.8375, capacity: 800, occupancy: 760, occupancyPercent: 95, status: "NEAR_CAPACITY", contact: "+91 8562 240 101", resources: [{ name: "Water", quantity: 600, unit: "L" }, { name: "Blankets", quantity: 210, unit: "units" }], updatedAt: ago(21), classification: "SIMULATED" },
  { id: demoId(203), name: "Government Junior College", location: "Proddatur · Ward 8", lat: 14.7519, lng: 78.5489, capacity: 950, occupancy: 620, occupancyPercent: 65, status: "AVAILABLE", contact: "+91 8564 251 100", resources: [{ name: "Water", quantity: 2200, unit: "L" }, { name: "Food kits", quantity: 540, unit: "kits" }], updatedAt: ago(29), classification: "SIMULATED" },
  { id: demoId(204), name: "Rayachoti Relief Centre", location: "Rayachoti · Bus stand road", lat: 14.0567, lng: 78.7534, capacity: 640, occupancy: 510, occupancyPercent: 80, status: "NEAR_CAPACITY", contact: "+91 8561 244 100", resources: [{ name: "Water", quantity: 1000, unit: "L" }, { name: "Medical supplies", quantity: 80, unit: "packs" }], updatedAt: ago(44), classification: "SIMULATED" },
  { id: demoId(205), name: "Jammalamadugu High School", location: "Jammalamadugu · Central", lat: 14.8461, lng: 78.3868, capacity: 700, occupancy: 330, occupancyPercent: 47, status: "AVAILABLE", contact: "+91 8563 244 100", resources: [{ name: "Food kits", quantity: 500, unit: "kits" }, { name: "Blankets", quantity: 260, unit: "units" }], updatedAt: ago(52), classification: "SIMULATED" },
  { id: demoId(206), name: "Mydukur Mandal Hall", location: "Mydukur · Main road", lat: 14.7294, lng: 78.1469, capacity: 540, occupancy: 490, occupancyPercent: 91, status: "NEAR_CAPACITY", contact: "+91 8564 244 100", resources: [{ name: "Water", quantity: 430, unit: "L" }, { name: "Medicine", quantity: 35, unit: "packs" }], updatedAt: ago(37), classification: "SIMULATED" },
  { id: demoId(207), name: "Badvel Area Hospital Annex", location: "Badvel · Hospital road", lat: 14.7443, lng: 79.0651, capacity: 400, occupancy: 400, occupancyPercent: 100, status: "FULL", contact: "+91 8569 244 100", resources: [{ name: "Medical supplies", quantity: 110, unit: "packs" }], updatedAt: ago(61), classification: "SIMULATED" },
  { id: demoId(208), name: "Chennur Primary School", location: "Chennur · East bank", lat: 14.5342, lng: 78.7711, capacity: 480, occupancy: 280, occupancyPercent: 58, status: "AVAILABLE", contact: "+91 8562 244 102", resources: [{ name: "Water", quantity: 900, unit: "L" }, { name: "Food kits", quantity: 320, unit: "kits" }], updatedAt: ago(27), classification: "SIMULATED" },
  { id: demoId(209), name: "Kamalapuram Relief Hall", location: "Kamalapuram · North ward", lat: 14.5994, lng: 78.6532, capacity: 520, occupancy: 215, occupancyPercent: 41, status: "AVAILABLE", contact: "+91 8562 244 103", resources: [{ name: "Water", quantity: 1600, unit: "L" }, { name: "Blankets", quantity: 240, unit: "units" }], updatedAt: ago(48), classification: "SIMULATED" },
  { id: demoId(210), name: "Vallur Mandal School", location: "Vallur · Main street", lat: 14.6241, lng: 78.9914, capacity: 360, occupancy: 0, occupancyPercent: 0, status: "AVAILABLE", contact: "+91 8562 244 104", resources: [{ name: "Water", quantity: 850, unit: "L" }, { name: "Food kits", quantity: 300, unit: "kits" }], updatedAt: ago(72), classification: "SIMULATED" },
  { id: demoId(211), name: "Sidhout Public Hall", location: "Sidhout · Lower settlement", lat: 14.5424, lng: 78.9977, capacity: 300, occupancy: 80, occupancyPercent: 27, status: "AVAILABLE", contact: "+91 8562 244 105", resources: [{ name: "Water", quantity: 700, unit: "L" }, { name: "Blankets", quantity: 180, unit: "units" }], updatedAt: ago(84), classification: "SIMULATED" },
  { id: demoId(212), name: "Yerraguntla School Complex", location: "Yerraguntla · Station road", lat: 14.6382, lng: 78.5394, capacity: 600, occupancy: 0, occupancyPercent: 0, status: "CLOSED", contact: "+91 8563 244 106", resources: [{ name: "Water", quantity: 0, unit: "L" }], updatedAt: ago(120), classification: "SIMULATED" },
];

export const teams: RescueTeam[] = [
  { id: demoId(21), name: "Rescue Team 01", type: "Flood response", status: "ON_SCENE", location: "Kadapa · Zone 4", lat: 14.4638, lng: 78.8273, incidentId: demoId(1), incidentTitle: incidents[0]!.title, priority: "P1", vehicle: "High-clearance truck", notes: "Route status to be reconfirmed", classification: "SIMULATED", updatedAt: ago(7) },
  { id: demoId(22), name: "Rescue Team 02", type: "Water rescue", status: "DEPLOYED", location: "Proddatur · Ward 11", lat: 14.7523, lng: 78.5462, incidentId: demoId(2), incidentTitle: incidents[1]!.title, priority: "P1", vehicle: "Rescue boat", notes: "Scenario position · confirm by radio", classification: "SIMULATED", updatedAt: ago(17) },
  { id: demoId(23), name: "Rescue Team 03", type: "Medical response", status: "AVAILABLE", location: "Kadapa · Control point", lat: 14.4751, lng: 78.8167, incidentId: null, incidentTitle: null, priority: "P2", vehicle: "Medical van", notes: "Available for dispatch", classification: "SIMULATED", updatedAt: ago(31) },
  { id: demoId(24), name: "Rescue Team 04", type: "Urban response", status: "EN_ROUTE", location: "Jammalamadugu · Market", lat: 14.8412, lng: 78.3814, incidentId: demoId(4), incidentTitle: incidents[3]!.title, priority: "P2", vehicle: "Utility vehicle", notes: "Avoid waterlogged underpass", classification: "SIMULATED", updatedAt: ago(38) },
  { id: demoId(25), name: "Rescue Team 05", type: "Engineering", status: "DEPLOYED", location: "Mydukur · South approach", lat: 14.7263, lng: 78.1444, incidentId: demoId(6), incidentTitle: incidents[5]!.title, priority: "P2", vehicle: "Engineering unit", notes: "Bridge access assessment", classification: "SIMULATED", updatedAt: ago(58) },
  { id: demoId(26), name: "Rescue Team 06", type: "Evacuation", status: "AVAILABLE", location: "Proddatur · Staging", lat: 14.7601, lng: 78.5598, incidentId: null, incidentTitle: null, priority: "P2", vehicle: "Bus", notes: "Available for evacuation support", classification: "SIMULATED", updatedAt: ago(65) },
  { id: demoId(27), name: "Rescue Team 07", type: "Fire response", status: "ON_SCENE", location: "Badvel · Outer fields", lat: 14.7432, lng: 79.0611, incidentId: demoId(7), incidentTitle: incidents[6]!.title, priority: "P3", vehicle: "Fire tender", notes: "Contained; checking hotspots", classification: "SIMULATED", updatedAt: ago(87) },
  { id: demoId(28), name: "Rescue Team 08", type: "Logistics", status: "AVAILABLE", location: "Kadapa · Depot", lat: 14.4831, lng: 78.8325, incidentId: null, incidentTitle: null, priority: "P3", vehicle: "Supply truck", notes: "Water and food distribution", classification: "SIMULATED", updatedAt: ago(103) },
];

export const resources: Resource[] = [
  { id: demoId(301), name: "Drinking water", unit: "L", quantity: 4800, consumptionPerHour: 360, hoursRemaining: 13.3, minimumThreshold: 5000, status: "LOW", updatedAt: ago(12) },
  { id: demoId(302), name: "Food kits", unit: "kits", quantity: 1850, consumptionPerHour: 85, hoursRemaining: 21.8, minimumThreshold: 700, status: "GOOD", updatedAt: ago(24) },
  { id: demoId(303), name: "Medicine packs", unit: "packs", quantity: 180, consumptionPerHour: 18, hoursRemaining: 10, minimumThreshold: 220, status: "CRITICAL", updatedAt: ago(16) },
  { id: demoId(304), name: "Fuel", unit: "L", quantity: 2300, consumptionPerHour: 160, hoursRemaining: 14.4, minimumThreshold: 900, status: "GOOD", updatedAt: ago(41) },
  { id: demoId(305), name: "Blankets", unit: "units", quantity: 640, consumptionPerHour: 36, hoursRemaining: 17.8, minimumThreshold: 250, status: "GOOD", updatedAt: ago(35) },
  { id: demoId(306), name: "Generators", unit: "units", quantity: 12, consumptionPerHour: null, hoursRemaining: null, minimumThreshold: 8, status: "GOOD", updatedAt: ago(55) },
  { id: demoId(307), name: "Medical supplies", unit: "packs", quantity: 42, consumptionPerHour: 8, hoursRemaining: 5.3, minimumThreshold: 60, status: "CRITICAL", updatedAt: ago(9) },
];

export const operations: RescueOperation[] = [
  { id: demoId(401), teamId: demoId(21), teamName: teams[0]!.name, incidentId: demoId(1), incidentTitle: incidents[0]!.title, status: "ON_SCENE", priority: "P1", notes: "Verify blocked route before moving equipment.", startedAt: ago(72), completedAt: null },
  { id: demoId(402), teamId: demoId(22), teamName: teams[1]!.name, incidentId: demoId(2), incidentTitle: incidents[1]!.title, status: "DEPLOYED", priority: "P1", notes: "Check access and shelter transfer needs.", startedAt: ago(48), completedAt: null },
  { id: demoId(403), teamId: demoId(24), teamName: teams[3]!.name, incidentId: demoId(4), incidentTitle: incidents[3]!.title, status: "EN_ROUTE", priority: "P2", notes: "Waterlogging assessment.", startedAt: ago(24), completedAt: null },
  { id: demoId(404), teamId: demoId(25), teamName: teams[4]!.name, incidentId: demoId(6), incidentTitle: incidents[5]!.title, status: "DEPLOYED", priority: "P2", notes: "Engineering assessment only; confirm road closure with authority.", startedAt: ago(38), completedAt: null },
];

export const alerts: Alert[] = [
  { id: demoId(501), severity: "CRITICAL", title: "Flood Zone 4 risk elevated", message: "Calculated risk 87/100. Verify river status, shelter capacity and the partially blocked rescue route.", source: "SENTINEL risk engine", createdAt: ago(8), incidentId: demoId(1), zoneId: demoId(101), status: "ACTIVE", classification: "SIMULATED" },
  { id: demoId(502), severity: "WARNING", title: "Riverbank Community Hall nearing capacity", message: "760 of 800 places are occupied in the scenario data (95%). Confirm alternate accommodation before transfers.", source: "Shelter occupancy", createdAt: ago(20), incidentId: demoId(1), zoneId: demoId(101), status: "ACTIVE", classification: "SIMULATED" },
  { id: demoId(503), severity: "WARNING", title: "Medical supplies below threshold", message: "42 packs remain against a minimum threshold of 60.", source: "Resource inventory", createdAt: ago(10), incidentId: null, zoneId: null, status: "ACTIVE", classification: "SIMULATED" },
  { id: demoId(504), severity: "WARNING", title: "Rescue route needs confirmation", message: "A partial obstruction is reported on the eastern access road. Verify by radio before dispatch.", source: "Field report", createdAt: ago(31), incidentId: demoId(1), zoneId: demoId(101), status: "ACTIVE", classification: "SIMULATED" },
  { id: demoId(505), severity: "INFORMATION", title: "Rescue Team 03 available", message: "Medical response team is listed as available at the Kadapa control point.", source: "Rescue operations", createdAt: ago(33), incidentId: null, zoneId: null, status: "ACTIVE", classification: "SIMULATED" },
  { id: demoId(506), severity: "INFORMATION", title: "Brush fire contained", message: "Fire crew is checking for hotspots; no new impact has been reported.", source: "Fire service report", createdAt: ago(88), incidentId: demoId(7), zoneId: demoId(109), status: "ACKNOWLEDGED", classification: "SIMULATED" },
  { id: demoId(507), severity: "WARNING", title: "South bridge approach erosion", message: "Engineering assessment is underway. Route access remains unverified.", source: "Infrastructure liaison", createdAt: ago(59), incidentId: demoId(6), zoneId: demoId(105), status: "ACTIVE", classification: "SIMULATED" },
  { id: demoId(508), severity: "INFORMATION", title: "Demo scenario initialized", message: "All seeded records are simulated for demonstration and training.", source: "SENTINEL system", createdAt: ago(180), incidentId: null, zoneId: null, status: "ACKNOWLEDGED", classification: "SIMULATED" },
];

export const events: SystemEvent[] = [
  { id: demoId(601), title: "Zone 4 risk recalculated", message: "Critical risk reflects scenario rainfall, population exposure and limited shelter capacity.", category: "Risk", createdAt: ago(8), classification: "SIMULATED" },
  { id: demoId(602), title: "Shelter occupancy updated", message: "Riverbank Community Hall reports 760 of 800 places occupied in demo data.", category: "Shelter", createdAt: ago(20), classification: "SIMULATED" },
  { id: demoId(603), title: "Resource threshold crossed", message: "Medical supplies are below the scenario minimum stock threshold.", category: "Resources", createdAt: ago(10), classification: "SIMULATED" },
  { id: demoId(604), title: "Rescue Team 02 deployed", message: "Team assigned to the Proddatur lowland scenario.", category: "Rescue", createdAt: ago(48), classification: "SIMULATED" },
  { id: demoId(605), title: "Priority alert created", message: "Flood Zone 4 flagged for immediate coordination.", category: "Alert", createdAt: ago(8), classification: "SIMULATED" },
  { id: demoId(606), title: "Weather source checked", message: "Open-Meteo public feed will be checked on request and cached.", category: "Data source", createdAt: ago(35), classification: "SIMULATED" },
  { id: demoId(607), title: "Flood scenario seeded", message: "Zone 4 includes high rainfall, rising river conditions and route pressure.", category: "Scenario", createdAt: ago(180), classification: "SIMULATED" },
  { id: demoId(608), title: "Demo mode active", message: "Operational changes affect simulated records only.", category: "System", createdAt: ago(180), classification: "SIMULATED" },
];

export const weatherDemo: WeatherReading = {
  location: "Kadapa district",
  temperatureC: 29.4,
  precipitationMm: 32.6,
  windKph: 18.2,
  humidityPercent: 81,
  pressureHpa: 1006.4,
  forecastHighC: 32.1,
  forecastLowC: 25.3,
  forecastPrecipitationMm: 41.2,
  source: "Open-Meteo (demo fallback)",
  sourceStatus: "SIMULATED",
  updatedAt: ago(22),
  classification: "SIMULATED",
  message: "Live weather is unavailable; showing clearly labeled scenario values.",
};

export const floodDemo: FloodReading = {
  location: "Penna river corridor · Kadapa (scenario)",
  riverLevelM: 3.42,
  riverDischargeM3s: null,
  trend: "RISING",
  rainfall24hMm: 86.4,
  riskLevel: "CRITICAL",
  source: "Scenario observation",
  sourceStatus: "SIMULATED",
  updatedAt: ago(16),
  classification: "SIMULATED",
  message: "This is a simulated river-level scenario, not a gauge reading.",
};

export const dataSources: DataSource[] = [
  { id: "open-meteo-weather", name: "Open-Meteo Weather", type: "Public weather forecast", status: "STALE", lastSuccessAt: null, lastError: null, message: "Queried on demand; scenario fallback shown until the first successful request." },
  { id: "open-meteo-flood", name: "Open-Meteo Flood / GloFAS", type: "Public flood forecast", status: "STALE", lastSuccessAt: null, lastError: null, message: "Forecast discharge is not a local river-gauge water level." },
  { id: "gdacs", name: "GDACS", type: "Public disaster feed", status: "STALE", lastSuccessAt: null, lastError: null, message: "Public global event feed; normalized events remain source-attributed." },
  { id: "usgs", name: "USGS Earthquakes", type: "Public earthquake feed", status: "STALE", lastSuccessAt: null, lastError: null, message: "Public earthquake feed; events are not assumed to be local incidents." },
  { id: "nominatim", name: "OpenStreetMap Nominatim", type: "Public location search", status: "STALE", lastSuccessAt: null, lastError: null, message: "Address search is rate-limited; matching local demo record locations remain available offline." },
  { id: "supabase", name: "Supabase", type: "Database and authentication", status: process.env.SUPABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY) ? "STALE" : "DISABLED", lastSuccessAt: null, lastError: null, message: "User-scoped requests use the authenticated user's access token and are protected by row-level security." },
  { id: "openai", name: "OpenAI Copilot", type: "Decision support", status: process.env.OPENAI_API_KEY ? "STALE" : "DISABLED", lastSuccessAt: null, lastError: null, message: process.env.OPENAI_API_KEY ? "Configured; waiting for a successful Copilot request. Rule-based fallback remains available." : "No API key configured; deterministic rule-based decision support is active." },
  { id: "imd", name: "India Meteorological Department", type: "Indian weather and warnings", status: "DISABLED", lastSuccessAt: null, lastError: null, message: "No official IMD adapter is enabled; credentials alone do not activate a data connector." },
  { id: "nasa-firms", name: "NASA FIRMS", type: "Fire observations", status: "DISABLED", lastSuccessAt: null, lastError: null, message: "Optional connector is not configured or enabled." },
  { id: "bhuvan", name: "ISRO Bhuvan", type: "Satellite and infrastructure data", status: "DISABLED", lastSuccessAt: null, lastError: null, message: "Optional connector is not configured or enabled." },
];

export const demoState = {
  incidents,
  zones,
  shelters,
  resources,
  teams,
  operations,
  alerts,
  events,
  weather: weatherDemo,
  flood: floodDemo,
  dataSources,
};

export const addEvent = (title: string, message: string, category: string): void => {
  demoState.events.unshift({
    id: crypto.randomUUID(),
    title,
    message,
    category,
    createdAt: new Date(),
    classification: "SIMULATED",
  });
  demoState.events.splice(30);
};

export function updateDataSourceStatus(
  id: string,
  status: DataSource["status"],
  message: string,
  error: string | null = null,
): void {
  const source = demoState.dataSources.find((item) => item.id === id);
  if (!source) return;
  source.status = status;
  source.message = message;
  source.lastError = error;
  if (status === "LIVE") source.lastSuccessAt = new Date();
}

export const classifyRisk = (score: number): AffectedZone["riskLevel"] => riskLevel(score);
