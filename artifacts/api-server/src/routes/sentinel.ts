import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import {
  AnalyzeAreaQueryParams,
  AnalyzeAreaResponse,
  AskCopilotBody,
  AskCopilotResponse,
  CreateIncidentBody,
  CreateIncidentResponse,
  CreateRescueOperationBody,
  CreateRescueOperationResponse,
  GetDashboardSummaryResponse,
  GetFloodQueryParams,
  GetFloodResponse,
  GetIncidentParams,
  GetIncidentResponse,
  GetWeatherQueryParams,
  GetWeatherResponse,
  GetZoneRiskParams,
  GetZoneRiskResponse,
  ListAlertsResponse,
  ListDataSourcesResponse,
  ListIncidentsQueryParams,
  ListIncidentsResponse,
  ListRescueOperationsResponse,
  ListRescueTeamsResponse,
  ListResourcesResponse,
  ListSheltersResponse,
  ListSystemEventsResponse,
  ListZonesResponse,
  SearchGlobalQueryParams,
  SearchGlobalResponse,
  SearchLocationsQueryParams,
  SearchLocationsResponse,
  UpdateAlertBody,
  UpdateAlertParams,
  UpdateAlertResponse,
  UpdateIncidentBody,
  UpdateIncidentParams,
  UpdateIncidentResponse,
  UpdateRescueOperationBody,
  UpdateRescueOperationParams,
  UpdateRescueOperationResponse,
  UpdateResourceBody,
  UpdateResourceParams,
  UpdateResourceResponse,
  UpdateShelterBody,
  UpdateShelterParams,
  UpdateShelterResponse,
} from "@workspace/api-zod";
import type {
  Alert,
  AffectedZone,
  DashboardSummary,
  FloodReading,
  Incident,
  Resource,
  RescueOperation,
  RescueTeam,
  Shelter,
  SystemEvent,
  WeatherReading,
} from "@workspace/api-zod";
import {
  addEvent,
  classifyRisk,
  demoId,
  demoState,
} from "../lib/sentinel-demo";
import { isWithinRadius, readFlood, readPublicIncidents, readWeather, searchLocations } from "../lib/sentinel-feeds";
import { calculateRiskScore, explainRisk, priorityForRisk } from "../lib/sentinel-risk";
import {
  deleteSupabaseRows,
  insertSupabaseRow,
  readSupabaseTable,
  requireOperationalRole,
  resolveSentinelContext,
  type SentinelContext,
  updateSupabaseRow,
} from "../lib/sentinel-supabase";

const router: IRouter = Router();

router.use(async (req, res, next) => {
  const context = await resolveSentinelContext(req, res);
  if (!context) return;
  res.locals.sentinelContext = context;
  next();
});

type Handler = (req: Request, res: Response, context: SentinelContext) => Promise<void>;

function endpoint(handler: Handler): RequestHandler {
  return async (req, res) => {
    try {
      await handler(req, res, res.locals.sentinelContext as SentinelContext);
    } catch (error) {
      const isValidationError =
        !!error && typeof error === "object" && "name" in error && error.name === "ZodError";
      req.log.error({ err: error }, "SENTINEL API request failed");
      if (!res.headersSent) {
        res.status(isValidationError ? 400 : 502).json({
          error: isValidationError ? "The request contains invalid data." : "The request could not be completed.",
        });
      }
    }
  };
}

function activeIncident(incident: Incident): boolean {
  return incident.status === "ACTIVE" || incident.status === "MONITORING";
}

function newestFirst<T extends { updatedAt?: Date | string; createdAt?: Date | string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
    new Date(a.updatedAt ?? a.createdAt ?? 0).getTime(),
  );
}

async function getIncidents(context: SentinelContext): Promise<Incident[]> {
  if (context.kind === "demo") return demoState.incidents;
  return readSupabaseTable<Incident>(context, "incidents", "select=*&order=updated_at.desc");
}

async function getZones(context: SentinelContext): Promise<AffectedZone[]> {
  if (context.kind === "demo") return demoState.zones;
  return readSupabaseTable<AffectedZone>(context, "affected_zones", "select=*&order=risk_score.desc");
}

