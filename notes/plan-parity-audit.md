# Prompt 21 Plan Parity Audit

Tarih: 2026-06-05

Bu not `notes/multicollection.md` Faz 0-6 ve "Test Kabul Kriterleri" maddelerinin mevcut repo durumu ile eslestirilmis audit kaydidir. Status degerleri `PASS`, `PARTIAL`, `FAIL`, `NOT TESTED` olarak tutulur.

## Ozet

- Multiple collection core hedefi: `PASS`
- Public/admin HTTP contract hedefi: `PASS`
- Zero-downtime rebuild ve retention cleanup hedefi: `PASS`
- Operasyonel olgunluk hedefi: `PASS`
- Release gate sonucu: `evet`

Prompt 22 sonrasinda Faz 5 partial maddeleri kapatildi: collection/user/operation bazli request rate limiter, merkezi structured log alani standardi, response/debug seviyesinde latency kontrati ve query path'in Chroma/Ollama timeout/abort hardening davranisi kod, test ve dokumanla hizalandi.

## Faz 0: Davranis Sozlesmesini Netlestir

- `PASS` Eski `/rag/query` ve `/rag/retrieve` endpointleri kaldirildi. Kanit: `test/app.foundation.test.ts`, `test/acceptance/api.endpoints.test.ts`, `test/docs.contract.test.ts`.
- `PASS` Ilk uygulama `tenantId = "default"` ve `userId = "local-dev"` default'lariyla tenant-ready. Kanit: `src/http/requestContext.ts`, `test/app.foundation.test.ts`.
- `PASS` Collection ID format `slug-shortid`. Kanit: `src/collections/ids.ts`, `test/collections.ids.test.ts`.
- `PASS` Physical Chroma collection name Chroma kurallarina gore uretiliyor. Kanit: `src/collections/ids.ts`, `test/collections.ids.test.ts`, `test/chroma.collections.test.ts`.
- `PASS` Registry storage SQLite + `better-sqlite3`; JSON registry yok. Kanit: `package.json`, `src/collections/sqliteRegistry.ts`.
- `PASS` Public path `/v1/...` olarak sabit. Kanit: `src/http/ragRouter.ts`, `src/http/adminRouter.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` `npm run index` registry/job runner akisina bagli ve `--collection-id` zorunlu. Kanit: `src/index.ts`.
- `PASS` Config hedef sekle tasindi; `chroma.collection` yok, `registry.path` ve `collectionDefaults` var. Kanit: `src/config.ts`, `config/rag.config.yaml`, `test/runtime.static.test.ts`.

## Faz 0.5: Test ve Bootstrap Hazirligi

- `PASS` `npm test` script'i var ve unit/acceptance testleri dis servis istemeden kosuyor. Kanit: `package.json`.
- `PASS` Test script'i mevcut ve dis servis istemeyen unit/acceptance suite'i calistiriyor; integration suite ayrica `test:integration` altinda tutuluyor. Bu, Prompt 11 external-service boundary karariyla exact `"test/**/*.test.ts"` pattern'inden daha guvenli bir ayrimdir. Kanit: `package.json`.
- `PASS` Collection ID slug/short-id unit testleri var. Kanit: `test/collections.ids.test.ts`.
- `PASS` Physical name Chroma-safe unit testleri var. Kanit: `test/collections.ids.test.ts`, `test/chroma.collections.test.ts`.
- `PASS` Registry davranisi izole testlerle kapsaniyor; HTTP testleri fake deps/ephemeral SQLite kullaniyor. Kanit: `test/collections.registry.test.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Express app creation ile listen ayrildi. Kanit: `src/app.ts`, `src/server.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Legacy endpointlerin public API'de olmadigi testli. Kanit: `test/app.foundation.test.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` `GET /v1/rag/collections` registry-backed listing testli. Kanit: `test/acceptance/api.endpoints.test.ts`.

## Faz 1: RAG Core'u Collection-Aware Yap

- `PASS` RAG error code'lari collection-aware. Kanit: `src/rag.ts`, `src/http/errors.ts`.
- `PASS` `createVectorStore` explicit `collectionName` aliyor. Kanit: `src/rag.ts`.
- `PASS` `retrieveSources` ve `answerQuestion` options object ile collection/config/context aliyor. Kanit: `src/rag.ts`, `src/http/ragRouter.ts`.
- `PASS` `checkChromaHealth` collection parametresi alabiliyor. Kanit: `src/rag.ts`, `src/app.ts`.
- `PASS` Chroma helper'lari list/count/existence davranisini `listPhysicalChromaCollections` ve `assertChromaCollectionReadable` ile sagliyor; read path'te ayrik isimli helper yerine get/count guard kullaniliyor. Kanit: `src/collections/chromaCollections.ts`, `test/integration/rag.test.ts`.
- `PASS` Missing collection hatalari HTTP 404'e map ediliyor. Kanit: `src/collections/resolveReadableCollection.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Read path'te missing Chroma collection yeni bos collection olusturmuyor. Kanit: `src/rag.ts`, `test/integration/rag.test.ts`.
- `PASS` Physical creation direct ChromaClient ve `configuration.hnsw.space` ile testli. Kanit: `src/collections/chromaCollections.ts`, `test/chroma.collections.test.ts`.

