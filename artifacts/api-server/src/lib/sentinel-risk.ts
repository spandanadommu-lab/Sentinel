import type { IncidentPriority, IncidentSeverity } from "@workspace/api-zod";

const severityPoints: Record<IncidentSeverity, number> = {
  LOW: 12,
  MODERATE: 32,
  HIGH: 58,
  CRITICAL: 76,
};

export interface RiskInputs {
  severity?: IncidentSeverity;
  population?: number;
  rainfallMm?: number | null;
  shelterCapacityAvailable?: number | null;
  hasTeam?: boolean;
  resourceShortageCount?: number;
  externalHazardPoints?: number;
}

export function calculateRiskScore(input: RiskInputs): number {
  let score = severityPoints[input.severity ?? "MODERATE"];
  const population = Math.max(0, input.population ?? 0);
  score += Math.min(14, Math.round(Math.log10(population + 1) * 2.5));

  const rainfall = input.rainfallMm ?? 0;
  if (rainfall >= 20) score += 5;
  if (rainfall >= 50) score += 8;
  if (rainfall >= 100) score += 10;

  if (input.shelterCapacityAvailable !== null && input.shelterCapacityAvailable !== undefined) {
    if (input.shelterCapacityAvailable <= 0) score += 12;
    else if (input.shelterCapacityAvailable < 250) score += 8;
    else if (input.shelterCapacityAvailable < 800) score += 4;
  }
  if (input.hasTeam === false) score += 6;
  score += Math.min(8, Math.max(0, input.resourceShortageCount ?? 0) * 2);
  score += Math.min(12, Math.max(0, input.externalHazardPoints ?? 0));
  return Math.max(0, Math.min(100, score));
}

export function priorityForRisk(
  score: number,
  severity: IncidentSeverity,
): IncidentPriority {
  if (score >= 80 || severity === "CRITICAL") return "P1";
  if (score >= 55 || severity === "HIGH") return "P2";
  return "P3";
}

export function explainRisk(input: RiskInputs): string[] {
  const factors: string[] = [];
  if ((input.rainfallMm ?? 0) >= 50) factors.push("Elevated observed or forecast rainfall");
  if ((input.population ?? 0) >= 10_000) factors.push("High estimated population exposure");
  else if ((input.population ?? 0) >= 2_000) factors.push("Moderate estimated population exposure");
  if (input.shelterCapacityAvailable !== null && input.shelterCapacityAvailable !== undefined) {
    if (input.shelterCapacityAvailable <= 0) factors.push("No reported shelter capacity available");
    else if (input.shelterCapacityAvailable < 250) factors.push("Limited reported shelter capacity");
  }
  if (input.hasTeam === false) factors.push("No rescue team currently assigned");
  if ((input.resourceShortageCount ?? 0) > 0) factors.push("One or more resource categories are below threshold");
  if (input.externalHazardPoints) factors.push("External hazard evidence affects the screening score");
  if (!factors.length) factors.push("Risk score is based on reported severity and available records");
  return factors;
}
