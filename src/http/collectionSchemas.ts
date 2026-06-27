import { z } from "zod";

export const collectionCreateSchema = z.object({
  displayName: z.string().trim().min(1),
  description: z.string().optional(),
  sourcePath: z.string().trim().min(1).optional(),
  ozelgeDataPath: z.string().trim().min(1).optional(),
  distanceMetric: z.enum(["l2", "cosine", "ip"]).optional(),
  chunkSize: z.number().int().positive().optional(),
  chunkOverlap: z.number().int().nonnegative().optional(),
  retrievalK: z.number().int().positive().optional(),
  retrievalDistanceThreshold: z.number().nonnegative().optional(),
  embeddingModel: z.string().trim().min(1).optional(),
  chatModel: z.string().trim().min(1).optional(),
}).strict();

export const collectionUpdateSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  sourcePath: z.string().trim().min(1).optional(),
  ozelgeDataPath: z.string().trim().min(1).optional(),
  distanceMetric: z.enum(["l2", "cosine", "ip"]).optional(),
  chunkSize: z.number().int().positive().optional(),
  chunkOverlap: z.number().int().nonnegative().optional(),
  retrievalK: z.number().int().positive().optional(),
  retrievalDistanceThreshold: z.number().nonnegative().optional(),
  embeddingModel: z.string().trim().min(1).optional(),
  chatModel: z.string().trim().min(1).optional(),
}).strict();