async function getShelters(context: SentinelContext): Promise<Shelter[]> {
  if (context.kind === "demo") return demoState.shelters;
  const [rows, resources] = await Promise.all([
    readSupabaseTable<Shelter & { occupancy?: number }>(context, "shelters", "select=*&order=name.asc"),
    readSupabaseTable<Array<{ shelterId: string; itemName: string; quantity: number; unit: string }>[number]>(
      context,
      "shelter_resources",
      "select=*&order=item_name.asc",
    ),
  ]);
  return rows.map((row) => {
    const occupancy = Number(row.occupancy ?? 0);
    return {
      ...row,
      occupancy,
      occupancyPercent: row.capacity > 0 ? Math.round((occupancy / row.capacity) * 100) : 0,
      resources: resources
        .filter((item) => item.shelterId === row.id)
        .map((item) => ({ name: item.itemName, quantity: Number(item.quantity), unit: item.unit })),
    };
  });
}

async function getResources(context: SentinelContext): Promise<Resource[]> {
  if (context.kind === "demo") return demoState.resources;
  return readSupabaseTable<Resource>(context, "resources", "select=*&order=name.asc");
}

async function getTeams(context: SentinelContext): Promise<RescueTeam[]> {
  if (context.kind === "demo") return demoState.teams;
  const [teams, incidents] = await Promise.all([
    readSupabaseTable<RescueTeam>(context, "rescue_teams", "select=*&order=name.asc"),
    getIncidents(context),
  ]);
  return teams.map((team) => {
    const incident = incidents.find((item) => item.id === team.incidentId);
    return {
      ...team,
      incidentTitle: incident?.title ?? null,
      classification: "OBSERVED",
      updatedAt: team.updatedAt ?? new Date(),
    };
  });
}

async function getOperations(context: SentinelContext): Promise<RescueOperation[]> {
  if (context.kind === "demo") return demoState.operations;
  const [operations, teams, incidents] = await Promise.all([
    readSupabaseTable<RescueOperation>(context, "rescue_operations", "select=*&order=started_at.desc"),
    readSupabaseTable<RescueTeam>(context, "rescue_teams", "select=*"),
    getIncidents(context),
  ]);
  return operations.map((operation) => ({
    ...operation,
    teamName: teams.find((team) => team.id === operation.teamId)?.name ?? "Unassigned team",
    incidentTitle: incidents.find((incident) => incident.id === operation.incidentId)?.title ?? "Incident not found",
  }));
}

async function getAlerts(context: SentinelContext): Promise<Alert[]> {
  if (context.kind === "demo") return demoState.alerts;
  return readSupabaseTable<Alert>(context, "alerts", "select=*&order=created_at.desc");
}

async function getEvents(context: SentinelContext): Promise<SystemEvent[]> {
  if (context.kind === "demo") return demoState.events;
  return readSupabaseTable<SystemEvent>(context, "system_events", "select=*&order=created_at.desc&limit=100");
}

function calcShelterCapacity(shelters: Shelter[]): number {
  return shelters.reduce((sum, shelter) => sum + Math.max(0, shelter.capacity - shelter.occupancy), 0);
}

function resourceStatus(quantity: number, threshold: number): Resource["status"] {
  if (quantity <= threshold * 0.5) return "CRITICAL";
  if (quantity < threshold) return "LOW";
  return "GOOD";
}

async function recordEvent(
  req: Request,
  context: SentinelContext,
  title: string,
  message: string,
  category: string,
): Promise<void> {
  if (context.kind === "demo") {
    addEvent(title, message, category);
    return;
  }
  try {
    await insertSupabaseRow<SystemEvent>(context, "system_events", {
      id: crypto.randomUUID(),
      title,
      message,
      category,
      createdAt: new Date(),
      classification: "OBSERVED",
    });
  } catch (error) {
    req.log.warn({ err: error }, "Could not append a SENTINEL system event");
  }
}

function derivedRiskLevel(score: number): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  return classifyRisk(score);
}

function toSearchResult(
  id: string,
  title: string,
  subtitle: string,
  type: "INCIDENT" | "SHELTER" | "TEAM" | "ALERT",
  href: string,
) {
  return { id, title, subtitle, type, href };
}