## Faz 2: Collection Registry Ekle

- `PASS` Registry dosyasi `src/collections/sqliteRegistry.ts`; interface `src/collections/types.ts` altinda. Plandaki `registry.ts` adi birebir degil ama davranis karsilaniyor.
- `PASS` `CollectionRegistry` interface'i var. Kanit: `src/collections/types.ts`.
- `PASS` Kalici registry logical collection uretiyor; config-backed default registry yok. Kanit: `src/collections/sqliteRegistry.ts`, `test/collections.registry.test.ts`.
- `PASS` create/list/get/update registry uzerinden. Kanit: `src/collections/sqliteRegistry.ts`, `src/http/adminRouter.ts`.
- `PASS` Public collectionId ile physical Chroma name ayrik. Kanit: `src/collections/ids.ts`, `src/collections/types.ts`.
- `PASS` Slug + short ID testli. Kanit: `test/collections.ids.test.ts`.
- `PASS` `status`, `activePhysicalCollection`, `activeVersion`, `chunkCount` tutuluyor. Kanit: `src/collections/sqliteRegistry.ts`, `test/collections.registry.test.ts`.
- `PASS` `distanceMetric`, `embeddingModel`, `chromaCollectionConfiguration` tutuluyor. Kanit: `src/collections/sqliteRegistry.ts`, `test/collections.registry.test.ts`, `test/chroma.collections.test.ts`.
- `PASS` SQLite schema/versioning init ve migration guard mevcut. Kanit: `src/collections/sqliteRegistry.ts`.

## Faz 3: API Endpointlerini Yeniden Tasarla

- `PASS` `GET /v1/rag/collections` var. Kanit: `src/http/ragRouter.ts`.
- `PASS` `GET /v1/rag/collections/:collectionId` var. Kanit: `src/http/ragRouter.ts`.
- `PASS` `GET /v1/rag/collections/:collectionId/ready` var. Kanit: `src/http/ragRouter.ts`.
- `PASS` `POST /v1/rag/collections/:collectionId/retrieve` var. Kanit: `src/http/ragRouter.ts`.
- `PASS` `POST /v1/rag/collections/:collectionId/query` var. Kanit: `src/http/ragRouter.ts`.
- `PASS` Legacy endpoints delegate/redirect olmadan kalkti. Kanit: `test/app.foundation.test.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Response payload'larinda `collectionId` ve `collectionDisplayName` var. Kanit: `src/http/ragRouter.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Collection resolve helper tek yerde registry/tenant/active physical/readability kontrolu yapiyor. Kanit: `src/collections/resolveReadableCollection.ts`.
- `PASS` Urun endpointleri `/v1` altinda. Kanit: `src/app.ts`, `src/http/*.ts`.

## Faz 4: Zero-Downtime Index/Rebuild

