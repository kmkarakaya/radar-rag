# Vanilla RAG backend image. Used by docker-compose.yml together with Chroma.
# Must stay glibc-based (Debian): onnxruntime-node, used by the built-in embedding model, has no musl/Alpine build.

# ---- build: compile TypeScript and install production dependencies ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 is a native module; build tools are only needed if no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# onnxruntime-node would otherwise download CUDA/TensorRT libraries on linux-x64; the built-in model runs on CPU.
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# onnxruntime-node ships native binaries for every OS and CPU (~220 MB we never load here); keep only
# the Linux build for this image's architecture.
RUN set -e; \
  ort=node_modules/onnxruntime-node/bin; \
  case "$(uname -m)" in x86_64) keep=x64 ;; aarch64) keep=arm64 ;; *) keep= ;; esac; \
  rm -rf "$ort"/napi-v*/darwin "$ort"/napi-v*/win32; \
  if [ -n "$keep" ]; then \
    for dir in "$ort"/napi-v*/linux/*; do [ "$(basename "$dir")" = "$keep" ] || rm -rf "$dir"; done; \
  fi

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config/rag.config.yaml ./config/rag.config.yaml
COPY admin ./admin
COPY test_frontend ./test_frontend

# data/ (your documents + the SQLite registry) and models/ (built-in embedding models, downloaded on
# first use) are mounted at runtime; see docker-compose.yml.
RUN mkdir -p data models .local

# NODE_ENV is intentionally not set to "production": that marks the admin session cookie as
# Secure, which breaks admin login over plain HTTP. Set NODE_ENV=production behind HTTPS.
EXPOSE 3010
CMD ["node", "dist/server.js"]