router.get("/dashboard/summary", endpoint(async (_req, res, context) => {
  const [incidentRows, shelterRows, teamRows, resourceRows, alertRows, weather, flood] = await Promise.all([
    getIncidents(context),
    getShelters(context),
    getTeams(context),
    getResources(context),
    getAlerts(context),
    readWeather(),
    readFlood(),
  ]);
  const active = incidentRows.filter(activeIncident);
  const priorityAlerts = alertRows.filter((alert) => alert.status === "ACTIVE").slice(0, 5);
  const summary: DashboardSummary = {
    activeIncidents: active.length,
    criticalIncidents: active.filter((item) => item.severity === "CRITICAL").length,
    estimatedPopulationAtRisk: active.reduce((sum, item) => sum + item.estimatedPopulation, 0),
    activeRescueTeams: teamRows.filter((team) => team.status !== "AVAILABLE" && team.status !== "OFFLINE").length,
    occupiedShelters: shelterRows.filter((shelter) => shelter.occupancy > 0 && shelter.status !== "CLOSED").length,
    criticalResourceShortages: resourceRows.filter((resource) => resource.status === "CRITICAL" || resource.status === "LOW").length,
    priorityAlerts,
    latestWeather: weather,
    latestFlood: flood,
    topPriorityIncidents: [...active].sort((a, b) => b.riskScore - a.riskScore).slice(0, 5),
    updatedAt: new Date(),
    classification: context.kind === "demo" ? "SIMULATED" : "OBSERVED",
  };
  res.json(GetDashboardSummaryResponse.parse(summary));
}));

router.get("/incidents", endpoint(async (req, res, context) => {
  const query = ListIncidentsQueryParams.parse(req.query);
  const [stored, publicRows] = await Promise.all([getIncidents(context), readPublicIncidents()]);
  let rows = newestFirst([...stored, ...publicRows]);
  if (query.status) rows = rows.filter((item) => item.status === query.status);
  if (query.priority) rows = rows.filter((item) => item.priority === query.priority);
  if (query.type) rows = rows.filter((item) => item.type === query.type);
  const q = query.search?.toLowerCase().trim();
  if (q) rows = rows.filter((item) => `${item.title} ${item.location} ${item.description}`.toLowerCase().includes(q));
  res.json(ListIncidentsResponse.parse(rows));
}));

router.get("/incidents/:id", endpoint(async (req, res, context) => {
  const { id } = GetIncidentParams.parse({ id: req.params.id });
  const [incidentRows, zones, alerts] = await Promise.all([getIncidents(context), getZones(context), getAlerts(context)]);
  const incident = incidentRows.find((item) => item.id === id);
  if (!incident) {
    res.status(404).json({ error: "Incident not found." });
    return;
  }
  const detail = {
    ...incident,
    zones: zones.filter((zone) => zone.incidentId === id),
    alerts: alerts.filter((alert) => alert.incidentId === id),
  };
  res.json(GetIncidentResponse.parse(detail));
}));

router.post("/incidents", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const body = CreateIncidentBody.parse(req.body);
  const [shelterRows, resourceRows, weather] = await Promise.all([
    getShelters(context),
    getResources(context),
    readWeather(body.lat, body.lng, body.location),
  ]);
  const shortages = resourceRows.filter((item) => item.status === "LOW" || item.status === "CRITICAL").length;
  const riskScore = calculateRiskScore({
    severity: body.severity,
    population: body.estimatedPopulation,
    rainfallMm: weather.precipitationMm,
    shelterCapacityAvailable: calcShelterCapacity(shelterRows),
    hasTeam: Boolean(body.assignedTeamId),
    resourceShortageCount: shortages,
  });
  const incident: Incident = {
    id: crypto.randomUUID(),
    ...body,
    riskScore,
    priority: priorityForRisk(riskScore, body.severity),
    source: "Operator report",
    classification: "OBSERVED",
    riskFactors: explainRisk({
      severity: body.severity,
      population: body.estimatedPopulation,
      rainfallMm: weather.precipitationMm,
      shelterCapacityAvailable: calcShelterCapacity(shelterRows),
      hasTeam: Boolean(body.assignedTeamId),
      resourceShortageCount: shortages,
    }),
    updatedAt: new Date(),
  };
  const saved = context.kind === "demo"
    ? (demoState.incidents.unshift({ ...incident, classification: "SIMULATED" }), demoState.incidents[0]!)
    : await insertSupabaseRow<Incident>(context, "incidents", incident);
  await recordEvent(req, context, "Incident recorded", `${saved.title} received an initial ${saved.priority} priority.`, "Incident");
  res.status(201).json(CreateIncidentResponse.parse(saved));
}));

