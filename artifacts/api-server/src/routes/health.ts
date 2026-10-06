import { Router, type IRouter } from "express";
import { GetApiHealthResponse, HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok", service: "sentinel-api" });
  res.json(data);
});

router.get("/health", (_req, res) => {
  const data = GetApiHealthResponse.parse({ status: "ok", service: "sentinel-api" });
  res.json(data);
});

export default router;
