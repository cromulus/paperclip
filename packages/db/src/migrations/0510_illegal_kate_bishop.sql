-- paperclip:migration-compat online_compatible: Preserves the previously installed nullable UUID owner column; new indexes build concurrently without blocking existing writers.
-- NMC previously shipped these objects as 0375_stiff_meggan.sql. Upstream now
-- owns 0375, so retain the old database receipt and reconcile by schema here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.environments'::regclass AND attname = 'owner_agent_id' AND NOT attisdropped) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.environments'::regclass AND attname = 'owner_agent_id' AND atttypid = 'uuid'::regtype AND NOT attnotnull AND NOT attisdropped) THEN
      RAISE EXCEPTION 'NMC environment owner column has an incompatible definition';
    END IF;
  ELSE
    ALTER TABLE public.environments ADD COLUMN owner_agent_id uuid;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "environments_owner_agent_idx" ON "environments" USING btree ("owner_agent_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_am am ON am.oid = c.relam
    WHERE n.nspname = 'public' AND c.relname = 'environments_owner_agent_idx'
      AND i.indrelid = 'public.environments'::regclass AND i.indisvalid AND i.indisready
      AND NOT i.indisunique AND am.amname = 'btree' AND i.indnkeyatts = 1 AND i.indnatts = 1
      AND i.indexprs IS NULL AND i.indpred IS NULL
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'owner_agent_id'
  ) THEN RAISE EXCEPTION 'NMC environment owner index has an incompatible definition'; END IF;
END $$;