router.patch("/incidents/:id", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const { id } = UpdateIncidentParams.parse({ id: req.params.id });
  const body = UpdateIncidentBody.parse(req.body);
  const current = (await getIncidents(context)).find((item) => item.id === id);
  if (!current) {
    res.status(404).json({ error: "Incident not found." });
    return;
  }
  const [shelterRows, resourceRows, weather] = await Promise.all([
    getShelters(context),
    getResources(context),
    readWeather(current.lat, current.lng, current.location),
  ]);
  const merged = { ...current, ...body };
  const score = calculateRiskScore({
    severity: merged.severity,
    population: merged.estimatedPopulation,
    rainfallMm: weather.precipitationMm,
    shelterCapacityAvailable: calcShelterCapacity(shelterRows),
    hasTeam: Boolean(merged.assignedTeamId),
    resourceShortageCount: resourceRows.filter((item) => item.status === "LOW" || item.status === "CRITICAL").length,
  });
  const changes = {
    ...body,
    riskScore: score,
    priority: priorityForRisk(score, merged.severity),
    riskFactors: explainRisk({
      severity: merged.severity,
      population: merged.estimatedPopulation,
      rainfallMm: weather.precipitationMm,
      shelterCapacityAvailable: calcShelterCapacity(shelterRows),
      hasTeam: Boolean(merged.assignedTeamId),
      resourceShortageCount: resourceRows.filter((item) => item.status === "LOW" || item.status === "CRITICAL").length,
    }),
    updatedAt: new Date(),
  };
  const updated = context.kind === "demo"
    ? Object.assign(current, changes, { classification: "SIMULATED" as const })
    : await updateSupabaseRow<Incident>(context, "incidents", id, changes);
  if (!updated) {
    res.status(404).json({ error: "Incident not found." });
    return;
  }
  await recordEvent(req, context, "Incident updated", `${updated.title} now has ${updated.priority} priority.`, "Incident");
  res.json(UpdateIncidentResponse.parse(updated));
}));

router.get("/zones", endpoint(async (_req, res, context) => {
  res.json(ListZonesResponse.parse(await getZones(context)));
}));

router.get("/shelters", endpoint(async (_req, res, context) => {
  res.json(ListSheltersResponse.parse(await getShelters(context)));
}));

router.patch("/shelters/:id", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const { id } = UpdateShelterParams.parse({ id: req.params.id });
  const body = UpdateShelterBody.parse(req.body);
  const current = (await getShelters(context)).find((item) => item.id === id);
  if (!current) {
    res.status(404).json({ error: "Shelter not found." });
    return;
  }
  const occupancy = body.occupancy ?? current.occupancy;
  const status = body.status ?? (occupancy >= current.capacity ? "FULL" : occupancy / current.capacity >= 0.85 ? "NEAR_CAPACITY" : "AVAILABLE");
  const changes = { occupancy, status, updatedAt: new Date() };
  let updated: Shelter;
  if (context.kind === "demo") {
    updated = Object.assign(current, changes, {
      occupancyPercent: current.capacity ? Math.round((occupancy / current.capacity) * 100) : 0,
      resources: body.resources ?? current.resources,
      classification: "SIMULATED" as const,
    });
  } else {
    const saved = await updateSupabaseRow<Shelter>(context, "shelters", id, changes);
    if (!saved) {
      res.status(404).json({ error: "Shelter not found." });
      return;
    }
    if (body.resources) {
      await deleteSupabaseRows(context, "shelter_resources", `shelter_id=eq.${encodeURIComponent(id)}`);
      for (const resource of body.resources) {
        await insertSupabaseRow(context, "shelter_resources", {
          shelterId: id,
          itemName: resource.name,
          quantity: resource.quantity,
          unit: resource.unit,
        });
      }
    }
    const resources = body.resources ?? current.resources;
    updated = {
      ...saved,
      occupancy,
      occupancyPercent: saved.capacity ? Math.round((occupancy / saved.capacity) * 100) : 0,
      resources,
    };
  }
  await recordEvent(req, context, "Shelter status updated", `${updated.name} reports ${updated.occupancy}/${updated.capacity} places occupied.`, "Shelter");
  res.json(UpdateShelterResponse.parse(updated));
}));

router.get("/resources", endpoint(async (_req, res, context) => {
  res.json(ListResourcesResponse.parse(await getResources(context)));
}));

