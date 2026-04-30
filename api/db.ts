import sql from 'mssql';

const instance = process.env.MSSQL_INSTANCE;

const config: sql.config = {
  server: process.env.MSSQL_HOST ?? 'localhost',
  // Named instance: omit port and let mssql resolve via SQL Browser service
  ...(instance ? {} : { port: Number(process.env.MSSQL_PORT ?? 1433) }),
  database: process.env.MSSQL_DB ?? 'DB_PLC_RABAR',
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  options: {
    trustServerCertificate: true,
    encrypt: false,
    ...(instance ? { instanceName: instance } : {}),
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = await new sql.ConnectionPool(config).connect();
    pool.on('error', () => { pool = null; });
  }
  return pool;
}
