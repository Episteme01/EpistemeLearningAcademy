import { auth } from '@/config/firebase';
import { filesGatewayUrl } from '@/config/env';

export type RecordKind = 'student' | 'parent' | 'staff' | 'invoice';
export interface Dep { key: string; label: string; count: number; blocking?: boolean; note?: string }
export interface DeleteCheck { kind: RecordKind; id: string; label: string; deps: Dep[]; hasLogin: boolean; blocked: boolean }
export interface DeleteResult { ok: true; label: string; login: string; archiveId: string }

/** Address of the `records` function (same Supabase project as the file service). */
export const recordsUrl = filesGatewayUrl.includes('/functions/v1/') ? `${filesGatewayUrl.split('/functions/v1/')[0]}/functions/v1/records` : '';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!recordsUrl) throw new Error('The record-management service is not switched on yet. See docs/PHASE6_DELETION_AND_PDF.md.');
  const u = auth().currentUser;
  if (!u) throw new Error('Sign in to continue.');
  let r: Response;
  try { r = await fetch(recordsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify(body) }); }
  catch { throw new Error('Could not reach the record service. Check that the function named "records" is deployed (Verify JWT off).'); }
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new Error(data.error || `Record service error (${r.status}).`);
  return data;
}

export const checkDelete = (kind: RecordKind, id: string) => call<DeleteCheck>({ action: 'check', kind, id });
export const deleteRecord = (kind: RecordKind, id: string, opts: { deleteLogin: boolean; confirm: string }) => call<DeleteResult>({ action: 'delete', kind, id, ...opts });