router.patch("/resources/:id", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const { id } = UpdateResourceParams.parse({ id: req.params.id });
  const body = UpdateResourceBody.parse(req.body);
  const current = (await getResources(context)).find((item) => item.id === id);
  if (!current) {
    res.status(404).json({ error: "Resource not found." });
    return;
  }
  const merged = { ...current, ...body };
  const changes = {
    ...body,
    hoursRemaining: merged.consumptionPerHour && merged.consumptionPerHour > 0
      ? Math.round((merged.quantity / merged.consumptionPerHour) * 10) / 10
      : null,
    status: resourceStatus(merged.quantity, merged.minimumThreshold),
    updatedAt: new Date(),
  };
  const updated = context.kind === "demo"
    ? Object.assign(current, changes)
    : await updateSupabaseRow<Resource>(context, "resources", id, changes);
  if (!updated) {
    res.status(404).json({ error: "Resource not found." });
    return;
  }
  await recordEvent(req, context, "Resource inventory updated", `${updated.name}: ${updated.quantity} ${updated.unit} (${updated.status}).`, "Resources");
  res.json(UpdateResourceResponse.parse(updated));
}));

router.get("/rescue-teams", endpoint(async (_req, res, context) => {
  res.json(ListRescueTeamsResponse.parse(await getTeams(context)));
}));

router.get("/rescue-operations", endpoint(async (_req, res, context) => {
  res.json(ListRescueOperationsResponse.parse(await getOperations(context)));
}));

router.post("/rescue-operations", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const body = CreateRescueOperationBody.parse(req.body);
  const [teams, incidents] = await Promise.all([getTeams(context), getIncidents(context)]);
  const team = teams.find((item) => item.id === body.teamId);
  const incident = incidents.find((item) => item.id === body.incidentId);
  if (!team || !incident) {
    res.status(404).json({ error: !team ? "Rescue team not found." : "Incident not found." });
    return;
  }
  if (team.status !== "AVAILABLE" && team.incidentId !== incident.id) {
    res.status(409).json({ error: "The selected team is not available for a new operation." });
    return;
  }
  const operation: RescueOperation = {
    id: crypto.randomUUID(),
    teamId: team.id,
    teamName: team.name,
    incidentId: incident.id,
    incidentTitle: incident.title,
    status: "DEPLOYED",
    priority: body.priority,
    notes: body.notes ?? "",
    startedAt: new Date(),
    completedAt: null,
  };
  const saved = context.kind === "demo"
    ? (demoState.operations.unshift(operation), Object.assign(team, { incidentId: incident.id, incidentTitle: incident.title, status: "DEPLOYED" as const, priority: body.priority, updatedAt: new Date() }), Object.assign(incident, { assignedTeamId: team.id, updatedAt: new Date() }), demoState.operations[0]!)
    : await insertSupabaseRow<RescueOperation>(context, "rescue_operations", {
        id: operation.id,
        teamId: operation.teamId,
        incidentId: operation.incidentId,
        status: operation.status,
        priority: operation.priority,
        notes: operation.notes,
        startedAt: operation.startedAt,
        completedAt: null,
      });
  if (context.kind === "supabase") {
    await updateSupabaseRow(context, "rescue_teams", team.id, { incidentId: incident.id, status: "DEPLOYED", priority: body.priority, updatedAt: new Date() });
    await updateSupabaseRow(context, "incidents", incident.id, { assignedTeamId: team.id, updatedAt: new Date() });
  }
  await recordEvent(req, context, "Rescue team assigned", `${team.name} assigned to ${incident.title}.`, "Rescue");
  res.status(201).json(CreateRescueOperationResponse.parse({ ...saved, teamName: team.name, incidentTitle: incident.title }));
}));

router.patch("/rescue-operations/:id", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const { id } = UpdateRescueOperationParams.parse({ id: req.params.id });
  const body = UpdateRescueOperationBody.parse(req.body);
  const operation = (await getOperations(context)).find((item) => item.id === id);
  if (!operation) {
    res.status(404).json({ error: "Rescue operation not found." });
    return;
  }
  const changes = {
    ...body,
    completedAt: body.status === "COMPLETED" ? new Date() : operation.completedAt ?? null,
  };
  const updated = context.kind === "demo"
    ? Object.assign(operation, changes)
    : await updateSupabaseRow<RescueOperation>(context, "rescue_operations", id, changes);
  if (!updated) {
    res.status(404).json({ error: "Rescue operation not found." });
    return;
  }
  if (body.status === "COMPLETED") {
    if (context.kind === "demo") {
      const team = demoState.teams.find((item) => item.id === operation.teamId);
      if (team) Object.assign(team, { status: "AVAILABLE", incidentId: null, incidentTitle: null, updatedAt: new Date() });
    } else {
      await updateSupabaseRow(context, "rescue_teams", operation.teamId, { status: "AVAILABLE", incidentId: null, updatedAt: new Date() });
    }
  }
  const [teams, incidents] = await Promise.all([getTeams(context), getIncidents(context)]);
  await recordEvent(req, context, "Rescue operation updated", `${updated.teamName} operation status: ${updated.status}.`, "Rescue");
  res.json(UpdateRescueOperationResponse.parse({
    ...updated,
    teamName: teams.find((item) => item.id === updated.teamId)?.name ?? operation.teamName,
    incidentTitle: incidents.find((item) => item.id === updated.incidentId)?.title ?? operation.incidentTitle,
  }));
}));

