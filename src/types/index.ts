export interface FileEntry {
  name: string;
  mtime: string;
  ctime?: string;
  size: number;
}

export interface FileListResponse {
  files: FileEntry[];
}

export type RevisionStatus = 'accepted' | 'rejected' | 'needs-review';

// Per-file UI/API revision metadata
export interface Revision {
  id: string;
  createdAt: string;
  content: string;
  note: string;
  tags?: string[];
  status?: RevisionStatus;
}

export interface FileContentResponse {
  name: string;
  content: string;
  revisions: Revision[];
  revisionId?: string | null;
  currentDraftRevisionId?: string | null;
}

export interface SaveFileRequest {
  content: string;
  note?: string;
  tags?: string[];
  status?: RevisionStatus;
  revisionId?: string | null;
  currentDraftRevisionId?: string | null;
}

export interface RevisionNote {
  id: string;
  message: string;
  createdAt: string;
}

export interface RevisionPresence {
  userId: string;
  displayName: string;
  startedAt: string;
  lastSeenAt: string;
}

export interface RevisionLock {
  userId: string;
  displayName: string;
  reason?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface RevisionComment {
  id: string;
  authorId: string;
  authorName: string;
  message: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ReviewRequest {
  id: string;
  requestedById: string;
  requestedByName: string;
  reviewerId: string;
  reviewerName: string;
  message?: string;
  status: 'pending' | 'approved' | 'changes-requested';
  createdAt: string;
  respondedAt?: string;
}

export interface RevisionMention {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  toUserId: string;
  message: string;
  createdAt: string;
}

export interface RevisionNotification {
  id: string;
  userId: string;
  type: 'mention' | 'review-request' | 'comment';
  message: string;
  createdAt: string;
  readAt?: string;
}

export interface RevisionAuditEvent {
  id: string;
  actorId: string;
  actorName: string;
  action:
    | 'revision-created'
    | 'presence-updated'
    | 'lock-acquired'
    | 'lock-released'
    | 'comment-added'
    | 'review-requested'
    | 'mention-added'
    | 'notification-read';
  targetId?: string;
  targetType?: 'comment' | 'review-request' | 'mention' | 'notification' | 'lock';
  createdAt: string;
  metadata?: Record<string, string>;
}

export interface CollaborationState {
  presence: RevisionPresence[];
  lock: RevisionLock | null;
  comments: RevisionComment[];
  reviewRequests: ReviewRequest[];
  mentions: RevisionMention[];
  notifications: RevisionNotification[];
  auditTrail: RevisionAuditEvent[];
}

export interface Document {
  id: string;
  name: string;
  createdAt: string;
  sourceFilename?: string;
}

// Immutable document revisions for /documents endpoints
export interface DocumentRevision {
  id: string;
  documentId: string;
  createdAt: string;
  content: string;
  notes: RevisionNote[];
  collaboration: CollaborationState;
}

export interface CreateDocumentInput {
  id: string;
  name: string;
  sourceFilename?: string;
  createdAt?: string;
}

export interface CreateRevisionInput {
  content: string;
  createdAt?: string;
  notes?: RevisionNote[];
  collaboration?: Partial<CollaborationState>;
}

export interface ApiError {
  error: string;
}

export interface RevisionEntry {
  id: string;
  createdAt: string;
  size: number;
}

export interface FileRevisionsResponse {
  name: string;
  currentDraftRevisionId: string | null;
  revisions: RevisionEntry[];
}
