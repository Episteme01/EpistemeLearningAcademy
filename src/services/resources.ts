import { serverTimestamp } from 'firebase/firestore';
import { C } from '@/config/collections';
import { createDoc, patchDoc, removeDoc } from './db';
import { deleteStored } from './storage';
import { audit } from './audit';
import { normaliseTags } from '@/lib/resources';
import type { Resource, WithId } from '@/types/models';

export type ResourceInput = Omit<Resource, 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt' | 'tags'> & { tags: string | string[] };
export interface Actor { uid: string; name: string }

export function validateResource(r: ResourceInput): string | null {
  if (!r.title.trim()) return 'Give the resource a title.';
  if (!r.url.trim()) return 'Choose a file, pick one from the library, or paste a link.';
  if (!/^https:\/\//i.test(r.url.trim())) return 'Links must start with https://';
  if (!r.visibleTo.length) return 'Choose who can see this resource.';
  return null;
}

const body = (r: ResourceInput) => ({ ...r, title: r.title.trim(), description: r.description?.trim() ?? '', url: r.url.trim(), tags: normaliseTags(r.tags), subject: r.subject?.trim() ?? '' });

export async function createResource(r: ResourceInput, by: Actor): Promise<string> {
  const err = validateResource(r); if (err) throw new Error(err);
  const id = await createDoc(C.resources, { ...body(r), createdBy: by.uid, createdByName: by.name, createdAt: serverTimestamp() });
  void audit('resource.create', id, r.title);
  return id;
}

export async function updateResource(id: string, r: ResourceInput): Promise<void> {
  const err = validateResource(r); if (err) throw new Error(err);
  await patchDoc(C.resources, id, body(r));
  void audit('resource.update', id, r.title);
}

export const setPublished = async (r: WithId<Resource>, published: boolean) => { await patchDoc(C.resources, r.id, { published }); void audit(published ? 'resource.publish' : 'resource.unpublish', r.id, r.title); };

/** Deletes the record, then its uploaded file (files picked from the shared library are never deleted here). */
export async function deleteResource(r: WithId<Resource>): Promise<void> {
  await removeDoc(C.resources, r.id);
  if (r.storagePath?.startsWith('lms/')) await deleteStored(r.storagePath);
  void audit('resource.delete', r.id, r.title);
}