router.get("/alerts", endpoint(async (_req, res, context) => {
  res.json(ListAlertsResponse.parse(await getAlerts(context)));
}));

router.patch("/alerts/:id", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const { id } = UpdateAlertParams.parse({ id: req.params.id });
  const body = UpdateAlertBody.parse(req.body);
  const current = (await getAlerts(context)).find((item) => item.id === id);
  if (!current) {
    res.status(404).json({ error: "Alert not found." });
    return;
  }
  const updated = context.kind === "demo"
    ? Object.assign(current, body)
    : await updateSupabaseRow<Alert>(context, "alerts", id, body);
  if (!updated) {
    res.status(404).json({ error: "Alert not found." });
    return;
  }
  await recordEvent(req, context, "Alert acknowledged", `${updated.title} marked ${updated.status.toLowerCase()}.`, "Alert");
  res.json(UpdateAlertResponse.parse(updated));
}));

router.get("/weather", endpoint(async (req, res) => {
  const query = GetWeatherQueryParams.parse(req.query);
  const lat = query.lat ?? 14.4673;
  const lng = query.lng ?? 78.8242;
  const location = query.location ?? "Kadapa district";
  res.json(GetWeatherResponse.parse(await readWeather(lat, lng, location)));
}));

router.get("/flood", endpoint(async (req, res) => {
  const query = GetFloodQueryParams.parse(req.query);
  const lat = query.lat ?? 14.4673;
  const lng = query.lng ?? 78.8242;
  const location = query.location ?? "Penna river corridor · Kadapa";
  res.json(GetFloodResponse.parse(await readFlood(lat, lng, location)));
}));

router.get("/risk/:zoneId", endpoint(async (req, res, context) => {
  const { zoneId } = GetZoneRiskParams.parse({ zoneId: req.params.zoneId });
  const [zones, weather, resources, shelters, incidentRows, teamRows] = await Promise.all([
    getZones(context),
    readWeather(),
    getResources(context),
    getShelters(context),
    getIncidents(context),
    getTeams(context),
  ]);
  const zone = zones.find((item) => item.id === zoneId);
  if (!zone) {
    res.status(404).json({ error: "Affected zone not found." });
    return;
  }
  const available = calcShelterCapacity(shelters);
  const shortages = resources.filter((item) => item.status === "LOW" || item.status === "CRITICAL").length;
  const score = calculateRiskScore({
    severity: incidentRows.find((item) => item.id === zone.incidentId)?.severity ?? "MODERATE",
    population: zone.estimatedPopulation,
    rainfallMm: weather.precipitationMm,
    shelterCapacityAvailable: available,
    hasTeam: teamRows.some((team) => team.incidentId === zone.incidentId),
    resourceShortageCount: shortages,
    externalHazardPoints: zone.riskScore >= 80 ? 5 : 0,
  });
  res.json(GetZoneRiskResponse.parse({
    zoneId,
    score,
    level: derivedRiskLevel(score),
    factors: [...zone.riskFactors, ...explainRisk({ population: zone.estimatedPopulation, rainfallMm: weather.precipitationMm, shelterCapacityAvailable: available, resourceShortageCount: shortages })],
    calculatedAt: new Date(),
    classification: context.kind === "demo" ? "SIMULATED" : "CALCULATED",
  }));
}));

