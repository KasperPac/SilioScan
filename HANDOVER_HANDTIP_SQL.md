# Handtip SQL Handover

## Scope

This branch is for the `handtip` workflow only.

The PLC is still in use for the other production areas:

- `micro1`
- `micro2`
- `bulk`

For `handtip`, the app should stop treating the PLC as the source of batch data. Instead, it should use the existing SQL Server schema and stored procedures already present in `sql/script.sql`.

## What is already visible in the SQL export

The SQL export is at [`sql/script.sql`](./sql/script.sql).

Relevant tables:

- `dbo.orders`
- `dbo.order_lines`
- `dbo.order_lines_gin`
- `dbo.rabar_user`
- `dbo.production_schedule`

Relevant stored procedures visible in the export:

- `dbo.SelectOrder_SP_V1`
- `dbo.UpdateOrderLinesB_Table_SP_V1`
- `dbo.UpdateOrderLinesGinTable_SP_V1`
- `dbo.UpdateOrderLinesTable_SP_V1`
- `dbo.UpdateOrderLinesTableSingle_SP_V1`
- `dbo.UpdateOrdersTable_SP_V1`

The most important handtip behavior is already in `dbo.UpdateOrdersTable_SP_V1`:

- when `@Room = 4`, it marks `handtip_complete`
- it stores `UserT_ID_HandTip`
- it stores `DateTimeUT_ID_HandTip`
- it then calls the downstream procedures already used by the legacy system

## Current app behavior

The React Native app currently behaves like a PLC-driven picking client:

- it connects to the PLC on startup
- it waits for a PLC-pushed batch recipe
- it scans GINs and sends them back to the PLC for validation
- it uses NFC to sign off the ingredient

That flow is implemented in:

- [`App.tsx`](./App.tsx)
- [`src/screens/PickingScreen.tsx`](./src/screens/PickingScreen.tsx)
- [`src/services/PlcService.ts`](./src/services/PlcService.ts)
- [`src/services/ProtocolCodec.ts`](./src/services/ProtocolCodec.ts)
- [`src/store/batchStore.ts`](./src/store/batchStore.ts)
- [`src/store/pickingStore.ts`](./src/store/pickingStore.ts)

## What needs to change for handtip

The app should be rewired so that `handtip` batch selection and recipe loading come from SQL, not from `BATCH_RECIPE` pushed by the PLC.

The PLC should remain available for the other production areas and should not be removed from the app entirely unless that becomes a separate decision.

Likely changes:

1. Add a SQL-backed data access layer for batch lookup and ingredient loading.
2. Replace the PLC-pushed batch bootstrap with an explicit batch selection flow.
3. Keep the existing scan / validate / bag-count / NFC sign-off workflow for the operator.
4. Map the selected handtip batch to the existing SQL procedures for reading and completion updates.
5. Leave the micro/bulk PLC paths alone.

## Questions that still need an implementation decision

- Which SQL tables or procedures are the authoritative read path for the handtip batch picker?
- Which procedure should the app call to load a selected batch and its ingredient list?
- Which procedure should be used for per-ingredient completion and GIN registration, if any?
- What fields are required to identify the operator for handtip sign-off?
- Should the app query SQL directly, or go through an API that wraps SQL Server?

## Notes

- The current app code is still PLC-centric, so the first refactor will mostly be around data source selection and batch bootstrap.
- The SQL export is large and includes more than just the handtip flow, so the handover should stay focused on the `orders` / `order_lines` / `order_lines_gin` path unless more of the schema becomes relevant.
