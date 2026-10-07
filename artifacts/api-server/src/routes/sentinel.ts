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
  updateDataSourceStatus,
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

async function findIncidentById(context: SentinelContext, id: string): Promise<Incident | null> {
  const stored = await getIncidents(context);
  const found = stored.find((item) => item.id === id);
  if (found) return found;
  const publicRows = await readPublicIncidents();
  const pub = publicRows.find((item) => item.id === id);
  if (!pub) return null;
  if (context.kind === "demo") {
    demoState.incidents.unshift(pub);
    return pub;
  }
  return insertSupabaseRow<Incident>(context, "incidents", pub);
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
  type: "incident" | "shelter" | "rescue_team" | "zone" | "location",
  lat: number,
  lng: number,
) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    label: title,
    detail: subtitle,
  });
  return { id, title, subtitle, type, lat, lng, path: `/map?${params.toString()}` };
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
  const [incident, zones, alerts] = await Promise.all([
    findIncidentById(context, id),
    getZones(context),
    getAlerts(context),
  ]);
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
  const [shelterRows, resourceRows, weather, teams] = await Promise.all([
    getShelters(context),
    getResources(context),
    readWeather(body.lat, body.lng, body.location),
    getTeams(context),
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

  if (body.assignedTeamId) {
    const team = teams.find((t) => t.id === body.assignedTeamId);
    if (team) {
      if (context.kind === "demo") {
        Object.assign(team, {
          incidentId: saved.id,
          incidentTitle: saved.title,
          status: "DEPLOYED" as const,
          priority: saved.priority,
          updatedAt: new Date(),
        });
        demoState.operations.unshift({
          id: crypto.randomUUID(),
          teamId: team.id,
          teamName: team.name,
          incidentId: saved.id,
          incidentTitle: saved.title,
          status: "DEPLOYED",
          priority: saved.priority,
          notes: "Assigned at incident creation.",
          startedAt: new Date(),
          completedAt: null,
        });
      } else {
        await updateSupabaseRow(context, "rescue_teams", team.id, {
          incidentId: saved.id,
          status: "DEPLOYED",
          priority: saved.priority,
          updatedAt: new Date(),
        });
        await insertSupabaseRow<RescueOperation>(context, "rescue_operations", {
          id: crypto.randomUUID(),
          teamId: team.id,
          incidentId: saved.id,
          status: "DEPLOYED",
          priority: saved.priority,
          notes: "Assigned at incident creation.",
          startedAt: new Date(),
          completedAt: null,
        });
      }
    }
  }

  await recordEvent(req, context, "Incident recorded", `${saved.title} received an initial ${saved.priority} priority.`, "Incident");
  res.status(201).json(CreateIncidentResponse.parse(saved));
}));

