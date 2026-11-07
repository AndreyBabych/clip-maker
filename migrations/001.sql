CREATE TABLE IF NOT EXISTS projects (
 id uuid PRIMARY KEY, revision integer NOT NULL DEFAULT 1,
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
