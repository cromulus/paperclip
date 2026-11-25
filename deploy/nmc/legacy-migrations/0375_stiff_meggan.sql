ALTER TABLE "environments" ADD COLUMN "owner_agent_id" uuid;--> statement-breakpoint
CREATE INDEX "environments_owner_agent_idx" ON "environments" USING btree ("owner_agent_id");