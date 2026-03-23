import { z } from 'zod';
import { ValidationError } from '../errors';

const pageCursorPayloadSchema = z.object({
  limit: z.number().int().positive().max(100),
  offset: z.number().int().nonnegative(),
});

export interface CursorPageInput {
  total: number;
  limit: number;
  offset: number;
}

export interface CursorPageEnvelope extends CursorPageInput {
  nextCursor: string | null;
  previousCursor: string | null;
}

export function encodePageCursor(limit: number, offset: number): string {
  const payload = pageCursorPayloadSchema.parse({
    limit,
    offset,
  });
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodePageCursor(cursor: string): CursorPageInput {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    return pageCursorPayloadSchema.parse(parsed);
  } catch {
    throw new ValidationError('Invalid pagination cursor.');
  }
}

export function buildCursorPageEnvelope(input: CursorPageInput): CursorPageEnvelope {
  const nextOffset = input.offset + input.limit;
  const previousOffset = Math.max(input.offset - input.limit, 0);
  return {
    total: input.total,
    limit: input.limit,
    offset: input.offset,
    nextCursor: nextOffset < input.total ? encodePageCursor(input.limit, nextOffset) : null,
    previousCursor: input.offset > 0 ? encodePageCursor(input.limit, previousOffset) : null,
  };
}