- `PASS` Index build physical target collection aliyor. Kanit: `src/indexing/buildPhysicalCollection.ts`.
- `PASS` `resetChromaCollection` rebuild akisindan cikti. Kanit: stale scan, `src/index.ts`, `src/indexing/buildPhysicalCollection.ts`.
- `PASS` `index_jobs` state'i var. Kanit: `src/collections/sqliteRegistry.ts`.
- `PASS` Collection-level writer lock queued/running unique davranisiyla var. Kanit: `src/collections/sqliteRegistry.ts`, `test/indexing.jobs.test.ts`.
- `PASS` Rebuild API async job olarak `202 Accepted` donuyor. Kanit: `src/http/adminRouter.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Basarili build sonrasi active pointer atomic transaction ile degisiyor. Kanit: `src/collections/sqliteRegistry.ts`, `test/collections.registry.test.ts`.
- `PASS` Eski physical retention cleanup akisi var. Kanit: `src/indexing/cleanup.ts`, `test/indexing.cleanup.test.ts`.
- `PASS` Ilk build sirasinda query `503 COLLECTION_INDEXING` kontrati testli. Kanit: `test/acceptance/api.endpoints.test.ts`.
- `PASS` Worker restart/stale lock recovery var. Kanit: `src/collections/sqliteRegistry.ts`, `src/server.ts`, `test/collections.registry.test.ts`.
- `PASS` Failed rebuild onceki aktif surumu degistirmiyor. Kanit: `test/indexing.jobs.test.ts`, `test/collections.registry.test.ts`.
- `PASS` Embedding/HNSW ayarlari collection-specific build'e aktariliyor ve yeni physical target uzerinden uygulanabiliyor. Kanit: `src/indexing/buildPhysicalCollection.ts`, `src/collections/chromaCollections.ts`, `test/buildPhysicalCollection.test.ts`, `test/chroma.collections.test.ts`.

## Faz 5: Backend Operasyonel Olgunluk

- `PASS` Request ID middleware var. Kanit: `src/http/requestContext.ts`, `test/app.foundation.test.ts`.
- `PASS` Structured log alanlari merkezi event contract olarak standardize edildi: `requestId`, `tenantId`, `userId`, `collectionId`, `physicalCollection`, `jobId`, `operation`, `status`, `latencyMs`, `errorCode`. HTTP, RAG query/retrieve, admin reindex/job, index build/job runner ve cleanup akislari fake sink ile testlenebilir. Kanit: `src/observability/logger.ts`, `src/app.ts`, `src/rag.ts`, `src/indexing/jobs.ts`, `src/indexing/buildPhysicalCollection.ts`, `src/indexing/jobRunner.ts`, `src/indexing/cleanup.ts`, `test/acceptance/api.endpoints.test.ts`, `test/buildPhysicalCollection.test.ts`, `test/indexing.jobs.test.ts`, `test/indexing.cleanup.test.ts`, `test/observability.test.ts`.
- `PASS` Model backpressure icin semaphore/queue var. Kanit: `src/rag.ts`, `src/http/semaphore.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Body limit var ve query/retrieve/reindex icin merkezi request rate limiter eklendi. Limit anahtari `tenantId:userId:collectionId:operation`; asimda structured `429 RATE_LIMIT_EXCEEDED` donuyor. Kanit: `src/http/rateLimit.ts`, `src/app.ts`, `src/config.ts`, `config/rag.config.yaml`, `test/acceptance/api.endpoints.test.ts`, `test/observability.test.ts`, `test/runtime.static.test.ts`.
- `PASS` Tenant scope ve user dimension request context uzerinden destekleniyor; production auth entegrasyonu planin "yer ayir" kapsaminda takip riski olarak kaliyor. Kanit: `src/http/requestContext.ts`, `src/collections/sqliteRegistry.ts`, `src/http/rateLimit.ts`.
- `PASS` `/ready` registry-aware. Kanit: `src/app.ts`, `test/app.foundation.test.ts`.
- `PASS` Retrieval/generation latency response'ta yalniz `observability.includeDebugTimings=true` iken `debug.latency` olarak donuyor; debug kapaliyken response shape sabit kaliyor. Kanit: `src/rag.ts`, `src/http/ragRouter.ts`, `src/config.ts`, `test/acceptance/api.endpoints.test.ts`, `test/runtime.static.test.ts`, `README.md`, `vanilla_rag_backend_mimarisi.md`.
- `PASS` Query path'te Chroma readability, Chroma vector search ve Ollama generation timeout/abort hardening ile korunuyor; timeout/abort hatalari typed `RagQueryError` / operational helper seviyesinde testli. Kanit: `src/collections/chromaCollections.ts`, `src/rag.ts`, `src/observability/timeout.ts`, `test/observability.test.ts`, `test/acceptance/api.endpoints.test.ts`.

## Faz 6: Test Frontend ve Dokumantasyon

- `PASS` Test UI collection dropdown ile basliyor. Kanit: `test_frontend/index.html`, `test/frontend.static.test.ts`.
- `PASS` Collection status/readiness UI'da gorunuyor. Kanit: `test_frontend/index.html`.
- `PASS` Query/retrieve yeni endpointleri kullaniyor. Kanit: `test_frontend/index.html`, `test/frontend.static.test.ts`.
- `PASS` README multi-collection API ornekleriyle guncel. Kanit: `README.md`, `test/docs.contract.test.ts`.
- `PASS` Rebuild sirasinda onceki aktif physical'dan query davranisi dokumante. Kanit: `README.md`, `vanilla_rag_backend_mimarisi.md`.
- `PASS` README legacy `/rag/query` ve `/rag/retrieve` anlatmiyor. Kanit: `test/docs.contract.test.ts`.

## Test Kabul Kriterleri

