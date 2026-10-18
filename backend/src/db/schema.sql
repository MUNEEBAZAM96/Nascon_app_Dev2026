-- Sideline schema. Sport rules live in sports.config (jsonb); no sport-specific columns.

CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  logo_url        text,
  primary_color   text NOT NULL,
  secondary_color text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id        text PRIMARY KEY,
  email     text NOT NULL UNIQUE,
  password  text NOT NULL,
  role      text NOT NULL CHECK (role IN ('super_admin', 'league_organizer', 'club_manager', 'player', 'viewer')),
  tenant_id text,
  league_id text,
  club_id   text,
  player_id text
);

CREATE TABLE IF NOT EXISTS sports (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  scoring_model text NOT NULL CHECK (scoring_model IN ('event', 'innings', 'round')),
  config        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL,
  name       text NOT NULL,
  home_venue jsonb NOT NULL DEFAULT '{}'::jsonb,
  social     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS leagues (
  id                  text PRIMARY KEY,
  tenant_id           text,
  sport_id            text NOT NULL,
  name                text,
  points              jsonb NOT NULL DEFAULT '{"win":3,"draw":1,"loss":0}'::jsonb,
  tie_break_order     jsonb,
  qualification_spots int,
  lots_seed           int,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league_teams (
  league_id text NOT NULL,
  team_id   text NOT NULL,
  position  int NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id           text PRIMARY KEY,
  league_id    text,
  sport_id     text NOT NULL,
  home_team_id text NOT NULL,
  away_team_id text NOT NULL,
  status       text NOT NULL DEFAULT 'upcoming',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Append-only event log; scores are always rebuilt from these rows.
CREATE TABLE IF NOT EXISTS match_events (
  id           text PRIMARY KEY,
  match_id     text NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  sequence     int NOT NULL,
  signature    text NOT NULL,
  request_hash text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, sequence)
);
CREATE INDEX IF NOT EXISTS match_events_match_id_idx ON match_events (match_id);

CREATE TABLE IF NOT EXISTS products (
  id        text PRIMARY KEY,
  tenant_id text NOT NULL,
  club_id   text,
  name      text NOT NULL,
  kind      text NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
  id          text PRIMARY KEY,
  product_id  text NOT NULL,
  size        text,
  color       text,
  price_minor int NOT NULL,
  currency    text NOT NULL DEFAULT 'PKR',
  stock       int NOT NULL CHECK (stock >= 0),
  reserved    int NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);

CREATE TABLE IF NOT EXISTS discount_codes (
  code    text PRIMARY KEY,
  percent int NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id           text PRIMARY KEY,
  customer_id  text NOT NULL,
  status       text NOT NULL,
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_id_idx ON orders (id);

CREATE TABLE IF NOT EXISTS roster_leagues (
  id        text PRIMARY KEY,
  tenant_id text NOT NULL,
  sport_id  text NOT NULL,
  config    jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS squads (
  id               text PRIMARY KEY,
  roster_league_id text,
  club_id          text,
  tenant_id        text NOT NULL,
  name             text
);

CREATE TABLE IF NOT EXISTS players (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  position text,
  club_id  text
);

CREATE TABLE IF NOT EXISTS registrations (
  id                text PRIMARY KEY,
  player_id         text NOT NULL,
  roster_league_id  text NOT NULL,
  squad_id          text,
  parent_squad_id   text,
  registration_type text NOT NULL,
  role              text,
  start_date        date,
  loan_end_date     date
);
CREATE INDEX IF NOT EXISTS registrations_player_id_idx ON registrations (player_id);

CREATE TABLE IF NOT EXISTS roster_audit (
  id               text PRIMARY KEY,
  seq              bigserial,
  player_id        text NOT NULL,
  roster_league_id text NOT NULL,
  action           text NOT NULL,
  from_squad_id    text,
  to_squad_id      text,
  effective_date   date,
  state            text,
  who              text,
  why              text,
  at               timestamptz NOT NULL DEFAULT now(),
  payload          jsonb
);

CREATE TABLE IF NOT EXISTS roster_requests (
  request_id   text PRIMARY KEY,
  request_hash text NOT NULL,
  response     jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS offline_actions (
  device_id text NOT NULL,
  action_id text NOT NULL,
  result    jsonb NOT NULL,
  PRIMARY KEY (device_id, action_id)
);

CREATE TABLE IF NOT EXISTS qr_links (
  entity_id   text PRIMARY KEY,
  entity_type text NOT NULL,
  short_url   text NOT NULL,
  scan_count  int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS guest_merge_requests (
  token         text PRIMARY KEY,
  request_hash  text NOT NULL,
  response      jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_tokens (
  token  text PRIMARY KEY,
  merged boolean NOT NULL DEFAULT false,
  role   text NOT NULL
);

CREATE TABLE IF NOT EXISTS carts (
  user_id text PRIMARY KEY,
  items   jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_dlq (
  id            text PRIMARY KEY,
  chat_room_id  text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_dlq_room_idx ON moderation_dlq (chat_room_id, created_at);

CREATE TABLE IF NOT EXISTS stream_keys (
  stream_key text PRIMARY KEY,
  player_id  text NOT NULL,
  label      text NOT NULL DEFAULT 'default',
  status     text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stream_keys_active_slot_idx ON stream_keys (player_id, label) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS costream_sessions (
  session_id   text PRIMARY KEY,
  request_hash text NOT NULL,
  response     jsonb NOT NULL
);
