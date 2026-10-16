
DO $$
BEGIN
  IF to_regclass('public.knowledge_documents') IS NULL THEN
    RAISE EXCEPTION 'knowledge_documents table is missing';
  END IF;

  IF to_regclass('public.knowledge_chunks') IS NULL THEN
    RAISE EXCEPTION 'knowledge_chunks table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_chunks'
      AND column_name = 'embedding'
      AND udt_name = 'vector'
  ) THEN
    RAISE EXCEPTION 'Knowledge embeddings column is missing';
  END IF;

  IF to_regprocedure(
    'public.knowledge_match_public(extensions.vector,integer,double precision,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Public knowledge retrieval function is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permissions
    WHERE key = 'knowledge.read'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.permissions
    WHERE key = 'knowledge.manage'
  ) THEN
    RAISE EXCEPTION 'Knowledge permissions have not been registered';
  END IF;

  RAISE NOTICE 'Phase 12 schema checks passed';
END;
$$;
