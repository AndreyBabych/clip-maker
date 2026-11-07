CREATE TABLE assets (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), target_id text NOT NULL,
 kind text NOT NULL, source text NOT NULL, state text NOT NULL DEFAULT 'processing',
 storage_key text NOT NULL UNIQUE, name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_project_idx ON assets(project_id);
CREATE TABLE quotes(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),revision integer NOT NULL,payload jsonb NOT NULL,estimated numeric,expires_at timestamptz NOT NULL,used boolean NOT NULL DEFAULT false);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), target_id text NOT NULL,
 kind text NOT NULL, state text NOT NULL DEFAULT 'queued', provider text NOT NULL DEFAULT 'local', model text,
 payload jsonb NOT NULL, external jsonb, result jsonb, error text, attempts integer NOT NULL DEFAULT 0,
 estimated numeric, confirmed numeric, quote_id uuid REFERENCES quotes(id),
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(quote_id,target_id)
);
CREATE INDEX jobs_queue_idx ON jobs(state,available_at);
CREATE TABLE project_history(id bigserial PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),revision integer NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
