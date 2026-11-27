import { and, eq } from "drizzle-orm";
import { toolConnections, type Db } from "@paperclipai/db";
import { notifyDeliveryWork, DELIVERY_QUEUES } from "../../delivery-work-notifications.js";
import { nativeRestRecord as record } from "../../native-rest-client.js";
/** Consent completion must preserve a concurrent watch setup and wake it only after commit. */
export async function prepareGooglePushOAuthConfig(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], connection: typeof toolConnections.$inferSelect, config: Record<string,unknown>) {
  if (!["gmail","google-calendar"].includes(String(connection.config.sourceTemplateKey))) return;
  const [fresh] = await tx.select({config:toolConnections.config}).from(toolConnections).where(and(eq(toolConnections.id,connection.id),eq(toolConnections.companyId,connection.companyId))).for("update");
  if (!fresh) return;
  const state=record(fresh.config.googlePush);
  config.googlePush=state.enabled===true ? {...state,nextAt:Date.now(),status:"awaiting_authorization"} : fresh.config.googlePush;
  if(state.enabled===true)await notifyDeliveryWork(tx,DELIVERY_QUEUES.googlePush);
}