- `PASS` `GET /v1/rag/collections` sadece erisilebilir logical collection'lari listeler. Kanit: `test/acceptance/api.endpoints.test.ts`.
- `PASS` Registry'de olmayan collection icin Chroma'da yeni bos collection olusmaz. Kanit: `test/integration/rag.test.ts`, `test/acceptance/api.endpoints.test.ts`.
- `PASS` Physical Chroma collection adlari Chroma kurallarina uyar. Kanit: `test/collections.ids.test.ts`.
- `PASS` Physical collection `configuration.hnsw.space` degerini registry `distanceMetric` degerinden alir. Kanit: `test/chroma.collections.test.ts`.
- `PASS` Bilinmeyen `collectionId` query/retrieve icin `404 COLLECTION_NOT_FOUND` doner. Kanit: `test/acceptance/api.endpoints.test.ts`.
- `PASS` Yetkisiz collection icin `403 COLLECTION_FORBIDDEN` doner. Kanit: `test/acceptance/api.endpoints.test.ts`.
- `PASS` Aktif surumu olmayan ve indexing suren collection icin `503 COLLECTION_INDEXING` doner. Kanit: `test/acceptance/api.endpoints.test.ts`.
- `PASS` Rebuild sirasinda onceki aktif surum varsa query/retrieve kullanilabilir kalir. Kanit: `test/acceptance/api.endpoints.test.ts`, `src/collections/resolveReadableCollection.ts`.
- `PASS` Ayni collection icin ikinci rebuild `409 COLLECTION_INDEX_ALREADY_RUNNING` doner. Kanit: `test/acceptance/api.endpoints.test.ts`, `test/indexing.jobs.test.ts`.
- `PASS` Farkli collection'lar ayni anda rebuild edilebilir. Kanit: `test/indexing.jobs.test.ts`.
- `PASS` Rebuild basarisiz olursa onceki aktif surum degismeden kalir. Kanit: `test/indexing.jobs.test.ts`.
- `PASS` `GET /v1/rag/collections/:collectionId/ready` collection bazli dogru readiness verir. Kanit: `test/acceptance/api.endpoints.test.ts`.
- `PASS` Test frontend collection listesi bossa query formunu pasif gosterir. Kanit: `test/frontend.static.test.ts`.

## Prompt 21 Regresyon Kanitlari

Prompt 21 audit basinda Prompt 19 davranislarinda working-tree regresyonu bulundu ve duzeltildi:

- `cleanupRetiredPhysicalCollections` dependency injection geri getirildi. Kanit: `src/indexing/cleanup.ts`, `test/indexing.cleanup.test.ts`.
- Cleanup due listesi `delete_pending` ve `cleanup_failed` ile sinirlandi; `failed_build` skip testli. Kanit: `src/collections/sqliteRegistry.ts`, `test/collections.registry.test.ts`, `test/indexing.cleanup.test.ts`.
- `markPhysicalCollectionDeleted` ve `markPhysicalCollectionCleanupFailed` affected-row guard'lari geri getirildi; basarili delete `cleanup_error` temizliyor. Kanit: `src/collections/sqliteRegistry.ts`, `test/collections.registry.test.ts`.
- Startup maintenance server start'i bloklamadan logluyor ve drain promise expose ediyor. Kanit: `src/server.ts`, `test/indexing.cleanup.test.ts`.

## Prompt 22 Re-audit

- `PASS` Faz 5 operational maturity partial'lari kapatildi. Kanit: `src/http/rateLimit.ts`, `src/observability/logger.ts`, `src/observability/timeout.ts`, `src/rag.ts`, `src/collections/chromaCollections.ts`, `test/acceptance/api.endpoints.test.ts`, `test/observability.test.ts`, `test/runtime.static.test.ts`.
- `PASS` Re-audit sirasinda bulunan ek implementation bosluklari kapatildi: readiness smoke check runtime config propagation'i (`src/app.ts`, `test/app.foundation.test.ts`), RAG core/query structured log'larinda `collectionId` (`src/rag.ts`, `src/http/ragRouter.ts`, `test/acceptance/api.endpoints.test.ts`), admin HTTP structured log'larinda `physicalCollection` (`src/http/adminRouter.ts`, `test/acceptance/api.endpoints.test.ts`) ve onboarding/config yazma yolunda `rateLimit`/`observability` yuzeyi (`src/admin/onboard.ts`, `config/rag.config.yaml`, `test/runtime.static.test.ts`).
- Kalan risk: production auth entegrasyonu yok; tenant/user degerleri su an header tabanli request context'ten geliyor. Bu Prompt 22 kapsaminda yeni eksik degil, deployment entegrasyon riskidir.
