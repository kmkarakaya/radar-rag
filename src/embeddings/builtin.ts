import fs from "node:fs";
import path from "node:path";
import { Embeddings } from "@langchain/core/embeddings";
import { getBuiltinEmbeddingModelSpec, type BuiltinEmbeddingModelSpec } from "./models.js";

/**
 * In-process embeddings (transformers.js on CPU). The model is downloaded into cacheDir on first use and
 * reused afterwards. LangChain's HuggingFaceTransformersEmbeddings is not used: it is pinned to
 * transformers.js v3 (EmbeddingGemma 2 needs v4), ignores batchSize and has no query/document prefixes.
 */

export type LoadedBuiltinModel = {
  /** Returns one normalized vector per input text. */
  embed(texts: string[]): Promise<number[][]>;
};

export type BuiltinModelLoader = (spec: BuiltinEmbeddingModelSpec, cacheDir: string) => Promise<LoadedBuiltinModel>;

/** Thrown when a built-in model cannot be downloaded or loaded (offline, disk full, corrupted cache...). */
export class BuiltinModelLoadError extends Error {
  constructor(message: string, readonly model: string) {
    super(message);
    this.name = "BuiltinModelLoadError";
  }
}

/** Room left on top of the download itself (temporary files, the runtime's own files). */
const DISK_SPACE_MARGIN_MB = 256;
const MB = 1024 * 1024;

export type StatFs = (dir: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;

/**
 * Throws before a download starts when the disk under cacheDir cannot hold the model. transformers.js crashes
 * the whole process when a cache write fails (unhandled stream error), so a full disk must be caught here.
 * A failing statfs skips the check: the check itself must never block a setup.
 */
export async function assertDiskSpaceForBuiltinModel(
  spec: BuiltinEmbeddingModelSpec,
  cacheDir: string,
  statfs: StatFs = fs.promises.statfs,
): Promise<void> {
  if (isBuiltinModelCached(spec.id, cacheDir)) return;
  // On the first start cacheDir may not exist yet: measure the nearest folder that does.
  let dir = path.resolve(cacheDir);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  let freeMb: number;
  try {
    const stats = await statfs(dir);
    freeMb = Math.floor(Number(BigInt(stats.bavail) * BigInt(stats.bsize) / BigInt(MB)));
  } catch {
    return;
  }
  const neededMb = spec.approxDownloadMb + DISK_SPACE_MARGIN_MB;
  if (freeMb < neededMb) {
    throw new Error(
      `Not enough free disk space to download it: about ${neededMb} MB is needed in ${cacheDir}, ${freeMb} MB is free. Free up disk space, then re-index.`,
    );
  }
}

export const loadBuiltinModelWithTransformers: BuiltinModelLoader = async (spec, cacheDir) => {
  await assertDiskSpaceForBuiltinModel(spec, cacheDir);
  // Imported lazily: the runtime (onnxruntime-node) is only loaded when a built-in model is used.
  const { AutoConfig, AutoModel, AutoTokenizer, env } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;

  const config = await AutoConfig.from_pretrained(spec.id, { cache_dir: cacheDir }) as unknown as Record<string, unknown>;
  // The repository also ships vision and audio encoders; dropping their configs loads only the text model.
  config.vision_config = null;
  config.audio_config = null;

  const tokenizer = await AutoTokenizer.from_pretrained(spec.id, { cache_dir: cacheDir });
  const model = await AutoModel.from_pretrained(spec.id, {
    config: config as never,
    // Always explicit: without a dtype, transformers.js loads full precision on CPU (~1.1 GB).
    dtype: spec.dtype,
    device: "cpu",
    cache_dir: cacheDir,
  });

  return {
    async embed(texts) {
      const inputs = tokenizer(texts, { padding: true, truncation: true });
      const output = await model(inputs) as { sentence_embedding?: { tolist(): number[][] } };
      if (!output.sentence_embedding) {
        throw new Error(`Model ${spec.id} did not return a sentence_embedding output.`);
      }
      return output.sentence_embedding.tolist();
    },
  };
};

/** Scales a vector to unit length, so distances do not depend on how the model scaled its output. */
export function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

/** One load per model and cache folder; concurrent requests wait for the same download. */
const loadedModels = new Map<string, Promise<LoadedBuiltinModel>>();

export function clearLoadedBuiltinModels(): void {
  loadedModels.clear();
}

function loadOnce(spec: BuiltinEmbeddingModelSpec, cacheDir: string, loader: BuiltinModelLoader): Promise<LoadedBuiltinModel> {
  const key = `${cacheDir}|${spec.id}`;
  let pending = loadedModels.get(key);
  if (!pending) {
    pending = loader(spec, cacheDir).catch((error: unknown) => {
      loadedModels.delete(key); // allow a retry after a failed download
      const message = error instanceof Error ? error.message : String(error);
      throw new BuiltinModelLoadError(`Built-in embedding model ${spec.id} could not be loaded: ${message}`, spec.id);
    });
    loadedModels.set(key, pending);
  }
  return pending;
}

/** True when every file the model needs is already in the cache, so no download will happen. */
export function isBuiltinModelCached(model: string, cacheDir: string): boolean {
  const spec = getBuiltinEmbeddingModelSpec(model);
  if (!spec) return false;
  const modelDir = path.join(cacheDir, ...spec.id.split("/"));
  return spec.requiredFiles.every((file) => fs.existsSync(path.join(modelDir, file)));
}

export class BuiltinEmbeddings extends Embeddings {
  private readonly spec: BuiltinEmbeddingModelSpec;
  private readonly cacheDir: string;
  private readonly loader: BuiltinModelLoader;
  private readonly batchSize: number;

  constructor(fields: { model: string; cacheDir: string; loader?: BuiltinModelLoader; batchSize?: number }) {
    super({});
    const spec = getBuiltinEmbeddingModelSpec(fields.model);
    if (!spec) {
      throw new BuiltinModelLoadError(`${fields.model} is not a supported built-in embedding model.`, fields.model);
    }
    this.spec = spec;
    this.cacheDir = fields.cacheDir;
    this.loader = fields.loader ?? loadBuiltinModelWithTransformers;
    // Small sequential batches keep memory bounded (padding grows with the longest text in a batch).
    this.batchSize = fields.batchSize ?? 16;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const model = await loadOnce(this.spec, this.cacheDir, this.loader);
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts.slice(start, start + this.batchSize).map((text) => `${this.spec.documentPrefix}${text}`);
      vectors.push(...(await model.embed(batch)).map(normalizeVector));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const model = await loadOnce(this.spec, this.cacheDir, this.loader);
    const [vector] = await model.embed([`${this.spec.queryPrefix}${text}`]);
    return normalizeVector(vector);
  }
}
