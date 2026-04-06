import { RevisionStatus } from '@/types';

export type RewriteMode = 'clarify' | 'shorten' | 'formalize';

export type AssistAction = 'rewrite' | 'delta' | 'metadata' | 'review';

export interface ReviewFinding {
  level: 'info' | 'warn';
  message: string;
}

export interface MetadataSuggestion {
  title: string;
  tags: string[];
  status: RevisionStatus | '';
}

export interface RewriteAssistRequest {
  action: 'rewrite';
  mode: RewriteMode;
  selection: string;
}

export interface DeltaAssistRequest {
  action: 'delta';
  previousContent: string;
  currentContent: string;
}

export interface MetadataAssistRequest {
  action: 'metadata';
  content: string;
}

export interface ReviewAssistRequest {
  action: 'review';
  content: string;
}

export type AssistRequest = RewriteAssistRequest | DeltaAssistRequest | MetadataAssistRequest | ReviewAssistRequest;

export interface RewriteAssistResponse {
  rewritten: string;
}

export interface DeltaAssistResponse {
  summary: string;
}

export interface MetadataAssistResponse extends MetadataSuggestion {}

export interface ReviewAssistResponse {
  findings: ReviewFinding[];
}

export type AssistResponse = RewriteAssistResponse | DeltaAssistResponse | MetadataAssistResponse | ReviewAssistResponse;
