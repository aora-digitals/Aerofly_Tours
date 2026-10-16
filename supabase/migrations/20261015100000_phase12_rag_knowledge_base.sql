
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 240),
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (
    category IN (
      'faq', 'tour', 'destination', 'visa',
      'policy', 'company', 'other'
    )
  ),
  source_type TEXT NOT NULL DEFAULT 'staff'
    CHECK (source_type IN ('staff', 'website', 'import', 'catalogue')),
  source_url TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200000),
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'staff')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'unpublished', 'error')),
  indexing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (indexing_status IN ('pending', 'processing', 'indexed', 'error', 'not_required')),
  indexing_error TEXT,
  content_sha256 TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL
    REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 6000),
  token_estimate INTEGER NOT NULL DEFAULT 0,
  embedding extensions.vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_documents_status_category_idx
  ON public.knowledge_documents(status, visibility, category);

CREATE INDEX IF NOT EXISTS knowledge_chunks_document_idx
  ON public.knowledge_chunks(document_id, chunk_index);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON public.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.knowledge_documents FROM anon, authenticated;
REVOKE ALL ON public.knowledge_chunks FROM anon, authenticated;

GRANT SELECT ON public.knowledge_documents TO authenticated;
GRANT SELECT ON public.knowledge_chunks TO authenticated;

DROP POLICY IF EXISTS knowledge_documents_staff_read
  ON public.knowledge_documents;

CREATE POLICY knowledge_documents_staff_read
ON public.knowledge_documents
FOR SELECT TO authenticated
USING (
  public.has_permission('knowledge.read', NULL)
  OR public.has_permission('knowledge.manage', NULL)
);

DROP POLICY IF EXISTS knowledge_chunks_staff_read
  ON public.knowledge_chunks;

CREATE POLICY knowledge_chunks_staff_read
ON public.knowledge_chunks
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.knowledge_documents d
    WHERE d.id = document_id
      AND (
        public.has_permission('knowledge.read', NULL)
        OR public.has_permission('knowledge.manage', NULL)
      )
  )
);

CREATE OR REPLACE FUNCTION public.knowledge_match_public(
  query_embedding extensions.vector(1536),
  match_count INTEGER DEFAULT 6,
  min_similarity DOUBLE PRECISION DEFAULT 0.72,
  filter_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  title TEXT,
  category TEXT,
  content TEXT,
  source_url TEXT,
  source_metadata JSONB,
  similarity DOUBLE PRECISION
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    c.id,
    d.id,
    d.title,
    d.category,
    c.content,
    d.source_url,
    d.source_metadata,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding)
      AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.status = 'published'
    AND d.visibility = 'public'
    AND d.indexing_status = 'indexed'
    AND c.embedding IS NOT NULL
    AND (filter_category IS NULL OR d.category = filter_category)
    AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding)
      >= GREATEST(0.0, LEAST(min_similarity, 1.0))
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 12));
$$;

REVOKE ALL ON FUNCTION public.knowledge_match_public(
  extensions.vector, INTEGER, DOUBLE PRECISION, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.knowledge_match_public(
  extensions.vector, INTEGER, DOUBLE PRECISION, TEXT
) TO service_role;

INSERT INTO public.permissions(key, description)
VALUES
  ('knowledge.read', 'Read knowledge documents and indexing status'),
  ('knowledge.manage', 'Create, edit, publish and re-index knowledge documents')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.knowledge_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_documents_touch_updated_at
  ON public.knowledge_documents;

CREATE TRIGGER knowledge_documents_touch_updated_at
BEFORE UPDATE ON public.knowledge_documents
FOR EACH ROW
EXECUTE FUNCTION public.knowledge_touch_updated_at();

COMMIT;
