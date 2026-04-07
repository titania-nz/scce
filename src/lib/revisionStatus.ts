import { RevisionStatus } from '@/types';

export const REVISION_STATUSES: RevisionStatus[] = ['Writing', 'Editing', 'Locked'];

export function isRevisionStatus(value: unknown): value is RevisionStatus {
  return typeof value === 'string' && REVISION_STATUSES.includes(value as RevisionStatus);
}
