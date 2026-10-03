// libpq treats PGDATABASE as a literal database name, not as a connection URI.
// Keep credentials out of command arguments and child output.
export function postgresEnv(connection: string): NodeJS.ProcessEnv {
  const url = new URL(connection);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10",
  };
  for (const [parameter, variable] of Object.entries({
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    options: "PGOPTIONS",
  })) {
    if (url.searchParams.has(parameter))
      env[variable] = url.searchParams.get(parameter)!;
  }
  return env;
}