function buildRuleBasedCopilot(question: string, contextText: string, classification: "SIMULATED" | "OBSERVED" | "CALCULATED") {
  const lower = question.toLowerCase();
  const advice = /shelter|capacity|evacuat/.test(lower)
    ? "Review shelters with the least available capacity, confirm accessibility and receiving staff, then coordinate transfers with the responsible local authority."
    : /resource|water|medical|supply|stock/.test(lower)
      ? "Prioritize resources already below their configured threshold. Confirm current stock and delivery timing with the named logistics owner before reallocating."
      : /team|rescue|dispatch|route/.test(lower)
        ? "Check team availability, verify access routes by radio, and assign a team only after confirming the incident location and local command approval."
        : /risk|priority|incident|flood/.test(lower)
          ? "Start with the highest calculated risk and P1 incidents, then verify the latest field observations, exposed population and available shelter capacity before changing response priorities."
          : "Use the current incident, shelter, resource and team records to coordinate a response. Verify uncertain facts with the relevant field lead before acting.";
  return {
    answer: `${advice}\n\nThis response is rule-based decision support, not an official instruction. Confirm actions through the incident commander and local emergency procedures.`,
    sources: [
      { title: "SENTINEL operational records", detail: contextText.slice(0, 500), classification },
      { title: "Decision-support safeguards", detail: "No new measurements or unverified events were inferred.", classification: "CALCULATED" as const },
    ],
    classification,
  };
}

router.post("/ai/copilot", endpoint(async (req, res, context) => {
  const body = AskCopilotBody.parse(req.body);
  const [incidentsRows, shelterRows, resourceRows, teamRows, alertRows, weather, flood] = await Promise.all([
    getIncidents(context),
    getShelters(context),
    getResources(context),
    getTeams(context),
    getAlerts(context),
    readWeather(),
    readFlood(),
  ]);
  const active = incidentsRows.filter(activeIncident);
  const snapshot = {
    classification: context.kind === "demo" ? "SIMULATED" : "OBSERVED",
    activeIncidents: active.map(({ title, type, severity, status, priority, location, riskScore, estimatedPopulation, riskFactors }) =>
      ({ title, type, severity, status, priority, location, riskScore, estimatedPopulation, riskFactors })),
    shelters: shelterRows.map(({ name, location, capacity, occupancy, status }) => ({ name, location, capacity, occupancy, status })),
    resources: resourceRows.map(({ name, quantity, unit, minimumThreshold, status }) => ({ name, quantity, unit, minimumThreshold, status })),
    rescueTeams: teamRows.map(({ name, status, location, incidentTitle }) => ({ name, status, location, incidentTitle })),
    activeAlerts: alertRows.filter((item) => item.status === "ACTIVE").map(({ title, severity, message }) => ({ title, severity, message })),
    weather: { location: weather.location, precipitationMm: weather.precipitationMm, temperatureC: weather.temperatureC, source: weather.source, classification: weather.classification },
    flood: { location: flood.location, riverLevelM: flood.riverLevelM, riverDischargeM3s: flood.riverDischargeM3s, trend: flood.trend, riskLevel: flood.riskLevel, source: flood.source, classification: flood.classification },
  };
  const fallback = buildRuleBasedCopilot(body.question, JSON.stringify(snapshot), context.kind === "demo" ? "SIMULATED" : "CALCULATED");
  let result = fallback;
  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: "You are SENTINEL, a cautious disaster-response decision-support assistant. Use only the supplied structured snapshot. Never claim current facts not present in it; distinguish SIMULATED, OBSERVED, FORECAST and CALCULATED data. Do not create measurements, events, casualty counts, routes, official warnings, or authority decisions. State uncertainty and advise confirmation by the responsible incident commander. Give concise, actionable coordination suggestions, not orders. Return valid JSON with keys answer and sources (an array of objects with title and detail).",
            },
            {
              role: "user",
              content: JSON.stringify({ question: body.question, operationalSnapshot: snapshot }),
            },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
      const completion = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = completion.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI returned no content.");
      const parsed = JSON.parse(content) as { answer?: string; sources?: Array<{ title?: string; detail?: string }> };
      if (!parsed.answer?.trim()) throw new Error("OpenAI response did not include an answer.");
      result = {
        answer: parsed.answer.slice(0, 5_000),
        sources: (parsed.sources ?? []).slice(0, 8).map((source) => ({
          title: source.title?.slice(0, 120) || "Operational snapshot",
          detail: source.detail?.slice(0, 500) || "Structured SENTINEL records provided to the assistant.",
          classification: context.kind === "demo" ? "SIMULATED" as const : "CALCULATED" as const,
        })),
        classification: context.kind === "demo" ? "SIMULATED" : "CALCULATED",
      };
    } catch (error) {
      req.log.warn({ err: error }, "OpenAI Copilot unavailable; using rule-based response");
    }
  }
  res.json(AskCopilotResponse.parse(result));
}));

router.get("/data-sources", endpoint(async (_req, res) => {
  res.json(ListDataSourcesResponse.parse(demoState.dataSources));
}));

