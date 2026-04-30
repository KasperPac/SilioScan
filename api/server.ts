// api/server.ts — REST API wrapping DB_PLC_RABAR stored procedures for the handtip workflow
//
// Run: npx ts-node --project tsconfig.node.json api/server.ts
//
// Env vars: MSSQL_HOST, MSSQL_PORT, MSSQL_USER, MSSQL_PASSWORD, MSSQL_DB, API_PORT

import express, { NextFunction, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from './db';

const HANDTIP_ROOM = 4;
const PORT = Number(process.env.API_PORT ?? 3000);

const app = express();
app.use(express.json());

// ── helpers ──────────────────────────────────────────────────────

// SelectOrder_SP_V1 and UpdateOrder* SPs return {mensaje: '...'} on error
// and {mensaje: 'DONE'} or real data rows on success.
function spErr(rows: sql.IRecordSet<Record<string, unknown>>): string | null {
  if (rows.length === 1 && typeof rows[0].mensaje === 'string' && rows[0].mensaje !== 'DONE') {
    return rows[0].mensaje;
  }
  return null;
}

// Wrap async route handlers so unhandled rejections go to the error middleware.
function h(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

// ── GET / ────────────────────────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', db: process.env.MSSQL_DB ?? 'DB_PLC_RABAR' });
});

// ── GET /batches ─────────────────────────────────────────────────

app.get('/batches', h(async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query<{
    id: number; batch: number; code: string; description: string;
    required_date_formatted: string; order_date_formatted: string;
    handtip_complete: boolean;
  }>(`
    SELECT id, batch, code, description, required_date_formatted, order_date_formatted,
           handtip_complete
    FROM dbo.orders
    WHERE complete = 0
    ORDER BY required_date_raw ASC
  `);
  res.json(result.recordset);
}));

// ── GET /batches/:batch ──────────────────────────────────────────

app.get('/batches/:batch', h(async (req, res) => {
  const batch = parseInt(req.params.batch as string, 10);
  if (isNaN(batch)) { res.status(400).json({ error: 'invalid batch' }); return; }

  const pool = await getPool();

  const [orderRes, linesRes, ginRes] = await Promise.all([
    pool.request()
      .input('Inbatch', sql.Int, batch)
      .input('InN_OrderTableToSelect', sql.Int, 1)
      .execute('dbo.SelectOrder_SP_V1'),
    pool.request()
      .input('Inbatch', sql.Int, batch)
      .input('InN_OrderTableToSelect', sql.Int, 2)
      .execute('dbo.SelectOrder_SP_V1'),
    pool.request()
      .input('Inbatch', sql.Int, batch)
      .input('InN_OrderTableToSelect', sql.Int, 3)
      .execute('dbo.SelectOrder_SP_V1'),
  ]);

  const orderErr = spErr(orderRes.recordset);
  if (orderErr) { res.status(404).json({ error: orderErr }); return; }

  res.json({
    order: orderRes.recordset[0] ?? null,
    ingredients: linesRes.recordset.filter((r: Record<string, unknown>) => r.Room === HANDTIP_ROOM),
    gins: ginRes.recordset,
  });
}));

// ── GET /users/lookup?code=<int> ─────────────────────────────────

app.get('/users/lookup', h(async (req, res) => {
  const code = parseInt(req.query.code as string, 10);
  if (isNaN(code)) {
    res.status(400).json({ error: 'code query param required (integer)' });
    return;
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('user_code', sql.Int, code)
    .query<{ user_code: number; user_level: number; user_name: string; payroll: string }>(
      'SELECT user_code, user_level, user_name, payroll FROM dbo.rabar_user WHERE user_code = @user_code',
    );

  if (result.recordset.length === 0) { res.status(404).json({ error: 'user not found' }); return; }
  res.json(result.recordset[0]);
}));

// ── POST /batches/:batch/gins ────────────────────────────────────

app.post('/batches/:batch/gins', h(async (req, res) => {
  const batch = parseInt(req.params.batch as string, 10);
  const { indexNumber, ingredientIndex, gin, bagsAdded } = req.body as {
    indexNumber: number; ingredientIndex: number; gin: string; bagsAdded?: number;
  };

  if (isNaN(batch) || indexNumber == null || ingredientIndex == null || !gin) {
    res.status(400).json({ error: 'indexNumber, ingredientIndex, gin required' }); return;
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('Batch', sql.Int, batch)
    .input('Room', sql.Int, HANDTIP_ROOM)
    .input('IndexNumber', sql.Int, indexNumber)
    .input('Ingredient_index', sql.Int, ingredientIndex)
    .input('gin', sql.VarChar(20), gin)
    .input('gin_used', sql.Bit, 1)
    .input('bags_added', sql.Int, bagsAdded ?? 0)
    .execute('dbo.UpdateOrderLinesGinTable_SP_V1');

  res.json(result.recordset[0]);
}));

// ── POST /batches/:batch/ingredients/complete ────────────────────

app.post('/batches/:batch/ingredients/complete', h(async (req, res) => {
  const batch = parseInt(req.params.batch as string, 10);
  const { indexNumber } = req.body as { indexNumber: number };

  if (isNaN(batch) || indexNumber == null) {
    res.status(400).json({ error: 'indexNumber required' }); return;
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('Batch', sql.Int, batch)
    .input('Room', sql.Int, HANDTIP_ROOM)
    .input('IndexNumber', sql.Int, indexNumber)
    .input('complete', sql.Bit, 1)
    .execute('dbo.UpdateOrderLinesTable_SP_V1');

  const err = spErr(result.recordset);
  if (err) { res.status(400).json({ error: err }); return; }
  res.json(result.recordset[0]);
}));

// ── POST /batches/:batch/signoff ─────────────────────────────────

app.post('/batches/:batch/signoff', h(async (req, res) => {
  const batch = parseInt(req.params.batch as string, 10);
  const { userCode, userLevel, userName } = req.body as {
    userCode: number; userLevel: number; userName: string;
  };

  if (isNaN(batch) || userCode == null || !userName) {
    res.status(400).json({ error: 'userCode, userName required' }); return;
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('Batch', sql.Int, batch)
    .input('handtip_complete', sql.Bit, 1)
    .input('usr_signoff_code', sql.Int, userCode)
    .input('usr_signoff_level', sql.Int, userLevel ?? 0)
    .input('usr_signoff_name', sql.VarChar(100), userName)
    .execute('dbo.UpdateOrdersTable_SP_V1');

  const err = spErr(result.recordset);
  if (err) { res.status(400).json({ error: err }); return; }
  res.json(result.recordset[0]);
}));

// ── error middleware ─────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[api error]', message);
  res.status(500).json({ error: message });
});

// ── startup ──────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`[api] Listening on port ${PORT}`);
    console.log(`[api] DB: ${process.env.MSSQL_HOST ?? 'localhost'}/${process.env.MSSQL_DB ?? 'DB_PLC_RABAR'}`);
    console.log('='.repeat(50));
  });
}

export default app;
