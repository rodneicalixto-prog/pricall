-- PRICALL — Row Level Security (isolamento multiempresa no banco).
--
-- Aplique este arquivo DEPOIS das migrações, em ambientes Postgres/Supabase:
--   psql "$DATABASE_URL" -f drizzle/policies.sql
--
-- Modelo: a aplicação abre a transação e declara o tenant corrente com
--   SELECT set_config('app.current_organization_id', '<uuid>', true);
--   SELECT set_config('app.current_user_id',         '<uuid>', true);
-- (ver `withTenant()` em src/db/tenant.ts). Toda leitura/escrita fica
-- restrita àquela organização, mesmo que uma consulta esqueça o filtro.
--
-- O papel usado pelas migrações/seed deve ter BYPASSRLS (ou ser o owner);
-- o papel da aplicação NÃO deve ter.

create or replace function app_current_organization_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_organization_id', true), '')::uuid
$$;

create or replace function app_current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Tabelas com coluna organization_id NOT NULL -> política simétrica.
do $$
declare
  t text;
  tenant_tables text[] := array[
    'users', 'sessions', 'invitations', 'teams', 'team_members',
    'whatsapp_connections', 'contacts', 'contact_consents', 'conversations',
    'messages', 'tags', 'conversation_tags', 'quick_replies',
    'scheduled_followups', 'calendar_events', 'kanban_boards',
    'kanban_columns', 'kanban_cards', 'notifications', 'assignment_rules',
    'assignment_cursors', 'conversation_events', 'conversation_viewers'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (organization_id = app_current_organization_id())
        with check (organization_id = app_current_organization_id())
    $f$, t);
  end loop;
end $$;

-- Tabelas em que organization_id é opcional (eventos de plataforma).
do $$
declare
  t text;
  nullable_tables text[] := array['audit_logs', 'integration_events'];
begin
  foreach t in array nullable_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (
          organization_id is null
          or organization_id = app_current_organization_id()
        )
        with check (
          organization_id is null
          or organization_id = app_current_organization_id()
        )
    $f$, t);
  end loop;
end $$;

-- A organização só enxerga a si mesma.
alter table organizations enable row level security;
alter table organizations force row level security;
drop policy if exists tenant_isolation on organizations;
create policy tenant_isolation on organizations
  using (id = app_current_organization_id())
  with check (id = app_current_organization_id());

-- Tabelas de autenticação anteriores à sessão (login/recuperação de senha)
-- não têm tenant: o acesso é feito por um papel de serviço restrito.
alter table login_attempts enable row level security;
drop policy if exists service_only on login_attempts;
create policy service_only on login_attempts using (true) with check (true);

alter table password_reset_tokens enable row level security;
drop policy if exists service_only on password_reset_tokens;
create policy service_only on password_reset_tokens using (true) with check (true);