router.get("/system-events", endpoint(async (_req, res, context) => {
  res.json(ListSystemEventsResponse.parse(newestFirst(await getEvents(context))));
}));

router.get("/search", endpoint(async (req, res, context) => {
  const { q } = SearchGlobalQueryParams.parse(req.query);
  const query = q.toLowerCase();
  const [incidentsRows, sheltersRows, teamsRows, alertsRows] = await Promise.all([
    getIncidents(context),
    getShelters(context),
    getTeams(context),
    getAlerts(context),
  ]);
  const results = [
    ...incidentsRows.filter((item) => `${item.title} ${item.location} ${item.description}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.title, `${item.location} · ${item.priority}`, "INCIDENT", `/incidents/${item.id}`)),
    ...sheltersRows.filter((item) => `${item.name} ${item.location}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.name, `${item.location} · ${item.occupancyPercent}% occupied`, "SHELTER", "/shelters")),
    ...teamsRows.filter((item) => `${item.name} ${item.type} ${item.location}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.name, `${item.type} · ${item.status}`, "TEAM", "/rescue")),
    ...alertsRows.filter((item) => `${item.title} ${item.message}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.title, `${item.severity} · ${item.status}`, "ALERT", "/alerts")),
  ].slice(0, 30);
  res.json(SearchGlobalResponse.parse(results));
}));

router.get("/geocode", endpoint(async (req, res) => {
  const { q } = SearchLocationsQueryParams.parse(req.query);
  res.json(SearchLocationsResponse.parse(await searchLocations(q)));
}));

router.get("/map/analyze", endpoint(async (req, res, context) => {
  const params = AnalyzeAreaQueryParams.parse(req.query);
  const center = { lat: params.lat, lng: params.lng };
  const radiusKm = params.radiusKm ?? 25;
  const [storedIncidents, externalIncidents, shelterRows, teamsRows, alertRows, resourcesRows] = await Promise.all([
    getIncidents(context),
    readPublicIncidents(),
    getShelters(context),
    getTeams(context),
    getAlerts(context),
    getResources(context),
  ]);
  const incidentsInArea = [...storedIncidents, ...externalIncidents].filter((item) =>
    isWithinRadius({ lat: item.lat, lng: item.lng }, center, radiusKm),
  );
  const sheltersInArea = shelterRows.filter((item) => isWithinRadius({ lat: item.lat, lng: item.lng }, center, radiusKm));
  const teamsInArea = teamsRows.filter((item) => isWithinRadius({ lat: item.lat, lng: item.lng }, center, radiusKm));
  const zoneIds = new Set(demoState.zones.filter((zone) => isWithinRadius({ lat: zone.lat, lng: zone.lng }, center, radiusKm)).map((zone) => zone.id));
  const incidentIds = new Set(incidentsInArea.map((incident) => incident.id));
  const alertsInArea = alertRows.filter((alert) => (alert.incidentId && incidentIds.has(alert.incidentId)) || (alert.zoneId && zoneIds.has(alert.zoneId)));
  const shortages = resourcesRows.filter((item) => item.status === "LOW" || item.status === "CRITICAL").map((item) => `${item.name}: ${item.quantity} ${item.unit} (${item.status})`);
  const population = incidentsInArea.filter(activeIncident).reduce((sum, item) => sum + item.estimatedPopulation, 0);
  const leadSeverity = incidentsInArea.reduce<Incident["severity"]>((highest, item) => {
    const rank = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
    return rank[item.severity] > rank[highest] ? item.severity : highest;
  }, "LOW");
  const capacityAvailable = calcShelterCapacity(sheltersInArea);
  const score = incidentsInArea.length
    ? calculateRiskScore({ severity: leadSeverity, population, shelterCapacityAvailable: capacityAvailable, hasTeam: teamsInArea.length > 0, resourceShortageCount: shortages.length })
    : 0;
  const result = {
    center: { lat: center.lat, lng: center.lng, label: `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}` },
    riskLevel: derivedRiskLevel(score),
    riskScore: score,
    estimatedPopulation: population,
    incidents: incidentsInArea,
    shelters: sheltersInArea,
    rescueTeams: teamsInArea,
    alerts: alertsInArea,
    resourceShortages: shortages,
    shelterCapacityAvailable: capacityAvailable,
    classification: context.kind === "demo" ? "SIMULATED" : "CALCULATED",
  };
  res.json(AnalyzeAreaResponse.parse(result));
}));

export default router;
