-- Sprint 5: CMS news, comments, documents and PDF maps.
CREATE SCHEMA IF NOT EXISTS cms;

CREATE TABLE IF NOT EXISTS cms.news (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    summary TEXT CHECK (summary IS NULL OR char_length(summary) <= 1000),
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 100000),
    visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ,
    created_by BIGINT NOT NULL REFERENCES auth.users(id),
    updated_by BIGINT REFERENCES auth.users(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS cms.news_comments (
    id BIGSERIAL PRIMARY KEY,
    news_id BIGINT NOT NULL REFERENCES cms.news(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES auth.users(id),
    content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    moderated_by BIGINT REFERENCES auth.users(id),
    moderated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((status = 'pending' AND moderated_by IS NULL AND moderated_at IS NULL)
        OR (status <> 'pending' AND moderated_by IS NOT NULL AND moderated_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS cms.documents (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    document_code VARCHAR(100) NOT NULL CHECK (char_length(btrim(document_code)) BETWEEN 1 AND 100),
    issuing_agency VARCHAR(300) NOT NULL CHECK (char_length(btrim(issuing_agency)) BETWEEN 1 AND 300),
    issued_at DATE,
    description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
    visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    file_object_id BIGINT NOT NULL UNIQUE REFERENCES core.file_objects(id),
    created_by BIGINT NOT NULL REFERENCES auth.users(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_documents_code_active
    ON cms.documents (lower(document_code)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cms.pdf_maps (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    scale_label VARCHAR(100) NOT NULL CHECK (char_length(btrim(scale_label)) BETWEEN 1 AND 100),
    map_year SMALLINT NOT NULL CHECK (map_year BETWEEN 1900 AND 2200),
    preparing_agency VARCHAR(300) NOT NULL CHECK (char_length(btrim(preparing_agency)) BETWEEN 1 AND 300),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
    visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    file_object_id BIGINT NOT NULL UNIQUE REFERENCES core.file_objects(id),
    created_by BIGINT NOT NULL REFERENCES auth.users(id),
    updated_by BIGINT REFERENCES auth.users(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_news_public
    ON cms.news (published_at DESC, id DESC) WHERE deleted_at IS NULL AND status = 'published';
CREATE INDEX IF NOT EXISTS idx_cms_news_title_trgm
    ON cms.news USING gin (title gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_comments_news_status
    ON cms.news_comments (news_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_cms_documents_public
    ON cms.documents (visibility, issued_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_documents_title_trgm
    ON cms.documents USING gin (title gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_pdf_maps_public
    ON cms.pdf_maps (visibility, map_year DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_pdf_maps_title_trgm
    ON cms.pdf_maps USING gin (title gin_trgm_ops) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trigger_cms_news_updated_at ON cms.news;
CREATE TRIGGER trigger_cms_news_updated_at BEFORE UPDATE ON cms.news
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
DROP TRIGGER IF EXISTS trigger_cms_comments_updated_at ON cms.news_comments;
CREATE TRIGGER trigger_cms_comments_updated_at BEFORE UPDATE ON cms.news_comments
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
DROP TRIGGER IF EXISTS trigger_cms_documents_updated_at ON cms.documents;
CREATE TRIGGER trigger_cms_documents_updated_at BEFORE UPDATE ON cms.documents
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
DROP TRIGGER IF EXISTS trigger_cms_pdf_maps_updated_at ON cms.pdf_maps;
CREATE TRIGGER trigger_cms_pdf_maps_updated_at BEFORE UPDATE ON cms.pdf_maps
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
