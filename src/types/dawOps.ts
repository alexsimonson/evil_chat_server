/**
 * Server-side operation validation schemas (mirrors client-side)
 */

import { z } from 'zod';

// We'll import this if zod is installed on server; if not, we need to install it
// For now, create the schemas similar to client but in pure TypeScript

export const DawOpSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  timestamp: z.number(),
  baseVersion: z.number(),
  type: z.string(),
  // Additional fields depend on type - validated in detail on client
  // For server, we just ensure required base fields + type exist
}).passthrough();

export const SubmitOpsRequestSchema = z.object({
  baseVersion: z.number(),
  ops: z.array(DawOpSchema),
});

export type SubmitOpsRequest = z.infer<typeof SubmitOpsRequestSchema>;