router.patch("/incidents/:id", endpoint(async (req, res, context) => {
  if (!requireOperationalRole(context, res)) return;
  const { id } = UpdateIncidentParams.parse({ id: req.params.id });
  const body = UpdateIncidentBody.parse(req.body);
  const current = await findIncidentById(context, id);
  if (!current) {
    res.status(404).json({ error: "Incident not found." });
    return;
  }
  const [shelterRows, resourceRows, weather, teams] = await Promise.all([
    getShelters(context),
    getResources(context),
    readWeather(current.lat, current.lng, current.location),
    getTeams(context),
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

  // Synchronize team dispatch posture if assignedTeamId changed
  if (body.assignedTeamId !== undefined && body.assignedTeamId !== current.assignedTeamId) {
    const oldTeamId = current.assignedTeamId;
    const newTeamId = body.assignedTeamId;
    if (newTeamId) {
      const newTeam = teams.find((t) => t.id === newTeamId);
      if (newTeam) {
        if (context.kind === "demo") {
          Object.assign(newTeam, {
            incidentId: updated.id,
            incidentTitle: updated.title,
            status: "DEPLOYED" as const,
            priority: updated.priority,
            updatedAt: new Date(),
          });
          const existingOp = demoState.operations.find((op) => op.teamId === newTeam.id && op.status !== "COMPLETED");
          if (existingOp) {
            Object.assign(existingOp, { incidentId: updated.id, incidentTitle: updated.title, status: "DEPLOYED" as const, priority: updated.priority });
          } else {
            demoState.operations.unshift({
              id: crypto.randomUUID(),
              teamId: newTeam.id,
              teamName: newTeam.name,
              incidentId: updated.id,
              incidentTitle: updated.title,
              status: "DEPLOYED",
              priority: updated.priority,
              notes: "Assigned from incident desk.",
              startedAt: new Date(),
              completedAt: null,
            });
          }
        } else {
          await updateSupabaseRow(context, "rescue_teams", newTeam.id, {
            incidentId: updated.id,
            status: "DEPLOYED",
            priority: updated.priority,
            updatedAt: new Date(),
          });
        }
      }
    }
    if (oldTeamId && oldTeamId !== newTeamId) {
      const oldTeam = teams.find((t) => t.id === oldTeamId);
      if (oldTeam) {
        if (context.kind === "demo") {
          Object.assign(oldTeam, {
            incidentId: null,
            incidentTitle: null,
            status: "AVAILABLE" as const,
            updatedAt: new Date(),
          });
          const existingOp = demoState.operations.find((op) => op.teamId === oldTeam.id && op.status !== "COMPLETED");
          if (existingOp) {
            Object.assign(existingOp, { status: "COMPLETED" as const, completedAt: new Date() });
          }
        } else {
          await updateSupabaseRow(context, "rescue_teams", oldTeam.id, {
            incidentId: null,
            status: "AVAILABLE",
            updatedAt: new Date(),
          });
        }
      }
    }
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
  const [teams, incident] = await Promise.all([
    getTeams(context),
    findIncidentById(context, body.incidentId),
  ]);
  const team = teams.find((item) => item.id === body.teamId);
  if (!team || !incident) {
    req.log.warn({ teamId: body.teamId, incidentId: body.incidentId, foundTeam: !!team, foundIncident: !!incident }, "Team or incident not found");
    res.status(404).json({ error: !team ? "Rescue team not found." : "Incident not found." });
    return;
  }
  if (team.status !== "AVAILABLE" && team.incidentId !== incident.id) {
    res.status(409).json({ error: `Team ${team.name} is currently ${team.status} and cannot take a new assignment.` });
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
      const incident = demoState.incidents.find((item) => item.id === operation.incidentId);
      if (incident && incident.assignedTeamId === operation.teamId) {
        Object.assign(incident, { assignedTeamId: null, updatedAt: new Date() });
      }
    } else {
      await updateSupabaseRow(context, "rescue_teams", operation.teamId, { status: "AVAILABLE", incidentId: null, updatedAt: new Date() });
      await updateSupabaseRow(context, "incidents", operation.incidentId, { assignedTeamId: null, updatedAt: new Date() });
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

type CopilotSnapshot = {
  classification: "SIMULATED" | "OBSERVED" | "CALCULATED";
  activeIncidents: Incident[];
  affectedZones: AffectedZone[];
  shelters: Shelter[];
  resources: Resource[];
  rescueTeams: RescueTeam[];
  activeAlerts: Alert[];
  weather: WeatherReading;
  flood: FloodReading;
  area?: { lat: number; lng: number; radiusKm: number; label?: string };
  focusedIncident?: Incident;
  focusedZone?: AffectedZone;
};

function buildRuleBasedCopilot(question: string, snapshot: CopilotSnapshot) {
  const lower = question.toLowerCase();
  const incidents = snapshot.activeIncidents;
  const exposed = incidents.reduce((sum, item) => sum + item.estimatedPopulation, 0);
  const urgent = [...incidents].filter((item) => item.priority === "P1" || item.severity === "CRITICAL")
    .sort((a, b) => b.riskScore - a.riskScore);
  const shortResources = snapshot.resources.filter((item) => item.status === "LOW" || item.status === "CRITICAL" || item.status === "OUT");
  const availableCapacity = snapshot.shelters
    .filter((item) => item.status !== "CLOSED")
    .reduce((sum, item) => sum + Math.max(0, item.capacity - item.occupancy), 0);
  const availableTeams = snapshot.rescueTeams.filter((item) => item.status === "AVAILABLE");
  const constrainedShelters = [...snapshot.shelters]
    .filter((item) => item.status !== "CLOSED")
    .sort((a, b) => b.occupancyPercent - a.occupancyPercent)
    .slice(0, 3);
  const topIncidents = [...incidents].sort((a, b) => b.riskScore - a.riskScore).slice(0, 3);
  const zoneSummary = snapshot.affectedZones.slice(0, 5);
  const factualLines = [
    `${incidents.length} active or monitoring incident(s); ${exposed.toLocaleString()} estimated people at risk (ESTIMATED).`,
    `${urgent.length} P1 or critical incident(s): ${urgent.length ? urgent.slice(0, 3).map((item) => `${item.title} (${item.location}, ${item.priority}, risk ${item.riskScore}/100 CALCULATED; ${item.riskFactors.join(", ")})`).join("; ") : "none in the current records"}.`,
    `${availableTeams.length} rescue team(s) listed as available; ${snapshot.rescueTeams.length - availableTeams.length} listed as deployed or otherwise unavailable.`,
    `Shelter capacity remaining: ${availableCapacity.toLocaleString()} place(s) across open shelters. Highest occupancy: ${constrainedShelters.length ? constrainedShelters.map((item) => `${item.name} ${item.occupancy}/${item.capacity} (${item.occupancyPercent}%)`).join("; ") : "no open shelter records"}.`,
    `Resource shortages: ${shortResources.length ? shortResources.map((item) => `${item.name} ${item.quantity} ${item.unit} (${item.status}; threshold ${item.minimumThreshold})`).join("; ") : "none at or below recorded thresholds"}.`,
    `Affected zones: ${zoneSummary.length ? zoneSummary.map((item) => `${item.name} — ${item.location}, ${item.riskLevel} risk (${item.riskScore}/100, ${item.classification})`).join("; ") : "no affected zones recorded"}.`,
    `Weather: ${snapshot.weather.temperatureC}°C and ${snapshot.weather.precipitationMm} mm precipitation at ${snapshot.weather.location} (${snapshot.weather.classification}, ${snapshot.weather.source}).`,
    `Flood information: ${snapshot.flood.location}, ${snapshot.flood.trend.toLowerCase()} trend, ${snapshot.flood.riskLevel} scenario/model risk (${snapshot.flood.classification}, ${snapshot.flood.source}).`,
  ];
  const focused = snapshot.focusedIncident
    ? `Selected incident: ${snapshot.focusedIncident.title} at ${snapshot.focusedIncident.location}; ${snapshot.focusedIncident.priority}, score ${snapshot.focusedIncident.riskScore}/100 CALCULATED. Risk factors: ${snapshot.focusedIncident.riskFactors.join(", ")}.`
    : snapshot.focusedZone
      ? `Selected zone: ${snapshot.focusedZone.name} at ${snapshot.focusedZone.location}; ${snapshot.focusedZone.riskLevel} risk, score ${snapshot.focusedZone.riskScore}/100; estimated population ${snapshot.focusedZone.estimatedPopulation.toLocaleString()}. Factors: ${snapshot.focusedZone.riskFactors.join(", ")}.`
      : "";
  const isShelter = /shelter|capacity|evacuat/.test(lower);
  const isResource = /resource|water|medical|supply|stock|shortage/.test(lower);
  const isIncident = /urgent|priority|incident|high risk|critical/.test(lower);
  const isZone = /zone|area|affected|location/.test(lower);
  let answer: string;
  let recommendations: string[];
  if (snapshot.area) {
    const location = snapshot.area.label || `${snapshot.area.lat.toFixed(4)}, ${snapshot.area.lng.toFixed(4)}`;
    answer = [
      `Selected area: ${location}, within ${snapshot.area.radiusKm} km. Records below match this area; coordinates are not live GPS.`,
      `${incidents.length} active or monitoring incident(s), with ${exposed.toLocaleString()} people estimated at risk.`,
      `Incidents: ${incidents.length ? incidents.map((item) => `${item.title} (${item.location}, ${item.priority}, risk ${item.riskScore}/100 CALCULATED)`).join("; ") : "none in the current records"}.`,
      `Affected zones: ${zoneSummary.length ? zoneSummary.map((item) => `${item.name} (${item.location}, ${item.riskLevel}, ${item.classification})`).join("; ") : "none in the current records"}.`,
      `Nearby shelters: ${snapshot.shelters.length ? snapshot.shelters.map((item) => `${item.name} ${item.occupancy}/${item.capacity} occupied`).join("; ") : "none in the current records"}.`,
      `Nearby rescue teams: ${snapshot.rescueTeams.length ? snapshot.rescueTeams.map((item) => `${item.name} (${item.status})`).join("; ") : "none in the current records"}.`,
      `District resource shortages: ${shortResources.length ? shortResources.map((item) => `${item.name} ${item.quantity} ${item.unit} (${item.status})`).join("; ") : "none at or below recorded thresholds"}.`,
    ].join("\n");
    recommendations = [
      "Confirm the selected location and operational records with the field lead before dispatch.",
      "Review nearby shelter availability and team status with local command.",
      "This summary uses a radius calculation; confirm boundaries and access conditions independently.",
    ];
  } else if (snapshot.focusedIncident || snapshot.focusedZone) {
    answer = [focused, ...factualLines.slice(1, 6)].filter(Boolean).join("\n");
    recommendations = [
      "Confirm the latest field report and exact access conditions with the responsible local team.",
      "Recheck nearby shelter capacity and current resource availability before coordinating a transfer.",
      "Confirm any change in priority with the incident commander; the risk score is calculated from structured records.",
    ];
  } else if (isShelter) {
    answer = factualLines[3]!;
    recommendations = [
      "Confirm the occupancy count, receiving staff, accessibility and current supplies with each shelter lead.",
      "Coordinate any transfer through the responsible local authority.",
    ];
  } else if (isResource) {
    answer = factualLines[4]!;
    recommendations = [
      "Verify stock counts and delivery timing with the named logistics owner before reallocating supplies.",
      "Prioritize resources below their recorded minimum threshold.",
    ];
  } else if (isIncident) {
    answer = `${urgent.length ? urgent.slice(0, 5).map((item) => `${item.title} — ${item.location}; ${item.priority}; risk ${item.riskScore}/100 CALCULATED. Factors: ${item.riskFactors.join(", ")}.`).join("\n") : "No P1 or critical incidents are listed in the current operational records."}`;
    recommendations = [
      "Verify the latest field observations, exposed population and access status before changing incident priority.",
      "Check whether a suitable rescue team is available and confirm dispatch through incident command.",
    ];
  } else if (isZone) {
    answer = zoneSummary.length
      ? zoneSummary.map((item) => `${item.name} — ${item.location}; ${item.riskLevel} risk (${item.riskScore}/100 CALCULATED); ${item.estimatedPopulation.toLocaleString()} people estimated; factors: ${item.riskFactors.join(", ")}.`).join("\n")
      : "No affected zones are present in the current operational records.";
    recommendations = [
      "Confirm zone boundaries and exposed-population estimates with current field reports.",
      "Review the nearest shelter and available team records before coordinating action.",
    ];
  } else {
    answer = factualLines.join("\n");
    recommendations = [
      "Verify high-priority conditions and access routes with the responsible field lead.",
      "Review shelter capacity and resource shortages before coordinating transfers or dispatch.",
      "Confirm source freshness and follow the local incident-command process.",
    ];
  }
  const prefix = snapshot.classification === "SIMULATED"
    ? "SIMULATED / DEMO scenario — not live emergency information.\n"
    : "";
  return {
    answer: `${prefix}${answer}`,
    recommendations,
    source: "rules" as const,
    generatedAt: new Date(),
    disclaimer: "Decision support only. Confirm facts and actions with official sources and the responsible incident commander.",
  };
}

router.post("/ai/copilot", endpoint(async (req, res, context) => {
  const body = AskCopilotBody.parse(req.body);
  const [incidentsRows, zonesRows, shelterRows, resourceRows, teamRows, alertRows, weather, flood] = await Promise.all([
    getIncidents(context),
    getZones(context),
    getShelters(context),
    getResources(context),
    getTeams(context),
    getAlerts(context),
    readWeather(),
    readFlood(),
  ]);
  const active = incidentsRows.filter(activeIncident);
  const areaCenter = body.area ? { lat: body.area.lat, lng: body.area.lng } : null;
  const areaIncidents = areaCenter
    ? active.filter((item) => isWithinRadius({ lat: item.lat, lng: item.lng }, areaCenter, body.area!.radiusKm))
    : active;
  const areaZones = areaCenter
    ? zonesRows.filter((item) => isWithinRadius({ lat: item.lat, lng: item.lng }, areaCenter, body.area!.radiusKm))
    : zonesRows;
  const areaShelters = areaCenter
    ? shelterRows.filter((item) => isWithinRadius({ lat: item.lat, lng: item.lng }, areaCenter, body.area!.radiusKm))
    : shelterRows;
  const areaTeams = areaCenter
    ? teamRows.filter((item) => isWithinRadius({ lat: item.lat, lng: item.lng }, areaCenter, body.area!.radiusKm))
    : teamRows;
  const areaIncidentIds = new Set(areaIncidents.map((item) => item.id));
  const areaZoneIds = new Set(areaZones.map((item) => item.id));
  const snapshot: CopilotSnapshot = {
    classification: context.kind === "demo" ? "SIMULATED" : "OBSERVED",
    activeIncidents: areaIncidents,
    affectedZones: areaZones,
    shelters: areaShelters,
    resources: resourceRows,
    rescueTeams: areaTeams,
    activeAlerts: alertRows.filter((item) =>
      item.status === "ACTIVE" &&
      ((item.incidentId && areaIncidentIds.has(item.incidentId)) || (item.zoneId && areaZoneIds.has(item.zoneId))),
    ),
    weather,
    flood,
    ...(body.area ? { area: body.area } : {}),
    focusedIncident: body.incidentId ? incidentsRows.find((item) => item.id === body.incidentId) : undefined,
    focusedZone: body.zoneId ? zonesRows.find((item) => item.id === body.zoneId) : undefined,
  };
  const fallback = buildRuleBasedCopilot(body.question, snapshot);
  let result: typeof fallback | (Omit<typeof fallback, "source"> & { source: "openai" }) = fallback;
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
              content: "You are SENTINEL. You may only select safe generic recommendations already supplied in the user message. Do not write free text or add facts. Return valid JSON with one key recommendationIndices containing zero-based integer indices of the supplied recommendations. Select at most 3.",
            },
            {
              role: "user",
              content: JSON.stringify({
                question: body.question,
                operationalSnapshot: snapshot,
                safeRecommendations: fallback.recommendations,
              }),
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
      const parsed = JSON.parse(content) as { recommendationIndices?: unknown };
      if (!Array.isArray(parsed.recommendationIndices)) throw new Error("OpenAI returned no recommendation selection.");
      const indices = parsed.recommendationIndices
        .filter((index): index is number => Number.isInteger(index) && index >= 0 && index < fallback.recommendations.length)
        .slice(0, 3);
      result = {
        ...fallback,
        recommendations: indices.length
          ? indices.map((index) => fallback.recommendations[index]!)
          : fallback.recommendations,
        source: "openai",
      };
      updateDataSourceStatus("openai", "LIVE", "OpenAI was reachable; structured facts and safe recommendations remain constrained to SENTINEL records.");
    } catch (error) {
      req.log.warn({ err: error }, "OpenAI Copilot unavailable; using rule-based response");
      updateDataSourceStatus("openai", "ERROR", "OpenAI is unavailable; deterministic rule-based decision support is being used.", error instanceof Error ? error.message : String(error));
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
  const [incidentsRows, sheltersRows, teamsRows, alertsRows, zonesRows] = await Promise.all([
    getIncidents(context),
    getShelters(context),
    getTeams(context),
    getAlerts(context),
    getZones(context),
  ]);
  const locationRows = q.length >= 2
    ? await searchLocations(q).catch((error) => {
        req.log.warn({ err: error }, "Location search unavailable; returning matching operational records");
        return [];
      })
    : [];
  const results = [
    ...incidentsRows.filter((item) => `${item.title} ${item.location} ${item.description}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.title, `${item.location} · ${item.priority}`, "incident", item.lat, item.lng)),
    ...sheltersRows.filter((item) => `${item.name} ${item.location}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.name, `${item.location} · ${item.occupancyPercent}% occupied`, "shelter", item.lat, item.lng)),
    ...teamsRows.filter((item) => `${item.name} ${item.type} ${item.location}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.name, `${item.type} · ${item.status}`, "rescue_team", item.lat, item.lng)),
    ...zonesRows.filter((item) => `${item.name} ${item.location} ${item.riskLevel}`.toLowerCase().includes(query))
      .map((item) => toSearchResult(item.id, item.name, `${item.location} · ${item.riskLevel} risk`, "zone", item.lat, item.lng)),
    ...locationRows.map((item, index) => toSearchResult(
      `location-${index}-${item.lat.toFixed(4)}-${item.lng.toFixed(4)}`,
      item.name,
      item.displayName,
      "location",
      item.lat,
      item.lng,
    )),
    ...alertsRows.filter((item) => `${item.title} ${item.message}`.toLowerCase().includes(query))
      .map((item) => {
        const incident = incidentsRows.find((row) => row.id === item.incidentId);
        const zone = zonesRows.find((row) => row.id === item.zoneId);
        const point = incident ?? zone ?? { lat: 14.4673, lng: 78.8242 };
        return toSearchResult(item.id, item.title, `${item.severity} · ${item.status}`, "location", point.lat, point.lng);
      }),
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
