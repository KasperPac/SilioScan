import { useSettingsStore } from '../store/settingsStore';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = useSettingsStore.getState().apiBaseUrl;
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((body.error as string) ?? `HTTP ${res.status}`);
  return body as T;
}

// ── Types ────────────────────────────────────────────────────────

export interface BatchSummary {
  id: number;
  batch: number;
  code: string;
  description: string;
  required_date_formatted: string;
  order_date_formatted: string;
}

export interface SqlIngredient {
  id: number;
  index_number: number;
  Room: number;
  code: string;
  descr: string;
  bags_qty_int: number;
  complete: boolean;
  gin_tracked: boolean;
  track_gin: string;
}

export interface SqlGin {
  ingredient_index: number;
  index_number: number;
  gin: string;
  gin_used: boolean;
  bags_added: number;
}

export interface BatchDetail {
  order: { batch: number; code: string; description: string };
  ingredients: SqlIngredient[];
  gins: SqlGin[];
}

export interface RabarUser {
  user_code: number;
  user_level: number;
  user_name: string;
  payroll: string;
}

// ── Service ──────────────────────────────────────────────────────

export const handtipService = {
  getBatches: () =>
    api<BatchSummary[]>('/batches'),

  getBatch: (batch: number) =>
    api<BatchDetail>(`/batches/${batch}`),

  lookupUser: (code: number) =>
    api<RabarUser>(`/users/lookup?code=${code}`),

  recordGin: (batch: number, body: {
    indexNumber: number;
    ingredientIndex: number;
    gin: string;
    bagsAdded: number;
  }) => api<{ action: string }>(`/batches/${batch}/gins`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  markIngredientComplete: (batch: number, indexNumber: number) =>
    api<{ mensaje: string }>(`/batches/${batch}/ingredients/complete`, {
      method: 'POST',
      body: JSON.stringify({ indexNumber }),
    }),

  signoff: (batch: number, body: { userCode: number; userLevel: number; userName: string }) =>
    api<{ mensaje: string }>(`/batches/${batch}/signoff`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ── NFC UID → user_code ──────────────────────────────────────────
// ISO 15693 UIDs are 8 bytes returned as a 16-char hex string.
// Adjust this function to match how the plant's cards are programmed.
export function parseUserCode(uid: string): number {
  // Take the last 4 bytes of the UID as a big-endian integer.
  return parseInt(uid.slice(-8), 16);
}
