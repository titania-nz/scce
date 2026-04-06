import { NextRequest, NextResponse } from 'next/server';
import {
  AssistRequest,
  DeltaAssistResponse,
  MetadataAssistResponse,
  ReviewAssistResponse,
  RewriteAssistResponse,
} from '@/lib/aiAssist';

type OpenAIResponsePayload = {
  output_text?: string;
};

function parseJsonObject<T>(raw: string): T {
  const trimmed = raw.trim();
  const match = trimmed.match(/\{[\s\S]*\}$/);
  const candidate = match ? match[0] : trimmed;
  return JSON.parse(candidate) as T;
}

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('OPENAI_API_KEY is not configured'), { status: 503 });
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content:
            'You are an editing assistant for markdown notes. Return only valid JSON matching the requested schema. No markdown fences.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw Object.assign(new Error(`OpenAI request failed: ${details || response.statusText}`), { status: 502 });
  }

  const payload = (await response.json()) as OpenAIResponsePayload;
  const output = payload.output_text?.trim();
  if (!output) {
    throw Object.assign(new Error('OpenAI returned empty output'), { status: 502 });
  }
  return output;
}

function rewritePrompt(mode: string, selection: string): string {
  return [
    `Task: rewrite selected text in "${mode}" mode.`,
    'Return JSON: {"rewritten":"..."}',
    'Preserve markdown formatting when possible.',
    `Selection:\n${selection}`,
  ].join('\n');
}

function deltaPrompt(previousContent: string, currentContent: string): string {
  return [
    'Task: summarize what changed between previous and current markdown revisions.',
    'Focus on the most meaningful deltas in 1-3 concise sentences.',
    'Return JSON: {"summary":"..."}',
    `Previous:\n${previousContent}`,
    `Current:\n${currentContent}`,
  ].join('\n');
}

function metadataPrompt(content: string): string {
  return [
    'Task: suggest metadata for this markdown note.',
    'Return JSON: {"title":"...","tags":["..."],"status":"accepted|rejected|needs-review|"}',
    'Use short practical tags (max 5).',
    `Content:\n${content}`,
  ].join('\n');
}

function reviewPrompt(content: string): string {
  return [
    'Task: review the markdown for clarity and completeness.',
    'Find ambiguity, passive voice, and missing sections.',
    'Return JSON: {"findings":[{"level":"info|warn","message":"..."}]}',
    `Content:\n${content}`,
  ].join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AssistRequest;
    if (!body || typeof body !== 'object' || !('action' in body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (body.action === 'rewrite') {
      if (typeof body.selection !== 'string' || !body.selection.trim()) {
        return NextResponse.json({ error: 'Selection is required' }, { status: 400 });
      }
      const raw = await callOpenAI(rewritePrompt(body.mode, body.selection));
      const parsed = parseJsonObject<RewriteAssistResponse>(raw);
      return NextResponse.json(parsed);
    }

    if (body.action === 'delta') {
      if (typeof body.previousContent !== 'string' || typeof body.currentContent !== 'string') {
        return NextResponse.json({ error: 'Invalid delta payload' }, { status: 400 });
      }
      const raw = await callOpenAI(deltaPrompt(body.previousContent, body.currentContent));
      const parsed = parseJsonObject<DeltaAssistResponse>(raw);
      return NextResponse.json(parsed);
    }

    if (body.action === 'metadata') {
      if (typeof body.content !== 'string') {
        return NextResponse.json({ error: 'Content is required' }, { status: 400 });
      }
      const raw = await callOpenAI(metadataPrompt(body.content));
      const parsed = parseJsonObject<MetadataAssistResponse>(raw);
      return NextResponse.json(parsed);
    }

    if (body.action === 'review') {
      if (typeof body.content !== 'string') {
        return NextResponse.json({ error: 'Content is required' }, { status: 400 });
      }
      const raw = await callOpenAI(reviewPrompt(body.content));
      const parsed = parseJsonObject<ReviewAssistResponse>(raw);
      return NextResponse.json(parsed);
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    const e = error as { status?: number; message?: string };
    return NextResponse.json({ error: e.message ?? 'Could not process AI assist request' }, { status: e.status ?? 500 });
  }
}
