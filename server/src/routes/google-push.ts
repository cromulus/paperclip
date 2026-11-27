import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { googlePushService } from "../services/connectors/google-workspace-api/push.js";
import { badRequest } from "../errors.js";
export function googlePushRoutes(db: Db, publicBaseUrl?: string) {
  const router = Router(), service = googlePushService(db, { publicBaseUrl });
  router.post("/api/google-push/:connectionId", async (req,res) => {
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(req.params.connectionId as string))throw badRequest("Invalid connection reference");
    const headers:Record<string,string|undefined>={};
    for(const key of ["authorization","x-goog-channel-token","x-goog-channel-id","x-goog-message-number","x-goog-resource-state","x-goog-resource-id"])headers[key]=req.header(key);
    await service.accept(req.params.connectionId as string,headers,req.body);
    res.sendStatus(204);
  });
  return router;
}
