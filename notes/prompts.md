# Multi-Collection Refactor Coding Agent Prompts

Bu dosyadaki promptlar sÄ±rayla ayrÄ± coding agent oturumlarÄ±na verilecek ÅŸekilde yazÄ±lmÄ±ÅŸtÄ±r. Her prompt, yeni agent'Ä±n sÄ±fÄ±r context ile Ã§alÄ±ÅŸacaÄŸÄ±nÄ± varsayar. Her agent Ã¶nce [notes/multicollection.md](notes/multicollection.md) dosyasÄ±nÄ± okumalÄ±, Ã¶zellikle kendi promptunda belirtilen bÃ¶lÃ¼mlere gÃ¶re implementation yapmalÄ±dÄ±r.

Genel kural:

- PromptlarÄ± sÄ±rayla kullan.
- Her prompt sonunda `npm.cmd run build` ve ilgili test komutlarÄ± Ã§alÄ±ÅŸmalÄ±.
- Bir prompt Ã¶nceki promptlarÄ±n Ã§Ä±ktÄ±sÄ±nÄ± bekliyorsa, agent Ã¶nce repo durumunu kontrol etmeli. Ã–nceki faz eksikse kod yazmaya baÅŸlamadan bunu raporlamalÄ±.
- Eski `/rag/query` ve `/rag/retrieve` endpointleri korunmayacak. Geriye dÃ¶nÃ¼k uyumluluk, redirect, default fallback veya config-backed default registry eklenmeyecek.
- Ana referans dokÃ¼man her zaman [notes/multicollection.md](notes/multicollection.md).
- Her agent Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce [notes/done.md](notes/done.md) dosyasÄ±nÄ± okumalÄ± ve Ã¶nceki agentlarÄ±n ne yaptÄ±ÄŸÄ±nÄ± anlamalÄ±dÄ±r.
- Her agent kendi gÃ¶revlerini tamamladÄ±kÃ§a [notes/done.md](notes/done.md) dosyasÄ±na uygun bir baÅŸlÄ±k altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸi ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ± doÄŸrulama komutlarÄ±nÄ± ve varsa kalan riskleri eklemelidir.
- [notes/done.md](notes/done.md) dosyasÄ± coordination log'dur; kÄ±sa ama somut yazÄ±lmalÄ±, implementation detaylarÄ± gereksiz uzatÄ±lmamalÄ±dÄ±r.

## Prompt 1: Foundation, Test Harness, App Bootstrap

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin multi-collection refactor iÃ§in foundation katmanÄ±nÄ± hazÄ±rlamak.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "KÄ±sa Karar"
- "Coding Agent Ä°Ã§in Uygulama Blueprint'i"
- "`src/app.ts` ve `src/server.ts`"
- "HTTP Hata KodlarÄ±"
- "Coding Agent Ã‡alÄ±ÅŸma SÄ±rasÄ±"
- "Faz 0" ve "Faz 0.5"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Ã–nceki agentlarÄ±n tamamladÄ±ÄŸÄ± iÅŸleri ve kalan riskleri dikkate al.

AmaÃ§:
Express app bootstrap'Ä±nÄ± test edilebilir hale getir, test altyapÄ±sÄ±nÄ± ekle ve eski public RAG endpointlerini kaldÄ±rmaya baÅŸla. Bu prompt registry veya Chroma indexing implementation yapmayacak; sadece foundation kuracak.

YapÄ±lacaklar:
1. `package.json` iÃ§ine test script'i ekle:
   - `"test": "node --import tsx --test \"test/**/*.test.ts\""`
2. `src/app.ts` oluÅŸtur:
   - `createApp(deps)` export et.
   - Express middleware, JSON parser, invalid JSON error handler, `/health`, `/ready`, `/test-frontend` static route ve root route burada kurulsun.
   - Ä°lk aÅŸamada registry dependency type'Ä± placeholder olabilir ama shape net olsun:
     `type AppDependencies = { registry?: unknown }`
   - `app.listen` burada Ã§aÄŸrÄ±lmasÄ±n.
3. `src/server.ts` sade bootstrap dosyasÄ±na dÃ¶nsÃ¼n:
   - config import et.
   - `createApp(...)` Ã§aÄŸÄ±r.
   - `app.listen(config.port, ...)` sadece burada kalsÄ±n.
4. Eski public endpointleri kaldÄ±r:
   - `GET /rag/query`
   - `GET /rag/retrieve`
   - `POST /rag/query`
   - `POST /rag/retrieve`
   Bu endpointlere compatibility, redirect veya fallback ekleme.
5. Root endpoint cevabÄ±nÄ± yeni hedef API yÃ¶nÃ¼nÃ¼ gÃ¶sterecek ÅŸekilde gÃ¼ncelle:
   - `/v1/rag/collections`
   - `/v1/rag/collections/:collectionId/query`
   - `/v1/rag/collections/:collectionId/retrieve`
   Bu endpointler bu promptta implement edilmek zorunda deÄŸil; sonraki promptlarda gelecek.
6. `test/app.foundation.test.ts` ekle:
   - `GET /health` 200 dÃ¶nmeli.
   - `GET /` 200 dÃ¶nmeli ve yeni `/v1/rag/collections` yÃ¶nÃ¼nÃ¼ gÃ¶stermeli.
   - Eski `/rag/query` ve `/rag/retrieve` endpointleri artÄ±k 404 veya route-not-found davranÄ±ÅŸÄ± gÃ¶stermeli. 405 dÃ¶nmemeli.
7. `src/http/requestContext.ts` ekle:
   - `createRequestContext(req)` veya benzeri helper export et.
   - Åimdilik `tenantId = "default"`, `userId = "local-dev"` ve random/request id Ã¼retimi yeterli.
8. `src/http/errors.ts` ekle:
   - Ortak error response helper/type iskeleti ekle.
   - HenÃ¼z tÃ¼m error mapping'i bitirmek zorunda deÄŸilsin, ama sonraki promptlarÄ±n kullanacaÄŸÄ± shape hazÄ±r olsun.

Dikkat:
- `notes/multicollection.md` eski endpointleri kaldÄ±rmayÄ± net sÃ¶ylÃ¼yor. Eski endpointleri canlÄ± tutma.
- Registry, SQLite, Chroma physical collection ve indexing job bu promptun kapsamÄ± dÄ±ÅŸÄ±nda.
- `GET /ready` mevcut davranÄ±ÅŸÄ±nÄ± ÅŸimdilik koruyabilir; sonraki promptlarda registry-aware yapÄ±lacak.
- TypeScript build kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- DeÄŸiÅŸen dosyalarÄ± listele.
- Eski endpointlerin kaldÄ±rÄ±ldÄ±ÄŸÄ±nÄ± belirt.
- Ã‡alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 1: Foundation, Test Harness, App Bootstrap" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 2: Collection IDs, Config Shape, SQLite Registry

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin multi-collection refactor iÃ§in collection ID Ã¼retimi, config hedef ÅŸekli ve SQLite registry katmanÄ±nÄ± implement etmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "`src/config.ts`"
- "Ã–nerilen Registry Modeli"
- "Coding Agent Ä°Ã§in Uygulama Blueprint'i"
- "Registry Storage KararÄ±"
- "Registry ÅemasÄ±"
- "`src/collections/types.ts`"
- "`src/collections/ids.ts`"
- "Faz 2: Collection Registry Ekle"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1 Ã§Ä±ktÄ±larÄ±nÄ±n gerÃ§ekten tamamlandÄ±ÄŸÄ±nÄ± ve Ã¶nceki agentÄ±n not ettiÄŸi riskleri kontrol et.

Bu prompt, Prompt 1'in tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `src/app.ts` var mÄ±?
- `package.json` iÃ§inde `test` script'i var mÄ±?
- Eski `/rag/query` ve `/rag/retrieve` endpointleri kaldÄ±rÄ±lmÄ±ÅŸ mÄ±?
Eksikse kod yazmadan raporla.

AmaÃ§:
Config'i hedef multi-collection ÅŸekline yaklaÅŸtÄ±r, SQLite registry'yi ekle ve collection ID/physical Chroma name Ã¼retimini testlerle kilitle.

YapÄ±lacaklar:
1. Dependency ekle:
   - `better-sqlite3`
   - Dev dependency olarak `@types/better-sqlite3`
2. `config/rag.config.yaml` hedef yapÄ±ya dÃ¶nsÃ¼n:
   - `registry.path: data/registry.sqlite`
   - `chroma.url`
   - `collectionDefaults`
   - `ollama`
   - `readiness`
   - `chroma.collection` kaldÄ±rÄ±lmalÄ±.
   - Mevcut `data.*` ve `rag.*` deÄŸerleri `collectionDefaults` altÄ±na taÅŸÄ±nmalÄ±.
3. `src/config.ts` gÃ¼ncelle:
   - `configSchema` yeni yapÄ±yÄ± doÄŸrulasÄ±n.
   - `resolveConfig` `registryPath` ve `collectionDefaults` alanlarÄ±nÄ± dÃ¶nsÃ¼n.
   - `chromaCollection` artÄ±k runtime config alanÄ± olmamalÄ±.
   - Bu deÄŸiÅŸiklik build'i kÄ±rÄ±yorsa geÃ§ici fallback ekleme; ilgili kullanÄ±mlarÄ± sonraki prompta bÄ±rakmadan derlenecek ÅŸekilde uyumlu hale getir.
4. `src/collections/types.ts` oluÅŸtur:
   - `RequestContext`
   - `CollectionStatus`
   - `IndexJobStatus`
   - `RagCollection`
   - `IndexJob`
   - `CollectionRegistry` interface'i
5. `src/collections/ids.ts` oluÅŸtur:
   - `slugifyCollectionName(displayName)`
   - `generateCollectionId(displayName)`
   - `createPhysicalCollectionName({ tenantId, collectionId, version })`
   - `isValidChromaCollectionName(name)`
   - `assertValidChromaCollectionName(name)`
6. Chroma name kurallarÄ±nÄ± uygula:
   - 3-512 karakter.
   - KÃ¼Ã§Ã¼k harf veya rakamla baÅŸlar ve biter.
   - Arada kÃ¼Ã§Ã¼k harf/rakam/nokta/tire/alt Ã§izgi olabilir.
   - ArdÄ±ÅŸÄ±k nokta yok.
   - IP adresi formatÄ± yok.
7. `src/collections/sqliteRegistry.ts` oluÅŸtur:
   - `createSqliteCollectionRegistry({ dbPath })` export et.
   - Startup'ta tablolarÄ± `CREATE TABLE IF NOT EXISTS` ile oluÅŸtur.
   - `collections` ve `index_jobs` tablolarÄ± notes/multicollection.md "Registry ÅemasÄ±" ile uyumlu olsun.
   - `listVisibleCollections(context)`
   - `getVisibleCollection(context, collectionId)`
   - `createCollection(context, input)`
   - `updateCollection(context, collectionId, patch)`
   - `beginIndexJob(collectionId)` veya interface'te tanÄ±mladÄ±ÄŸÄ±n job create methodu
   - `completeIndexJob(jobId, result)`
   - `failIndexJob(jobId, error)`
   - AynÄ± collection iÃ§in running/queued ikinci job engellenmeli.
8. `src/server.ts` bootstrap registry oluÅŸturup `createApp({ registry })` iÃ§ine versin.
9. `src/app.ts` dependency type'Ä±nÄ± gerÃ§ek `CollectionRegistry` ile gÃ¼ncelle.
10. Test ekle:
    - `test/collections.ids.test.ts`
    - `test/collections.registry.test.ts`
    - ID slug Ã¼retimi.
    - Physical Chroma name validasyonu.
    - SQLite registry collection create/list/get.
    - AynÄ± collection iÃ§in ikinci running/queued job engelleniyor.

Dikkat:
- JSON registry yazma.
- Config-backed default registry yazma.
- Eski `chroma.collection` alanÄ±nÄ± geri ekleme.
- Bu prompt Chroma collection oluÅŸturmayacak; sadece registry ve ID/config katmanÄ±nÄ± kuracak.
- Build kÄ±rÄ±k kalmamalÄ±. `src/rag.ts` veya `src/index.ts` eski `config.chromaCollection` bekliyorsa bu prompt kapsamÄ±nda uyumlu hale getir.

DoÄŸrulama:
1. `npm.cmd install better-sqlite3`
2. `npm.cmd install -D @types/better-sqlite3`
3. `npm.cmd run build`
4. `npm.cmd test`

Final cevapta:
- Registry storage kararÄ±nÄ±n SQLite olduÄŸunu belirt.
- `chroma.collection` kaldÄ±rÄ±ldÄ±ysa ve yerine hangi alanlar geldiÄŸini Ã¶zetle.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 2: Collection IDs, Config Shape, SQLite Registry" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 3: Chroma Helpers and RAG Core Refactor

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin Chroma lifecycle helper'larÄ±nÄ± ve RAG core fonksiyonlarÄ±nÄ± multi-collection aware hale getirmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Chroma DokÃ¼manlarÄ±yla Uyum NotlarÄ±"
- "`src/rag.ts`"
- "`src/collections/chromaCollections.ts`"
- "`src/rag.ts` Refactor Hedefi"
- "Query/Retrieve Path"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1-2 Ã§Ä±ktÄ±larÄ±nÄ±n durumunu ve varsa dependency/config risklerini dikkate al.

Bu prompt, Prompt 1 ve Prompt 2'nin tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `src/collections/types.ts` var mÄ±?
- `src/collections/ids.ts` var mÄ±?
- `src/collections/sqliteRegistry.ts` var mÄ±?
- Config'te `registry.path` ve `collectionDefaults` var mÄ±?
Eksikse kod yazmadan raporla.

AmaÃ§:
Read path'te Chroma collection yaratma riskini ortadan kaldÄ±r, physical collection creation iÃ§in direct ChromaClient helper ekle ve RAG fonksiyonlarÄ±nÄ± explicit collectionName alacak ÅŸekilde refactor et.

YapÄ±lacaklar:
1. `src/collections/chromaCollections.ts` oluÅŸtur:
   - `createPhysicalChromaCollection({ name, distanceMetric, runtimeConfig })`
   - `assertChromaCollectionReadable({ name, runtimeConfig })`
   - `deletePhysicalChromaCollection({ name, runtimeConfig })`
   - `listPhysicalChromaCollections(runtimeConfig)` opsiyonel ama faydalÄ±.
2. `createPhysicalChromaCollection` direct `ChromaClient.createCollection` kullanmalÄ±:
   - `embeddingFunction: null`
   - `configuration: { hnsw: { space: distanceMetric } }`
   - `getOrCreateCollection` kullanma.
   - Name Ã§akÄ±ÅŸmasÄ± fail etmeli.
3. `assertChromaCollectionReadable`:
   - `ChromaClient.getCollection({ name })` kullanmalÄ±.
   - `count()` dÃ¶nmeli.
   - Missing collection hatasÄ±nÄ± typed error'a Ã§evirecek ÅŸekilde yardÄ±mcÄ± hata Ã¼retmeli.
4. `src/rag.ts` refactor:
   - `createVectorStore({ runtimeConfig, collectionName })`
   - `retrieveSources(question, { collectionName, k, runtimeConfig })`
   - `answerQuestion(question, { collectionName, runtimeConfig, retrievalK })`
   - Eski positional/default collection imzalarÄ± kaldÄ±rÄ±lmalÄ±.
   - `runtimeConfig.chromaCollection` referansÄ± kalmamalÄ±.
5. `RagQueryErrorCode` iÃ§ine ekle:
   - `COLLECTION_NOT_FOUND`
   - `COLLECTION_NOT_READY`
   - `COLLECTION_INDEXING`
   - `COLLECTION_STORAGE_INCONSISTENT`
   - `MODEL_BACKPRESSURE`
6. `checkChromaHealth` gÃ¼ncelle:
   - Collection parametresi verilmezse sadece Chroma reachability kontrol etsin.
   - Collection parametresi verilirse collection exists/count/readability kontrol etsin.
   - `/ready` multi-collection boÅŸ baÅŸlangÄ±cÄ± fail saymamalÄ±.
7. Read path guard:
   - RAG route'larÄ± daha sonra `assertChromaCollectionReadable` Ã§aÄŸÄ±racak; bu promptta helper hazÄ±r olsun.
   - Unit test ile missing collection iÃ§in LangChain `getOrCreateCollection` Ã§aÄŸrÄ±lmadÄ±ÄŸÄ±nÄ± kanÄ±tla. Gerekirse Chroma helper/mock kullan.
8. `src/index.ts` compile kÄ±rÄ±lmayacak ÅŸekilde uyumlu hale getir:
   - Destructive legacy davranÄ±ÅŸ bÄ±rakma.
   - EÄŸer `src/index.ts` henÃ¼z yeni job runner'a geÃ§mediyse komut kullanÄ±cÄ±ya yeni admin reindex akÄ±ÅŸÄ±nÄ± kullanmasÄ± gerektiÄŸini sÃ¶yleyebilir ya da sonraki prompta kadar minimal build-safe wrapper olarak kalabilir.

Dikkat:
- `getOrCreateCollection` read path'te de build path'te de kullanÄ±lmamalÄ±.
- Chroma collection `embeddingFunction: null` olmalÄ±.
- LangChain wrapper sadece embedding Ã¼retme/upsert/search iÃ§in kullanÄ±lmalÄ±; collection creation source of truth Chroma helper olsun.
- Build kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- `runtimeConfig.chromaCollection` referanslarÄ±nÄ±n kaldÄ±rÄ±ldÄ±ÄŸÄ±nÄ± belirt.
- Direct Chroma create helper'Ä±n nasÄ±l Ã§alÄ±ÅŸtÄ±ÄŸÄ±nÄ± Ã¶zetle.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 3: Chroma Helpers and RAG Core Refactor" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 4: Versioned Physical Collection Build and Index Jobs

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin destructive indexing'i kaldÄ±rÄ±p versioned physical Chroma collection build + registry pointer swap modelini implement etmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "`src/index.ts`"
- "`src/indexing/buildPhysicalCollection.ts`"
- "`src/indexing/jobs.ts`"
- "Index/Rebuild Path"
- "Zero-Downtime Index/Rebuild"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1-3 Ã§Ä±ktÄ±larÄ±nÄ±n durumunu, Ã¶zellikle registry ve Chroma helper notlarÄ±nÄ± dikkate al.

Bu prompt, Prompt 1-3'Ã¼n tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `src/collections/chromaCollections.ts` var mÄ±?
- `src/rag.ts` collection-aware mi?
- `CollectionRegistry` ve SQLite registry var mÄ±?
Eksikse kod yazmadan raporla.

AmaÃ§:
Indexleme artÄ±k Chroma collection silip baÅŸtan yazmayacak. Her reindex yeni physical collection'a build edecek, baÅŸarÄ±lÄ± olunca registry active pointer'Ä± deÄŸiÅŸtirecek.

YapÄ±lacaklar:
1. `src/indexing/buildPhysicalCollection.ts` oluÅŸtur:
   - `buildPhysicalCollection({ collection, targetPhysicalCollection, targetVersion, runtimeConfig, log })`
   - AkÄ±ÅŸ notes/multicollection.md ile birebir uyumlu olmalÄ±.
2. Build akÄ±ÅŸÄ±:
   - `createPhysicalChromaCollection`
   - collection source ayarlarÄ±yla `analyzeIndexingSource`
   - chunk split
   - metadata ekle:
     - `collectionId`
     - `collectionVersion`
     - `physicalCollection`
   - `createVectorStore({ collectionName: targetPhysicalCollection })`
   - `addDocuments`
   - `assertChromaCollectionReadable`
   - Hata olursa target physical collection best-effort delete.
3. `src/indexing/jobs.ts` oluÅŸtur:
   - `startReindexJob`
   - `runIndexJob`
   - job state registry'de kalÄ±cÄ± olmalÄ±.
   - AynÄ± collection iÃ§in ikinci running/queued job `409 COLLECTION_INDEX_ALREADY_RUNNING` karÅŸÄ±lÄ±ÄŸÄ± Ã¼retecek hata dÃ¶nmeli.
   - Job target physical collection adÄ± `createPhysicalCollectionName` ile Ã¼retilmeli.
   - Job baÅŸarÄ±lÄ± olunca collection:
     - `status = ready`
     - `activePhysicalCollection = target`
     - `activeVersion = targetVersion`
     - `chunkCount`, `documentCount`, `lastIndexedAt` gÃ¼ncellenmeli.
   - Job baÅŸarÄ±sÄ±z olursa Ã¶nceki active pointer deÄŸiÅŸmemeli.
4. `src/index.ts` gÃ¼ncelle:
   - `npm run index -- --collection-id <id>` ÅŸeklinde registry/job runner akÄ±ÅŸÄ±nÄ± Ã§aÄŸÄ±rmalÄ±.
   - Parametre yoksa aÃ§Ä±k hata mesajÄ± vermeli.
   - `resetChromaCollection` kullanmamalÄ±.
5. `src/admin/onboard.ts` gÃ¼ncelle:
   - Config-only onboarding ile collection lifecycle karÄ±ÅŸmamalÄ±.
   - Mevcut destructive reindex onayÄ± kaldÄ±rÄ±lmalÄ± veya yeni job runner'a yÃ¶nlendirilmeli.
6. Test ekle:
   - failed build active pointer deÄŸiÅŸtirmez.
   - aynÄ± collection iÃ§in ikinci job engellenir.
   - target physical name Chroma-safe.
   - metadata iÃ§ine collection/version eklenir.
   - immutable HNSW/distanceMetric veya embedding model deÄŸiÅŸince yeni physical collection hedeflenir.

Dikkat:
- Chroma collection delete sadece cleanup/hata rollback iÃ§in kullanÄ±lmalÄ±.
- Active pointer swap registry transaction iÃ§inde olmalÄ±.
- Query path Ã¶nceki active version'dan okumaya devam edebilmeli.
- Build kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Destructive reset'in kaldÄ±rÄ±ldÄ±ÄŸÄ±nÄ± belirt.
- Yeni job flow'u Ã¶zetle.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 4: Versioned Physical Collection Build and Index Jobs" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 5: `/v1` Admin and RAG API Endpoints

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin multi-collection `/v1` HTTP API yÃ¼zeyini implement etmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "`src/server.ts`"
- "Yeni Endpoint KontratlarÄ±"
- "HTTP Hata KodlarÄ±"
- "Query/Retrieve Path"
- "Readiness ve Healthcheck"
- "Faz 3: API Endpointlerini Yeniden Tasarla"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1-4 Ã§Ä±ktÄ±larÄ±nÄ±n durumunu, Ã¶zellikle job runner ve registry notlarÄ±nÄ± dikkate al.

Bu prompt, Prompt 1-4'Ã¼n tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `createApp({ registry })` var mÄ±?
- SQLite registry Ã§alÄ±ÅŸÄ±yor mu?
- job service var mÄ±?
- `retrieveSources` ve `answerQuestion` collection-aware mi?
Eksikse kod yazmadan raporla.

AmaÃ§:
Yeni admin collection lifecycle endpointlerini ve collection-scoped RAG query/retrieve endpointlerini eklemek.

Endpointler:
1. `POST /v1/admin/collections`
   - Collection registry kaydÄ± oluÅŸturur.
   - Request body zod ile validate edilmeli.
   - Defaults `collectionDefaults` ve runtime model config'ten gelebilir.
   - Response `201`.
2. `PATCH /v1/admin/collections/:collectionId`
   - Display/source/retrieval config gÃ¼ncelleyebilir.
   - Active physical collection'Ä± direkt deÄŸiÅŸtirmemeli.
3. `POST /v1/admin/collections/:collectionId/reindex`
   - `startReindexJob` Ã§aÄŸÄ±rÄ±r.
   - Response `202`.
   - Job arka planda baÅŸlatÄ±labilir.
4. `GET /v1/admin/jobs/:jobId`
   - Job durumunu dÃ¶ner.
5. `GET /v1/rag/collections`
   - KullanÄ±cÄ±nÄ±n/tenant'Ä±n collection listesini dÃ¶ner.
6. `GET /v1/rag/collections/:collectionId`
   - Collection detayÄ±nÄ± dÃ¶ner.
7. `GET /v1/rag/collections/:collectionId/ready`
   - Registry + active physical Chroma count + job state kontrol eder.
8. `POST /v1/rag/collections/:collectionId/retrieve`
   - `resolveReadableCollection` helper kullan.
   - Chroma read guard Ã§alÄ±ÅŸmadan `retrieveSources` Ã§aÄŸÄ±rma.
   - Response mevcut retrieve shape + `collectionId`, `collectionDisplayName`, `activeVersion`.
9. `POST /v1/rag/collections/:collectionId/query`
   - `resolveReadableCollection` helper kullan.
   - Chroma read guard Ã§alÄ±ÅŸmadan `answerQuestion` Ã§aÄŸÄ±rma.
   - Response mevcut query shape + `collectionId`, `collectionDisplayName`, `activeVersion`.

HTTP error mapping:
- `400 INVALID_REQUEST_BODY`
- `403 COLLECTION_FORBIDDEN`
- `404 COLLECTION_NOT_FOUND`
- `404 COLLECTION_NOT_READY`
- `409 COLLECTION_INDEX_ALREADY_RUNNING`
- `422 NO_RELEVANT_CONTEXT`
- `503 COLLECTION_INDEXING`
- `503 COLLECTION_STORAGE_INCONSISTENT`
- `503 MODEL_BACKPRESSURE`
- `502 EMPTY_MODEL_RESPONSE`

YapÄ±lacaklar:
1. `src/http/errors.ts` tam error mapper haline gelsin.
2. `src/http/requestContext.ts` her request iÃ§in context Ã¼retip request'e baÄŸlasÄ±n.
3. `resolveReadableCollection(req/deps)` helper ekle:
   - collectionId validate.
   - registry lookup.
   - status/activePhysicalCollection kontrol.
   - active Chroma collection readable assert.
4. Route'larÄ± `src/app.ts` iÃ§inde veya ayrÄ± route modÃ¼llerinde kur.
5. Eski `/rag/query` ve `/rag/retrieve` endpointleri geri eklenmemeli.
6. Test ekle:
   - `GET /v1/rag/collections`
   - missing collection -> 404.
   - no active version -> 404 veya 503 sÃ¶zleÅŸmeye gÃ¶re.
   - indexing collection -> 503.
   - duplicate reindex -> 409.
   - old `/rag/query` and `/rag/retrieve` -> 404.

Dikkat:
- Auth gerÃ§ek deÄŸilse `tenantId = "default"` merkezi helper'dan gelsin.
- Controller iÃ§inde registry/Chroma resolve mantÄ±ÄŸÄ±nÄ± kopyalama; helper kullan.
- Build kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Eklenen endpointleri listele.
- Eski endpointlerin geri eklenmediÄŸini belirt.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 5: /v1 Admin and RAG API Endpoints" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 6: Frontend, README, Smoke Flow

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin test frontend ve dokÃ¼mantasyonu yeni multi-collection API'ye gÃ¶re gÃ¼ncellemek ve manuel smoke flow'u Ã§alÄ±ÅŸÄ±r hale getirmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "`test_frontend/index.html`"
- "Yeni Endpoint KontratlarÄ±"
- "DoÄŸrulama KomutlarÄ±"
- "Faz 6: Test Frontend ve DokÃ¼mantasyon"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1-5 Ã§Ä±ktÄ±larÄ±nÄ±n durumunu ve yeni endpoint sÃ¶zleÅŸmelerindeki olasÄ± notlarÄ± dikkate al.

Bu prompt, Prompt 1-5'in tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `/v1/rag/collections` endpointi var mÄ±?
- `/v1/admin/collections` endpointi var mÄ±?
- collection-scoped query/retrieve endpointleri var mÄ±?
Eksikse kod yazmadan raporla.

AmaÃ§:
KullanÄ±cÄ± artÄ±k test frontend Ã¼zerinden collection listesini gÃ¶rebilmeli, collection seÃ§ebilmeli ve seÃ§ili collection'a query/retrieve atabilmeli. README eski endpointleri anlatmamalÄ±.

YapÄ±lacaklar:
1. `test_frontend/index.html` gÃ¼ncelle:
   - Sayfa aÃ§Ä±lÄ±nca `GET /v1/rag/collections` Ã§aÄŸÄ±r.
   - Collection dropdown/list ekle.
   - SeÃ§ili collection status/readiness gÃ¶ster.
   - Retrieve butonu `POST /v1/rag/collections/:collectionId/retrieve` Ã§aÄŸÄ±rmalÄ±.
   - Query butonu `POST /v1/rag/collections/:collectionId/query` Ã§aÄŸÄ±rmalÄ±.
   - Collection yoksa query formu pasif olmalÄ±.
   - `503 COLLECTION_INDEXING`, `404 COLLECTION_NOT_READY`, `404 COLLECTION_NOT_FOUND` kullanÄ±cÄ±ya net gÃ¶sterilmeli.
2. Eski frontend referanslarÄ±nÄ± kaldÄ±r:
   - `/rag/query`
   - `/rag/retrieve`
3. README gÃ¼ncelle:
   - Multi-collection akÄ±ÅŸÄ±.
   - Admin collection create.
   - Reindex job baÅŸlatma.
   - Collection list.
   - Collection-scoped retrieve/query.
   - Eski endpointleri anlatma.
   - `npm run index -- --collection-id <id>` yeni davranÄ±ÅŸÄ±nÄ± anlat.
4. `vanilla_rag_backend_mimarisi.md` veya ilgili mimari dokÃ¼manda eski endpoint yÃ¼zeyi anlatÄ±lÄ±yorsa gÃ¼ncelle.
5. Manuel smoke test iÃ§in README'ye PowerShell Ã¶rneÄŸi ekle:
   - collection create
   - reindex
   - job status
   - list collections
   - query/retrieve
6. Test gÃ¼ncelle:
   - frontend statik dosyada eski endpoint stringleri kalmadÄ±ÄŸÄ±nÄ± basit bir testle doÄŸrula.
   - README'de eski endpoint Ã¶rnekleri kalmadÄ±ÄŸÄ±nÄ± test etmek opsiyonel ama faydalÄ±.

Dikkat:
- Landing page yapma; mevcut test console iÅŸlevsel kalmalÄ±.
- Eski endpointleri tekrar kullanma.
- Build/test kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. Gerekirse `npm.cmd run dev` ile manuel frontend smoke.

Final cevapta:
- Frontend davranÄ±ÅŸÄ±nÄ± Ã¶zetle.
- README'deki yeni API Ã¶rneklerini belirt.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 6: Frontend, README, Smoke Flow" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 7: Final Hardening, Readiness, Backpressure, Cleanup

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin multi-collection refactor sonrasÄ± son hardening, readiness, cleanup ve acceptance testlerini tamamlamak.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Ollama ve Chroma Backpressure"
- "Readiness ve Healthcheck"
- "Concurrency Stratejisi"
- "Test Kabul Kriterleri"
- "Mimari Etkinlik DeÄŸerlendirmesi"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1-6 Ã§Ä±ktÄ±larÄ±nÄ±n durumunu ve Ã¶nceki agentlarÄ±n bÄ±raktÄ±ÄŸÄ± riskleri dikkate al.

Bu prompt, Prompt 1-6'nÄ±n tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- Yeni `/v1` API Ã§alÄ±ÅŸÄ±yor mu?
- SQLite registry var mÄ±?
- Versioned physical collection build var mÄ±?
- Frontend yeni endpointleri kullanÄ±yor mu?
Eksikse kod yazmadan raporla.

AmaÃ§:
Yeni mimarinin operasyonel davranÄ±ÅŸÄ±nÄ± sertleÅŸtirmek ve planÄ±n kabul kriterlerini kapatmak.

YapÄ±lacaklar:
1. `/ready` registry-aware olsun:
   - Chroma reachable.
   - Ollama reachable.
   - embedding model available.
   - chat model available.
   - registry reachable.
   - Default collection yok diye fail olmasÄ±n.
2. `GET /v1/rag/collections/:collectionId/ready` tam Ã§alÄ±ÅŸsÄ±n:
   - registry var mÄ±?
   - active physical var mÄ±?
   - Chroma count okunuyor mu?
   - job running mÄ±?
   - query/retrieve capability.
3. Request ID ve structured logging ekle:
   - requestId
   - tenantId/userId, merkezi `requestContext` helper'Ä±ndan
   - collectionId
   - physicalCollection
   - jobId
   - total latency
   - retrieval latency
   - generation latency
   - error code
   - Registry eriÅŸimleri tenant-scoped olmalÄ±; controller'lar context'i bypass etmemeli.
4. Basit model backpressure ekle:
   - `maxConcurrentEmbeddings`
   - `maxConcurrentGenerations`
   - Åimdilik config veya sabit deÄŸer olabilir ama merkezi olmalÄ±.
   - Limit aÅŸÄ±lÄ±rsa `503 MODEL_BACKPRESSURE` dÃ¶n.
5. Request guard ve limit davranÄ±ÅŸlarÄ±nÄ± netleÅŸtir:
   - JSON body limit merkezi app bootstrap'ta kalmalÄ± ve test edilebilir olmalÄ±.
   - Collection/user bazlÄ± rate limit iÃ§in merkezi hook veya aÃ§Ä±k TODO bÄ±rak; daÄŸÄ±nÄ±k route iÃ§i limit yazma.
   - Full auth sistemi ekleme; mevcut aÅŸamada `requestContext` Ã¼zerinden tenant/user sÄ±nÄ±rÄ±nÄ± koru.
6. Timeout/abort davranÄ±ÅŸÄ±nÄ± gÃ¶zden geÃ§ir:
   - Chroma retrieval timeout.
   - Ollama generation timeout.
   - client disconnect durumunda gereksiz generation baÅŸlatmama.
7. Eski destructive helper cleanup:
   - `resetChromaCollection` public/index job path'te kullanÄ±lmamalÄ±.
   - KullanÄ±lmayan import/fonksiyonlarÄ± temizle.
8. Acceptance testleri tamamla:
   - `GET /v1/rag/collections` sadece visible collections.
   - registry'de olmayan collection Chroma'da yaratÄ±lmaz.
   - physical Chroma collection names valid.
   - `configuration.hnsw.space` registry distanceMetric'ten gelir.
   - duplicate reindex -> 409.
   - failed rebuild active pointer deÄŸiÅŸtirmez.
   - registry access tenant-scoped context ile yapÄ±lÄ±r.
   - oversized JSON body kontrollÃ¼ hata dÃ¶ner.
   - old endpoints yok.

Dikkat:
- BÃ¼yÃ¼k mimariyi deÄŸiÅŸtirme; eksik operasyonel davranÄ±ÅŸlarÄ± tamamla.
- Eski endpointleri geri ekleme.
- JSON registry veya config-backed fallback ekleme.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. Manuel smoke:
   - create collection
   - reindex
   - list
   - ready
   - query

Final cevapta:
- Kapanan kabul kriterlerini listele.
- Kalan risk veya manuel doÄŸrulama ihtiyacÄ± varsa net yaz.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 7: Final Hardening, Readiness, Backpressure, Cleanup" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 8: Job Lifecycle, Worker Safety, and Version Uniqueness

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin Prompt 1-7 sonrasÄ± kalan job lifecycle aÃ§Ä±klarÄ±nÄ± kapatmak, reindex job state'ini gerÃ§ek queued/running/succeeded/failed akÄ±ÅŸÄ±na oturtmak ve background worker davranÄ±ÅŸÄ±nÄ± test edilebilir hale getirmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Concurrency Stratejisi"
- "Index/Rebuild Path"
- "`src/indexing/jobs.ts`"
- "Registry ÅemasÄ±"
- "Zero-Downtime Index/Rebuild"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1-7 Ã§Ä±ktÄ±larÄ±nÄ±n tamamlandÄ±ÄŸÄ±nÄ±, Ã¶zellikle Prompt 5 ve Prompt 7 altÄ±nda not edilen job, stale lock ve backpressure davranÄ±ÅŸlarÄ±nÄ± kontrol et.

Bu prompt, Prompt 1-7'nin uygulanmÄ±ÅŸ olduÄŸunu varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `src/indexing/jobs.ts` var mÄ±?
- `src/collections/sqliteRegistry.ts` iÃ§inde `index_jobs.started_at` alanÄ± var mÄ±?
- `src/http/adminRouter.ts` iÃ§inde reindex endpoint'i var mÄ±?
- `npm.cmd run build` mevcut durumda geÃ§iyor mu?
Eksik veya build kÄ±rÄ±k ise kod yazmadan Ã¶nce kÄ±sa raporla.

Bilinen mevcut riskler:
- Reindex endpoint'i job'Ä± fire-and-forget baÅŸlatÄ±yor ve test teardown sÄ±rasÄ±nda SQLite baÄŸlantÄ±sÄ± kapanÄ±nca background job `database connection is not open` hatasÄ± Ã¼retebiliyor.
- Job state pratikte `queued -> succeeded/failed` gidiyor; `running` ve `started_at` kullanÄ±lmÄ±yor.
- AynÄ± saniye iÃ§inde ardÄ±ÅŸÄ±k job oluÅŸturulursa physical collection target name Ã§akÄ±ÅŸma riski var.
- API testleri gerÃ§ek background job baÅŸlattÄ±ÄŸÄ± iÃ§in flaky davranabilir.

AmaÃ§:
Job lifecycle'Ä± saÄŸlam, gÃ¶zlemlenebilir ve test edilebilir hale getir. HTTP route doÄŸrudan dinamik import ve kontrolsÃ¼z fire-and-forget yapmasÄ±n; job runner dependency olarak yÃ¶netilsin.

YapÄ±lacaklar:
1. `src/collections/types.ts` iÃ§indeki `CollectionRegistry` interface'ini geniÅŸlet:
   - `markIndexJobRunning(jobId, input?)` veya eÅŸdeÄŸer bir method ekle.
   - Bu method job'Ä± sadece `queued` durumundan `running` durumuna geÃ§irebilmeli.
   - `startedAt`, `updatedAt` ve varsa `lockToken`/fencing bilgisi set edilmeli.
   - `getActiveJobForCollection(context, collectionId)` veya `listActiveJobsForCollection(context, collectionId)` benzeri bir method ekle. Sonraki promptlar collection readiness iÃ§inde bunu kullanacak.
2. `src/collections/sqliteRegistry.ts` gÃ¼ncelle:
   - `markIndexJobRunning` transaction iÃ§inde Ã§alÄ±ÅŸmalÄ±.
   - `queued` olmayan job tekrar running yapÄ±lamamalÄ±.
   - `succeeded`, `failed`, `cancelled` job tekrar Ã§alÄ±ÅŸtÄ±rÄ±lamamalÄ±.
   - `started_at` doÄŸru set edilmeli.
   - AynÄ± collection iÃ§in ikinci `queued/running` job engeli korunmalÄ±.
   - `failStaleJobs` hem `queued` hem `running` joblarÄ± fail edebilmeli ve active pointer varsa collection status'u tekrar `ready`, yoksa `failed` yapmalÄ±.
3. Version/physical target uniqueness dÃ¼zelt:
   - `createVersionString` veya job target Ã¼retiminde saniye hassasiyetine baÄŸlÄ± Ã§akÄ±ÅŸma riskini kaldÄ±r.
   - AynÄ± collection iÃ§in iki baÅŸarÄ±lÄ± job kÄ±sa aralÄ±kla oluÅŸturulursa target physical collection adlarÄ± farklÄ± olmalÄ±.
   - Ã‡Ã¶zÃ¼m olarak timestamp'e milisaniye ekleyebilir veya physical name suffix'ine job id/random parÃ§asÄ± dahil edebilirsin.
   - Testlerde `setTimeout(1050)` gibi yapay bekleme kalmamalÄ±.
4. `src/indexing/jobs.ts` gÃ¼ncelle:
   - `runIndexJob` build baÅŸlamadan Ã¶nce registry'de job'Ä± `running` yapmalÄ±.
   - Job bulunamazsa veya terminal state'teyse aÃ§Ä±k hata vermeli.
   - Build baÅŸarÄ±sÄ±z olursa `failIndexJob` Ã§aÄŸrÄ±sÄ± korunmalÄ±.
   - BaÅŸarÄ±lÄ± olursa `completeIndexJob` Ã§aÄŸrÄ±sÄ± korunmalÄ±.
   - Bu promptta eski physical collection cleanup iÅŸini deÄŸiÅŸtirme; Prompt 9 bunu retention modeline taÅŸÄ±yacak. Sadece job lifecycle'Ä± dÃ¼zelt.
5. Job runner dependency ekle:
   - `src/indexing/jobRunner.ts` veya benzeri bir modÃ¼l oluÅŸtur.
   - `createIndexJobRunner({ registry, runtimeConfig, log })` export et.
   - Runner `start(jobId)` veya `enqueue(jobId)` ile job'Ä± background Ã§alÄ±ÅŸtÄ±rmalÄ± ve promise'i internal olarak track etmeli.
   - `drain()` ve `shutdown()` gibi test/server teardown iÃ§in kullanÄ±labilecek methodlar ekle.
   - Bu in-memory tracking lock yerine geÃ§memeli; sadece process iÃ§indeki background promise lifecycle'Ä±nÄ± yÃ¶netmeli. Writer lock/source of truth SQLite registry olarak kalmalÄ±.
6. `src/app.ts` ve `src/server.ts` dependency wiring'i gÃ¼ncelle:
   - `AppDependencies` iÃ§ine `jobRunner?: IndexJobRunner` ekle.
   - `src/server.ts` registry ve runtime config ile job runner oluÅŸtursun, `createApp({ registry, jobRunner })` versin.
7. `src/http/adminRouter.ts` gÃ¼ncelle:
   - Reindex route dynamic import ile `runIndexJob` Ã§aÄŸÄ±rmasÄ±n.
   - `deps.jobRunner.start(job.id)` veya eÅŸdeÄŸer runner methodunu kullansÄ±n.
   - Testlerde fake/noop runner inject edilebilir olmalÄ±.
   - Runner yoksa aÃ§Ä±k `500 INTERNAL_ERROR` dÃ¶nsÃ¼n; sessizce job baÅŸlatmadan 202 dÃ¶nme.
8. API testlerini dÃ¼zelt:
   - `test/api.endpoints.test.ts` gerÃ§ek Chroma/data source gerektiren background job baÅŸlatmamalÄ±.
   - Test iÃ§in fake job runner kullan ve duplicate reindex davranÄ±ÅŸÄ±nÄ± registry state Ã¼zerinden deterministik test et.
   - Test teardown Ã¶ncesi runner `drain()`/`shutdown()` Ã§aÄŸÄ±r.
9. Unit test ekle/gÃ¼ncelle:
   - Job `queued -> running -> succeeded`.
   - `startedAt` set ediliyor.
   - Terminal job tekrar Ã§alÄ±ÅŸtÄ±rÄ±lamÄ±yor.
   - AynÄ± collection iÃ§in active job varken ikinci job engelleniyor.
   - AynÄ± saniye iÃ§inde ardÄ±ÅŸÄ±k iki job target physical name Ã§akÄ±ÅŸmÄ±yor.
   - Eski `setTimeout(1050)` tabanlÄ± test kaldÄ±rÄ±lÄ±yor.

Dikkat:
- JSON registry veya in-memory writer lock ekleme.
- Eski `/rag/query` ve `/rag/retrieve` endpointlerini geri ekleme.
- Worker tracking in-memory olabilir ama lock ve job state mutlaka SQLite registry'de kalmalÄ±.
- Build kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Job lifecycle state akÄ±ÅŸÄ±nÄ± Ã¶zetle.
- Fire-and-forget/dynamic import davranÄ±ÅŸÄ±nÄ±n nasÄ±l deÄŸiÅŸtiÄŸini belirt.
- Same-second physical name Ã§akÄ±ÅŸma riskinin nasÄ±l kapatÄ±ldÄ±ÄŸÄ±nÄ± yaz.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 8: Job Lifecycle, Worker Safety, and Version Uniqueness" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 9: Zero-Downtime Retention Cleanup and Chroma Configuration Fidelity

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin Prompt 8 sonrasÄ± reindex akÄ±ÅŸÄ±nÄ± gerÃ§ek zero-downtime modeline yaklaÅŸtÄ±rmak, eski physical Chroma collection'larÄ± hemen silmek yerine retention/cleanup state'i ile yÃ¶netmek ve Chroma create configuration davranÄ±ÅŸÄ±nÄ± registry ile uyumlu hale getirmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Chroma DokÃ¼manlarÄ±yla Uyum NotlarÄ±"
- "Zero-Downtime Index/Rebuild"
- "Index/Rebuild Path"
- "`src/collections/chromaCollections.ts`"
- "`src/indexing/buildPhysicalCollection.ts`"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 8'in tamamlandÄ±ÄŸÄ±nÄ± ve job lifecycle notlarÄ±nÄ± kontrol et.

Bu prompt, Prompt 8'in tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `markIndexJobRunning` veya eÅŸdeÄŸer running transition var mÄ±?
- Reindex route job runner dependency kullanÄ±yor mu?
- Same-second target name Ã§akÄ±ÅŸma riski giderilmiÅŸ mi?
Eksikse kod yazmadan raporla.

Bilinen mevcut riskler:
- BaÅŸarÄ±lÄ± rebuild sonrasÄ± eski active physical collection hemen siliniyor. Bu, request baÅŸÄ±nda eski physical collection'a baÄŸlanan in-flight query/retrieve isteklerini kÄ±rabilir.
- Registry `chromaCollectionConfiguration` saklÄ±yor ama physical collection creation sadece `distanceMetric` Ã¼zerinden `configuration.hnsw.space` kuruyor; registry'deki configuration source of truth olarak tam kullanÄ±lmÄ±yor.
- `createPhysicalChromaCollection` dÄ±ÅŸarÄ±dan gelen name'i kendi iÃ§inde validate etmiyor.

AmaÃ§:
Pointer swap sonrasÄ± eski physical collection'lar retention sÃ¼resi dolmadan silinmesin. Cleanup ayrÄ±, retry edilebilir ve test edilebilir olsun. Physical Chroma collection creation registry'deki configuration ile uyumlu olsun.

YapÄ±lacaklar:
1. Registry storage modelini geniÅŸlet:
   - `collection_versions`, `physical_collections` veya benzeri bir tablo ekle. Ä°sim repo stiline gÃ¶re seÃ§ilebilir.
   - En az ÅŸu alanlarÄ± tut:
     - `name`
     - `tenant_id`
     - `collection_id`
     - `version`
     - `status`: `building | active | retired | delete_pending | deleted | cleanup_failed`
     - `chroma_configuration_json`
     - `document_count`
     - `chunk_count`
     - `created_at`
     - `activated_at`
     - `retired_at`
     - `delete_after`
     - `deleted_at`
     - `cleanup_error`
   - Mevcut `collections.active_physical_collection` ve `active_version` alanlarÄ± source of truth olarak kalabilir; yeni tablo version/cleanup audit iÃ§in kullanÄ±lmalÄ±.
2. Config'e cleanup retention ayarÄ± ekle:
   - `config/rag.config.yaml` iÃ§ine Ã¶rn. `cleanup.retentionMs` veya `indexing.cleanupRetentionMs`.
   - `src/config.ts` schema ve `ResolvedConfig` iÃ§inde defaultlu ÅŸekilde doÄŸrula.
   - VarsayÄ±lan lokal geliÅŸtirme iÃ§in kÄ±sa ama gÃ¼venli olabilir; Ã¶rn. `3600000` ms. Testlerde override edilebilir olmalÄ±.
3. `completeIndexJob` akÄ±ÅŸÄ±nÄ± gÃ¼ncelle:
   - Yeni physical collection version kaydÄ± `active` olsun.
   - Ã–nceki active physical collection hemen silinmesin.
   - Ã–nceki active physical collection varsa registry'de `retired/delete_pending` durumuna alÄ±nsÄ±n ve `delete_after = now + retentionMs` set edilsin.
   - Pointer swap transaction iÃ§inde atomik kalmalÄ±.
4. `src/indexing/jobs.ts` iÃ§indeki immediate cleanup'Ä± kaldÄ±r:
   - BaÅŸarÄ±lÄ± job sonrasÄ± `deletePhysicalChromaCollection` doÄŸrudan Ã§aÄŸrÄ±lmamalÄ±.
   - Cleanup ayrÄ± servis/fonksiyon Ã¼zerinden yapÄ±lmalÄ±.
5. Cleanup service ekle:
   - `src/indexing/cleanup.ts` veya `src/collections/cleanup.ts`.
   - `cleanupRetiredPhysicalCollections({ registry, runtimeConfig, now, limit, log })`.
   - Registry'den `delete_after <= now` olan due physical collection'larÄ± listele.
   - Chroma'dan delete dene.
   - BaÅŸarÄ±lÄ± olursa registry status `deleted`.
   - Missing collection delete baÅŸarÄ±lÄ± kabul edilebilir.
   - Hata olursa `cleanup_failed` ve error kaydÄ± bÄ±rak; tekrar denenebilir olmalÄ±.
6. Server startup davranÄ±ÅŸÄ±:
   - Ä°stersen startup'ta bir kez due cleanup Ã§alÄ±ÅŸtÄ±rabilirsin.
   - Uzun sÃ¼reli interval ekleyeceksen testlerde kapatÄ±labilir olmalÄ±.
   - Testlerin kapanmasÄ±nÄ± engelleyen interval bÄ±rakma.
7. Chroma configuration fidelity:
   - `src/collections/chromaCollections.ts` iÃ§inde create request builder veya helper ekle:
     - `buildCreateCollectionRequest({ name, chromaConfiguration })`
   - Name validation iÃ§in `assertValidChromaCollectionName(name)` Ã§aÄŸÄ±r.
   - Registry'de saklanan `chromaCollectionConfiguration` create request'te kullanÄ±lmalÄ±.
   - Default configuration `{ hnsw: { space: collection.distanceMetric } }` registry collection create sÄ±rasÄ±nda Ã¼retilmeli.
   - EÄŸer custom configuration yoksa distanceMetric ile HNSW space tutarlÄ± olmalÄ±.
8. `src/indexing/buildPhysicalCollection.ts` gÃ¼ncelle:
   - `createPhysicalChromaCollection` Ã§aÄŸrÄ±sÄ± collection'Ä±n `chromaCollectionConfiguration` deÄŸerini kullanmalÄ±.
   - `distanceMetric` sadece default config Ã¼retimi veya validation iÃ§in kullanÄ±lmalÄ±.
9. Tests:
   - BaÅŸarÄ±lÄ± rebuild sonrasÄ± eski physical collection hemen `deletePhysicalChromaCollection` ile silinmiyor.
   - Retention sÃ¼resi dolmadan cleanup silmiyor.
   - Retention sÃ¼resi dolunca cleanup due collection'Ä± siliyor ve registry status `deleted` oluyor.
   - Cleanup delete hata verirse registry `cleanup_failed` ve error tutuyor.
   - Build edilen physical collection create request `configuration.hnsw.space` deÄŸerini registry `distanceMetric` deÄŸerinden alÄ±yor.
   - Custom `chromaCollectionConfiguration` create request'e taÅŸÄ±nÄ±yor.
   - Invalid physical collection name helper seviyesinde fail ediyor.
   - FarklÄ± collection'lar aynÄ± anda queued/running rebuild job sahibi olabiliyor; aynÄ± collection iÃ§in tek active job kuralÄ± korunuyor.

Dikkat:
- Zero-downtime davranÄ±ÅŸÄ± iÃ§in eski physical collection'Ä± immediate delete etme.
- Cleanup source of truth registry olmalÄ±; Chroma `listCollections()` tek baÅŸÄ±na Ã¼rÃ¼n state'i gibi kullanÄ±lmamalÄ±.
- Chroma docs'a gÃ¶re HNSW ayarlarÄ± metadata deÄŸil `configuration` altÄ±nda kurulmalÄ±.
- Build/test gerÃ§ek Chroma servisinin ayakta olmasÄ±na baÄŸlÄ± olmamalÄ±; create request/config testleri mÃ¼mkÃ¼nse pure unit veya mock ile yazÄ±lmalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Immediate cleanup'Ä±n kaldÄ±rÄ±ldÄ±ÄŸÄ±nÄ± ve retention modelinin nasÄ±l Ã§alÄ±ÅŸtÄ±ÄŸÄ±nÄ± anlat.
- Chroma create configuration'Ä±n registry ile nasÄ±l hizalandÄ±ÄŸÄ±nÄ± belirt.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 9: Zero-Downtime Retention Cleanup and Chroma Configuration Fidelity" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 10: Tenant Access, Registry-Aware Readiness, and Collection Capabilities

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin request context, tenant/access davranÄ±ÅŸÄ±, servis readiness ve collection-level readiness/capability sÃ¶zleÅŸmesini tamamlamak.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Son KullanÄ±cÄ± Collection'larÄ± Kolayca Bulabiliyor mu?"
- "Yeni Endpoint KontratlarÄ±"
- "HTTP Hata KodlarÄ±"
- "Query/Retrieve Path"
- "Readiness ve Healthcheck"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 8 ve Prompt 9 sonrasÄ±nda job lifecycle, cleanup ve Chroma configuration deÄŸiÅŸikliklerini kontrol et.

Bu prompt, Prompt 8-9'un tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- Job runner dependency var mÄ±?
- Registry active job sorgusu veya eÅŸdeÄŸeri var mÄ±?
- Retention cleanup immediate delete yerine registry state kullanÄ±yor mu?
Eksikse kod yazmadan raporla.

Bilinen mevcut riskler:
- `COLLECTION_FORBIDDEN` error code var ama pratikte Ã¼retilmiyor.
- `/ready` registry reachable kontrolÃ¼ yapmÄ±yor.
- `GET /v1/rag/collections` capability hesabÄ± sadece `status === "ready"` Ã¼zerinden yapÄ±lÄ±yor; active physical varsa rebuild sÄ±rasÄ±nda query devam edebilmeli.
- `GET /v1/rag/collections/:id/ready` active job bilgisini ve rebuild sÄ±rasÄ±nda query/retrieve capability ayrÄ±mÄ±nÄ± yeterince gÃ¶stermiyor.

AmaÃ§:
GerÃ§ek auth sistemi eklemeden development iÃ§in merkezi, test edilebilir tenant/user context kur. Registry eriÅŸimini tenant scoped tut, forbidden/missing ayrÄ±mÄ±nÄ± tek helper'da Ã§Ã¶z, readiness endpointlerini planla uyumlu hale getir.

YapÄ±lacaklar:
1. `src/http/requestContext.ts` gÃ¼ncelle:
   - VarsayÄ±lanlar korunmalÄ±: `tenantId = "default"`, `userId = "local-dev"`.
   - Development/test iÃ§in header desteÄŸi ekle:
     - `x-tenant-id`
     - `x-user-id`
     - `x-request-id`
   - Header deÄŸerlerini trim et, boÅŸsa default kullan.
   - Request id yoksa Ã¼ret.
   - Bu gerÃ§ek auth deÄŸildir; sadece backend boundary ve test edilebilir tenant scoping iÃ§indir.
2. Registry access helper ekle:
   - `resolveReadableCollection` iÃ§inde veya ayrÄ± `resolveCollectionAccess` helper olarak yapÄ±labilir.
   - AkÄ±ÅŸ:
     1. collectionId path parametresini validate et.
     2. `getVisibleCollection(context, collectionId)` ile tenant scoped lookup yap.
     3. Bulunursa devam et.
     4. Bulunmazsa registry'de aynÄ± id herhangi bir tenant altÄ±nda var mÄ± diye gÃ¼venli access check yap.
     5. Varsa `403 COLLECTION_FORBIDDEN`.
     6. Yoksa `404 COLLECTION_NOT_FOUND`.
   - Bunun iÃ§in `CollectionRegistry` interface'ine `collectionExists(collectionId)` veya `getCollectionAccessState(context, collectionId)` gibi method ekleyebilirsin.
   - Bu helper bÃ¼tÃ¼n RAG route'larÄ±nda kullanÄ±lmalÄ±; controller iÃ§inde kopyalanmamalÄ±.
3. `src/http/errors.ts` gÃ¼ncelle:
   - `COLLECTION_FORBIDDEN` gerÃ§ek route path'lerinden dÃ¶nebilmeli.
   - `ANSWER_NOT_IN_RETRIEVED_CONTEXT` ve `DISALLOWED_FALLBACK_ANSWER` gibi RAG error code'larÄ± type/response contract iÃ§inde tutarlÄ± olsun.
4. `/ready` registry-aware olsun:
   - Registry iÃ§in `healthCheck()` / `ping()` / basit `SELECT 1` methodu ekle.
   - `/ready` payload'Ä±nda `dependencies.registry` alanÄ± olsun.
   - Registry unreachable ise `indexReady` ve `queryReady` blocking fail olmalÄ±.
   - Default collection yok diye fail olmasÄ±n.
   - `?strict=true` davranÄ±ÅŸÄ± korunmalÄ±.
5. `GET /v1/rag/collections` capability hesabÄ±nÄ± dÃ¼zelt:
   - Collection status `indexing` olsa bile `activePhysicalCollection` varsa query/retrieve capability true olabilir.
   - Ä°lk indexing sÄ±rasÄ±nda active yoksa query/retrieve false olmalÄ±.
   - List endpoint Chroma'ya her collection iÃ§in count atmak zorunda deÄŸil; hÄ±zlÄ± list iÃ§in registry state yeterli olabilir.
   - Response iÃ§inde `hasActiveVersion` veya `activeVersion` zaten varsa capability bunu yansÄ±tmalÄ±.
6. `GET /v1/rag/collections/:collectionId/ready` endpointini tamamla:
   - Access/missing/forbidden helper kullan.
   - Response ÅŸu alanlarÄ± iÃ§ermeli:
     - `id`
     - `status`
     - `activeVersion`
     - `activePhysicalCollection`
     - `indexing` veya `activeJob`
     - `chromaReadable`
     - `chromaCount`
     - `capabilities.query`
     - `capabilities.retrieve`
     - `capabilities.reindex`
   - Active physical readable ise collection status `indexing` olsa da query/retrieve true olmalÄ±.
   - Active physical yok ve active job varsa query/retrieve false, indexing true.
7. Query/retrieve resolve davranÄ±ÅŸÄ±nÄ± doÄŸrula:
   - Rebuild sÄ±rasÄ±nda active physical varsa query/retrieve eski active physical ile devam etmeli.
   - Active physical yok ve status/index job varsa `503 COLLECTION_INDEXING`.
   - Active physical yok ve job yoksa `404 COLLECTION_NOT_READY`.
8. Tests:
   - Default context ile mevcut testler kÄ±rÄ±lmamalÄ±.
   - `x-tenant-id` ile farklÄ± tenant collection'larÄ± listelenmez.
   - BaÅŸka tenant'a ait bilinen collection id iÃ§in query/retrieve `403 COLLECTION_FORBIDDEN`.
   - Bilinmeyen collection id iÃ§in `404 COLLECTION_NOT_FOUND`.
   - `/ready?details=true` registry dependency alanÄ± dÃ¶ner.
   - Registry ping fail ederse `/ready?strict=true` 503 dÃ¶ner. Bunun iÃ§in fake registry veya kapatÄ±lmÄ±ÅŸ SQLite baÄŸlantÄ±sÄ± kullanÄ±labilir.
   - Collection `indexing` ama active physical varsa list/ready capabilities query/retrieve true olur.
   - Ä°lk indexing sÄ±rasÄ±nda active physical yoksa ready capabilities query/retrieve false olur.

Dikkat:
- Full authentication/authorization sistemi ekleme. Bu prompt sadece merkezi context ve tenant-scoped registry boundary kurar.
- 403 davranÄ±ÅŸÄ± sadece collection id registry'de var ama current tenant'a gÃ¶rÃ¼nmÃ¼yorsa dÃ¶nmeli.
- Eski endpointleri geri ekleme.
- Build/test kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Request context ve tenant header davranÄ±ÅŸÄ±nÄ± Ã¶zetle.
- `/ready` ve collection ready contract'Ä±nÄ±n nasÄ±l deÄŸiÅŸtiÄŸini belirt.
- 403/404 ayrÄ±mÄ±nÄ± aÃ§Ä±kÃ§a yaz.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 10: Tenant Access, Registry-Aware Readiness, and Collection Capabilities" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 11: Acceptance Tests, Test Isolation, and External-Service Boundaries

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin test suite'i planÄ±n kabul kriterlerini gerÃ§ekten kanÄ±tlayacak hale getirmek ve normal `npm test` komutunu Chroma/Ollama gibi dÄ±ÅŸ servislerin ayakta olmasÄ±na baÄŸÄ±mlÄ± olmaktan Ã§Ä±karmaktÄ±r.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Test Kabul Kriterleri"
- "Query/Retrieve Path"
- "Index/Rebuild Path"
- "Readiness ve Healthcheck"
- "Ollama ve Chroma Backpressure"
- "Coding Agent Ã‡alÄ±ÅŸma SÄ±rasÄ±"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 8-10 sonrasÄ±nda job runner, cleanup, tenant access ve readiness deÄŸiÅŸikliklerini dikkate al.

Bu prompt, Prompt 8-10'un tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- `npm.cmd test` mevcut durumda geÃ§iyor mu?
- Test Ã§Ä±ktÄ±sÄ±nda background job, Chroma veya Ollama kaynaklÄ± beklenmeyen log/error var mÄ±?
- `test/rag.test.ts` veya API testleri gerÃ§ek Chroma/Ollama servisine baÄŸÄ±mlÄ± mÄ±?
Eksik veya flaky davranÄ±ÅŸ varsa Ã¶nce bunu raporla, sonra dÃ¼zelt.

AmaÃ§:
Unit ve endpoint testleri deterministik, hÄ±zlÄ± ve dÄ±ÅŸ servis baÄŸÄ±msÄ±z olmalÄ±. GerÃ§ek Chroma/Ollama smoke testleri gerekiyorsa opsiyonel integration test olarak ayrÄ±lmalÄ±.

YapÄ±lacaklar:
1. Test dependency injection sÄ±nÄ±rlarÄ±nÄ± iyileÅŸtir:
   - `createApp` testlerde runtime config, registry, jobRunner ve RAG/chroma service fake'leri ile Ã§alÄ±ÅŸabilecek ÅŸekilde geniÅŸletilebilir.
   - BÃ¼yÃ¼k mimari bozma; sadece test edilebilirlik iÃ§in aÃ§Ä±k dependency boundary ekle.
   - Production path varsayÄ±lan gerÃ§ek implementation'Ä± kullanmalÄ±.
2. Chroma/Ollama dÄ±ÅŸ servis baÄŸÄ±mlÄ±lÄ±ÄŸÄ±nÄ± normal testlerden kaldÄ±r:
   - `test/rag.test.ts` gerÃ§ek Chroma'ya baÄŸlanÄ±yorsa mock/fake helper ile deÄŸiÅŸtir.
   - `npm.cmd test` Chroma/Ollama kapalÄ±yken de geÃ§meli.
   - GerÃ§ek servis gerektiren test varsa `test/integration/*.test.ts` altÄ±na taÅŸÄ± ve `RUN_INTEGRATION=1` gibi env flag olmadan Ã§alÄ±ÅŸtÄ±rma.
   - `package.json` iÃ§inde gerekirse ayrÄ± script ekle:
     - `test:integration`
3. Acceptance testleri tamamla:
   - `GET /v1/rag/collections` sadece current tenant visible logical collection'larÄ± listeler.
   - Registry'de olmayan collection iÃ§in Chroma'da yeni boÅŸ collection oluÅŸmaz; fake Chroma create Ã§aÄŸrÄ±lmadÄ±ÄŸÄ±nÄ± doÄŸrula.
   - Ãœretilen physical collection adlarÄ± Chroma ad kurallarÄ±na uyar.
   - Build edilen physical collection create request'i `configuration.hnsw.space` deÄŸerini registry `distanceMetric` veya registry config'ten alÄ±r.
   - Bilinmeyen `collectionId` iÃ§in query/retrieve `404 COLLECTION_NOT_FOUND`.
   - Yetkisiz collection iÃ§in `403 COLLECTION_FORBIDDEN`.
   - Aktif sÃ¼rÃ¼mÃ¼ olmayan ve indexing sÃ¼ren collection iÃ§in `503 COLLECTION_INDEXING`.
   - Rebuild sÄ±rasÄ±nda Ã¶nceki aktif sÃ¼rÃ¼m varsa query/retrieve eski active physical collection ile baÅŸarÄ±lÄ± Ã§alÄ±ÅŸÄ±r.
   - AynÄ± collection iÃ§in iki rebuild isteÄŸinden ikincisi `409 COLLECTION_INDEX_ALREADY_RUNNING`.
   - FarklÄ± collection'lar aynÄ± anda rebuild edilebilir.
   - Rebuild baÅŸarÄ±sÄ±z olursa Ã¶nceki active pointer deÄŸiÅŸmeden kalÄ±r.
   - `GET /v1/rag/collections/:collectionId/ready` collection bazlÄ± doÄŸru readiness verir.
   - Oversized JSON body structured JSON error dÃ¶ner.
   - Eski `/rag/query` ve `/rag/retrieve` public API yÃ¼zeyinde yok.
4. Testlerde background lifecycle temizliÄŸi:
   - API testleri job runner `drain()` veya fake runner ile kapanmalÄ±.
   - Test sonunda kapalÄ± SQLite connection'a yazmaya Ã§alÄ±ÅŸan background job logu kalmamalÄ±.
5. Backpressure/timeout testleri:
   - Semaphore limitleri deterministik kÃ¼Ã§Ã¼k config ile test edilmeli.
   - Limit/timeout durumunda `503 MODEL_BACKPRESSURE` mapping'i test edilmeli.
   - Bu test gerÃ§ek Ollama Ã§aÄŸÄ±rmamalÄ±.
6. Docs/static contract testleri:
   - README ve test frontend eski endpointleri aktif kullanÄ±m olarak iÃ§ermiyor mu test et.
   - Bu promptta architecture docs temizliÄŸini tamamen yapman gerekmiyor; Prompt 12 bunu detaylandÄ±racak. Ama test helper'Ä± kurulabilir.

Dikkat:
- Testleri yeÅŸil yapmak iÃ§in plan davranÄ±ÅŸÄ±nÄ± gevÅŸetme.
- GerÃ§ek Chroma/Ollama gerektiren normal unit test bÄ±rakma.
- Fake'ler production code path'e fallback olarak sÄ±zmamalÄ±.
- Eski endpointleri geri ekleme.

DoÄŸrulama:
1. Chroma/Ollama kapalÄ±yken `npm.cmd run build`
2. Chroma/Ollama kapalÄ±yken `npm.cmd test`
3. EÄŸer integration script eklediysen ve servisler lokal ayaktaysa opsiyonel:
   - `npm.cmd run test:integration`

Final cevapta:
- Normal test suite'in hangi dÄ±ÅŸ servislerden baÄŸÄ±msÄ±z hale geldiÄŸini belirt.
- KapatÄ±lan acceptance kriterlerini listele.
- Opsiyonel integration test varsa nasÄ±l Ã§alÄ±ÅŸtÄ±rÄ±lacaÄŸÄ±nÄ± yaz.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 11: Acceptance Tests, Test Isolation, and External-Service Boundaries" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 12: Documentation, Frontend Contract, and Architecture Cleanup

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin Prompt 1-11 sonrasÄ± dokÃ¼mantasyon, test frontend ve mimari metinlerde kalan eski single-collection/destructive reset anlatÄ±mlarÄ±nÄ± temizlemek ve kullanÄ±cÄ± akÄ±ÅŸÄ±nÄ± yeni multi-collection backend sÃ¶zleÅŸmesiyle tutarlÄ± hale getirmek.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Son KullanÄ±cÄ± Collection'larÄ± Kolayca Bulabiliyor mu?"
- "Yeni Endpoint KontratlarÄ±"
- "Faz 6: Test Frontend ve DokÃ¼mantasyon"
- "Readiness ve Healthcheck"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 8-11 sonrasÄ± gerÃ§ek endpoint, readiness, cleanup ve test sÃ¶zleÅŸmelerini dikkate al.

Bu prompt, Prompt 11'in tamamlandÄ±ÄŸÄ±nÄ± varsayar. BaÅŸlamadan Ã¶nce kontrol et:
- README, `vanilla_rag_backend_mimarisi.md`, `test_frontend/index.html` ve varsa onboarding dokÃ¼manlarÄ±nda eski `/rag/query`, `/rag/retrieve`, `chroma.collection`, `data.indexSampleSize`, destructive reset anlatÄ±mlarÄ± var mÄ±?
- `npm.cmd test` mevcut durumda geÃ§iyor mu?
Eksik veya Ã§eliÅŸkili implementation varsa dokÃ¼mana yanlÄ±ÅŸ bilgi yazmadan Ã¶nce raporla.

AmaÃ§:
DokÃ¼manlar ve test frontend artÄ±k repo gerÃ§ekliÄŸini doÄŸru anlatsÄ±n: logical collection registry, public collectionId, versioned physical Chroma collection, retention cleanup, registry-aware readiness, tenant-scoped list/query ve yeni `/v1` endpointleri.

YapÄ±lacaklar:
1. README gÃ¼ncelle:
   - Eski active endpoint olarak `/rag/query` ve `/rag/retrieve` anlatÄ±mÄ± kalmamalÄ±.
   - `chroma.collection` config Ã¶rneÄŸi kalmamalÄ±.
   - `data.indexSampleSize` yerine yeni config path'i kullanÄ±lmalÄ±: `collectionDefaults.indexSampleSize`.
   - Collection create, reindex job, job status, list, collection ready, retrieve, query Ã¶rnekleri gÃ¼ncel olmalÄ±.
   - Rebuild sÄ±rasÄ±nda active version varsa query/retrieve'in eski active physical collection'dan devam ettiÄŸi aÃ§Ä±klanmalÄ±.
   - Eski physical collection cleanup'Ä±n retention sonrasÄ± yapÄ±ldÄ±ÄŸÄ± aÃ§Ä±klanmalÄ±.
   - Normal `npm test` dÄ±ÅŸ servis gerektirmiyorsa bunu belirt; integration test varsa ayrÄ± anlat.
2. `vanilla_rag_backend_mimarisi.md` gÃ¼ncelle:
   - Aktif mimariyi anlatan bÃ¶lÃ¼mlerde eski `/rag/query`, `/rag/retrieve` endpointleri kalmamalÄ±.
   - Destructive "Chroma collection resetlenir/silinir/baÅŸtan yazÄ±lÄ±r" anlatÄ±mÄ± aktif akÄ±ÅŸ gibi kalmamalÄ±.
   - Yeni akÄ±ÅŸ ÅŸu sÄ±rayla anlatÄ±lmalÄ±:
     1. logical collection registry kaydÄ±
     2. reindex job
     3. yeni versioned physical Chroma collection
     4. build/readability check
     5. registry pointer swap
     6. retention cleanup
   - `/ready` ve `/v1/rag/collections/:id/ready` ayrÄ±mÄ± anlatÄ±lmalÄ±.
   - Tenant/access boundary ve `403 COLLECTION_FORBIDDEN` davranÄ±ÅŸÄ± anlatÄ±lmalÄ±.
3. `notes/onboardin_plan.md` veya baÅŸka onboarding notlarÄ± gÃ¼ncel davranÄ±ÅŸla Ã§eliÅŸiyorsa:
   - Ya gÃ¼ncelle.
   - Ya da dosyanÄ±n en Ã¼stÃ¼ne aÃ§Ä±kÃ§a "legacy plan / gÃ¼ncel deÄŸil" notu koy ve gÃ¼ncel README'ye yÃ¶nlendir.
4. `test_frontend/index.html` iyileÅŸtir:
   - Collection list/dropdown mevcut kalmalÄ±.
   - Collection yoksa query/retrieve butonlarÄ± pasif olmalÄ± ve kullanÄ±cÄ±ya collection oluÅŸturma/reindex iÃ§in admin API yÃ¶nÃ¼ gÃ¶sterilmeli.
   - Collection status/readiness sonucu active job, activeVersion, chromaCount ve capabilities alanlarÄ±nÄ± gÃ¶steriyorsa gÃ¼ncel response contract ile uyumlu olmalÄ±.
   - Eski endpoint stringleri kalmamalÄ±.
   - Gerekirse admin create/reindex butonu ekleyebilirsin, ancak test frontend'i production admin UI'a Ã§evirmeye Ã§alÄ±ÅŸma; amaÃ§ smoke/debug kolaylÄ±ÄŸÄ±.
5. Static/docs contract testleri ekle/gÃ¼ncelle:
   - `test/frontend.static.test.ts` sadece quoted string aramakla kalmasÄ±n; `/rag/query` ve `/rag/retrieve` aktif fetch/action olarak kalmadÄ±ÄŸÄ±nÄ± yakalasÄ±n.
   - `test/docs.contract.test.ts` ekle:
     - README iÃ§inde aktif endpoint olarak `/rag/query` veya `/rag/retrieve` geÃ§mesin.
     - README iÃ§inde `chroma.collection` ve `data.indexSampleSize` stale config path'i geÃ§mesin.
     - Architecture doc iÃ§inde eski endpointler varsa sadece "legacy/removed" baÄŸlamÄ±nda geÃ§sin; mÃ¼mkÃ¼nse tamamen temizle.
   - `notes/multicollection.md` ve `notes/prompts.md` tarihsel plan/prompt dosyalarÄ± olduÄŸu iÃ§in bu testlerin kapsamÄ± dÄ±ÅŸÄ±nda kalabilir.
6. Smoke flow'u doÄŸrula:
   - README'deki PowerShell Ã¶rnekleri syntactically tutarlÄ± olsun.
   - Endpoint path'leri gerÃ§ek route'larla eÅŸleÅŸsin.

Dikkat:
- DokÃ¼manda implementation'da olmayan Ã¶zelliÄŸi tamamlanmÄ±ÅŸ gibi anlatma.
- Eski endpointleri "kullanÄ±labilir fallback" gibi gÃ¶stermeme.
- Migration/backward compatibility anlatÄ±mÄ± ekleme; proje henÃ¼z kullanÄ±lmÄ±yor ve hedef doÄŸru yeni mimari.
- Build/test kÄ±rÄ±k kalmamalÄ±.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. Manuel olarak README smoke komutlarÄ±nÄ± gÃ¶zden geÃ§ir; dÄ±ÅŸ servis Ã§alÄ±ÅŸtÄ±rman gerekiyorsa bunu finalde aÃ§Ä±kÃ§a belirt.

Final cevapta:
- Temizlenen dokÃ¼manlarÄ± ve frontend contract deÄŸiÅŸikliklerini listele.
- Eski endpoint/config/destructive reset anlatÄ±mlarÄ±nÄ±n temizlendiÄŸini belirt.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 12: Documentation, Frontend Contract, and Architecture Cleanup" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 13: Final Multi-Collection Audit and Release Gate

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin Prompt 1-12 sonrasÄ± son kalite kapÄ±sÄ±nÄ± Ã§alÄ±ÅŸtÄ±rmak: implementation'Ä± notes/multicollection.md planÄ± ve test kabul kriterleriyle birebir karÅŸÄ±laÅŸtÄ±r, eksik varsa kÃ¼Ã§Ã¼k dÃ¼zeltmeleri yap, bÃ¼yÃ¼k eksik varsa kod yazmadan raporla.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± baÅŸtan sona oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "KÄ±sa Karar"
- "Mimari Etkinlik DeÄŸerlendirmesi"
- "Test Kabul Kriterleri"
- "Readiness ve Healthcheck"
- "Concurrency Stratejisi"
- "Fazlara BÃ¶lÃ¼nmÃ¼ÅŸ Uygulama PlanÄ±"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 1-12 boyunca ne yapÄ±ldÄ±ÄŸÄ±nÄ±, hangi risklerin kapandÄ±ÄŸÄ±nÄ± ve kalan notlarÄ± Ã§Ä±kar.

AmaÃ§:
Repo gerÃ§ekten multiple collection destekleyen RAG backend hedefini karÅŸÄ±lÄ±yor mu, bunu son kez doÄŸrula. Bu prompt Ã§oÄŸunlukla audit + kÃ¼Ã§Ã¼k contract dÃ¼zeltmeleri iÃ§indir; bÃ¼yÃ¼k mimari eksik bulursan bunu net raporla ve gerekiyorsa yeni prompt Ã¶ner.

YapÄ±lacaklar:
1. Plan karÅŸÄ±laÅŸtÄ±rmasÄ± yap:
   - Config shape.
   - Registry storage ve schema.
   - Public collection ID / physical Chroma name ayrÄ±mÄ±.
   - Chroma create configuration.
   - Query/retrieve resolve path.
   - Reindex job lifecycle.
   - Zero-downtime pointer swap.
   - Retention cleanup.
   - Registry-aware readiness.
   - Tenant/access/403 davranÄ±ÅŸÄ±.
   - Backpressure/timeouts.
   - Frontend collection discovery.
   - README/architecture docs.
2. Kod taramasÄ± yap:
   - `rg "chromaCollection|chroma.collection|/rag/query|/rag/retrieve|resetChromaCollection|data.indexSampleSize|rag.retrievalK"` ile stale referanslarÄ± kontrol et.
   - `notes/multicollection.md`, `notes/prompts.md` ve `notes/done.md` tarihsel/plan dosyalarÄ± olduÄŸu iÃ§in stale referanslarÄ± otomatik hata sayma; product docs/code/test/frontend iÃ§in deÄŸerlendir.
3. Testleri Ã§alÄ±ÅŸtÄ±r:
   - `npm.cmd run build`
   - `npm.cmd test`
   - EÄŸer integration test script'i varsa ve dÄ±ÅŸ servisler ayakta deÄŸilse Ã§alÄ±ÅŸtÄ±rma; finalde neden Ã§alÄ±ÅŸtÄ±rmadÄ±ÄŸÄ±nÄ± belirt.
4. KÃ¼Ã§Ã¼k eksik dÃ¼zeltmeleri yap:
   - Stale README path'i.
   - Test isimleri.
   - Error code type union eksikleri.
   - Missing docs/static contract test.
   - Obvious route response contract mismatch.
5. BÃ¼yÃ¼k eksik bulursan:
   - Yeni kod yazmadan Ã¶nce final raporda aÃ§Ä±kÃ§a belirt.
   - Hangi dosyada, hangi plan maddesine gÃ¶re eksik olduÄŸunu yaz.
   - Gerekirse "Prompt 14" iÃ§in kÄ±sa Ã¶neri bÄ±rak ama bu dosyaya otomatik yeni prompt eklemek zorunda deÄŸilsin.
6. Final acceptance checklist hazÄ±rla:
   - Her `notes/multicollection.md` test kabul kriteri iÃ§in `pass`, `partial`, `fail`, `not tested` durumu.
   - `partial/fail/not tested` varsa nedenini ve Ã¶nerilen fix'i yaz.
7. notes/done.md gÃ¼ncelle:
   - "Prompt 13: Final Multi-Collection Audit and Release Gate" baÅŸlÄ±ÄŸÄ± altÄ±nda audit sonucunu, kÃ¼Ã§Ã¼k dÃ¼zeltmeleri, komut sonuÃ§larÄ±nÄ± ve kalan riskleri yaz.

Dikkat:
- YeÅŸil testleri tek baÅŸÄ±na yeterli kabul etme; plan kabul kriterleriyle karÅŸÄ±laÅŸtÄ±r.
- Eski endpointleri geri ekleme.
- Compatibility/migration katmanÄ± ekleme.
- BÃ¼yÃ¼k refactor gerekiyorsa yarÄ±m yamalak implement etme; net raporla.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. Stale referans taramasÄ±:
   - `rg "chromaCollection|chroma.collection|/rag/query|/rag/retrieve|resetChromaCollection|data.indexSampleSize|rag.retrievalK" src test README.md vanilla_rag_backend_mimarisi.md test_frontend config`

Final cevapta:
- Repo multi-collection hedefi iÃ§in hazÄ±r mÄ±, doÄŸrudan "evet/hayÄ±r/kÄ±smen" diye cevapla.
- Acceptance checklist Ã¶zetini ver.
- Kalan riskleri Ã¶ncelik sÄ±rasÄ±yla listele.
- Test/build/stale-scan sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na final audit kaydÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 14: Job Version, Registry Invariants, and Physical Record Integrity

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin Prompt 1-13 sonrasÄ± kalan kritik job/version ve registry invariant aÃ§Ä±klarÄ±nÄ± kapatmaktÄ±r.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Zero-Downtime Index/Rebuild"
- "Index/Rebuild Path"
- "Registry ÅemasÄ±"
- "`src/indexing/jobs.ts`"
- "`src/indexing/buildPhysicalCollection.ts`"
- "Test Kabul Kriterleri"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 13 "her ÅŸey PASS" demiÅŸ olabilir; buna gÃ¼venme. Bu promptun amacÄ± repo kodunu gerÃ§ek davranÄ±ÅŸla doÄŸrulamak ve yanlÄ±ÅŸ PASS durumlarÄ±nÄ± dÃ¼zeltmektir.

BaÅŸlamadan Ã¶nce Ã¶zellikle ÅŸu dosyalarÄ± oku:
- `src/collections/sqliteRegistry.ts`
- `src/indexing/jobs.ts`
- `src/indexing/buildPhysicalCollection.ts`
- `src/indexing/cleanup.ts`
- `test/indexing.jobs.test.ts`
- `test/collections.registry.test.ts`

Bilinen mevcut sorunlar:
1. `createVersionString` iÃ§inde milisaniye `_` ile version string'e ekleniyor, ama `runIndexJob` ve `versionFromJobId` `job.id.split("_")[0]` kullanÄ±yor. Bu nedenle `activeVersion` ve chunk metadata'sÄ±ndaki `collectionVersion` tam version deÄŸerini kaybediyor.
2. `completeIndexJob` terminal/running state kontrolÃ¼ yapmadan job'Ä± succeeded yapabiliyor.
3. `completeIndexJob` yeni physical collection iÃ§in registry record gerÃ§ekten var mÄ± kontrol etmiyor; `UPDATE physical_collections ... WHERE name = ...` sÄ±fÄ±r satÄ±r gÃ¼ncellese bile baÅŸarÄ±lÄ± sayÄ±lÄ±yor.
4. Build baÅŸarÄ±sÄ±z olursa Chroma target best-effort siliniyor ama `physical_collections` registry kaydÄ± `building` halinde kalabiliyor.
5. Testlerde hÃ¢lÃ¢ `setTimeout(1050)` ile version Ã§akÄ±ÅŸmasÄ± saklanÄ±yor ve bazÄ± testler TypeScript aÃ§Ä±sÄ±ndan eksik parametrelerle registry methodu Ã§aÄŸÄ±rÄ±yor.

AmaÃ§:
Job id, version id, activeVersion, physical collection record ve cleanup state birbirinden kopmasÄ±n. Registry transaction'larÄ± sadece geÃ§erli state geÃ§iÅŸlerine izin versin.

YapÄ±lacaklar:
1. Version modelini dÃ¼zelt:
   - Job id iÃ§inden version parse etmek iÃ§in `_` delimiter'Ä±na gÃ¼venme.
   - Ya `index_jobs` tablosuna explicit `target_version` alanÄ± ekle, ya da delimiter olarak version iÃ§inde Ã¼retilemeyen gÃ¼venli bir ayraÃ§ kullan. Tercihen `target_version` kolonu ekle.
   - `IndexJob` type iÃ§ine `targetVersion` ekle.
   - `beginIndexJob` hem `targetVersion` hem `targetPhysicalCollection` Ã¼retmeli.
   - `runIndexJob` `targetVersion` deÄŸerini job'dan okumalÄ±.
   - `completeIndexJob` activeVersion iÃ§in job targetVersion deÄŸerini kullanmalÄ±.
   - Chunk metadata `collectionVersion` da aynÄ± exact version deÄŸerini taÅŸÄ±malÄ±.
2. Version formatÄ±nÄ± Chroma-safe ve parse-safe hale getir:
   - AynÄ± saniyede iki job oluÅŸturulduÄŸunda target physical collection adlarÄ± farklÄ± olmalÄ±.
   - Version string Chroma name kurallarÄ±na uygun kalmalÄ±.
   - EÄŸer timestamp + random suffix kullanÄ±yorsan, activeVersion bu exact string olmalÄ±.
3. Registry state invariantlarÄ±nÄ± sertleÅŸtir:
   - `markIndexJobRunning` sadece `queued -> running` geÃ§iÅŸine izin vermeli.
   - `completeIndexJob` sadece `running` job iÃ§in Ã§alÄ±ÅŸmalÄ±. `queued`, `failed`, `succeeded`, `cancelled` job tamamlanamamalÄ±.
   - `failIndexJob` terminal job Ã¼zerinde tekrar Ã§alÄ±ÅŸtÄ±rÄ±lmamalÄ± veya idempotent davranÄ±ÅŸÄ± aÃ§Ä±kÃ§a tasarlanmalÄ±; seÃ§tiÄŸin davranÄ±ÅŸÄ± testle.
   - `completeIndexJob` yeni physical collection record yoksa hata vermeli.
   - Yeni physical record `building -> active` geÃ§iÅŸi atomik transaction iÃ§inde yapÄ±lmalÄ±.
   - Eski active physical record yoksa ama old active pointer varsa bunu aÃ§Ä±k bir registry inconsistency olarak logla veya record yaratmadan delete_pending yapma. DavranÄ±ÅŸÄ± testle.
4. Failure cleanup registry state'ini dÃ¼zelt:
   - `runIndexJob` build baÅŸlamadan Ã¶nce physical record yaratÄ±yorsa, build fail olduÄŸunda target Chroma collection delete edildikten sonra registry record `deleted`, `cleanup_failed` veya `failed_build` benzeri net bir terminal state'e geÃ§meli.
   - Yeni status ekliyorsan `PhysicalCollectionStatus` type ve tests ile uyumlu yap.
   - `physical_collections` tablosunda sonsuza kadar `building` kalan failed build record bÄ±rakma.
5. `src/indexing/cleanup.ts` test edilebilir olsun:
   - `deletePhysicalChromaCollection` dependency injection ile fake edilebilir hale gelsin veya cleanup fonksiyonu opsiyonel `deletePhysicalCollection` callback alsÄ±n.
   - Normal production path varsayÄ±lan gerÃ§ek Chroma delete kullanmalÄ±.
6. Testleri gÃ¼Ã§lendir:
   - `queued -> running -> succeeded` ve `startedAt` set edildiÄŸini test et.
   - `completeIndexJob` queued job iÃ§in fail etmeli.
   - `completeIndexJob` physical record yoksa fail etmeli.
   - `runIndexJob` targetVersion'Ä± exact koruyor mu test et.
   - AynÄ± saniye iÃ§inde iki job target name ve targetVersion Ã§akÄ±ÅŸmÄ±yor mu test et; `setTimeout(1050)` kaldÄ±r.
   - Build failure sonrasÄ± physical record `building` kalmÄ±yor mu test et.
   - Retention sÃ¼resi dolmadan cleanup silmiyor, sÃ¼re dolunca fake delete Ã§aÄŸÄ±rÄ±yor ve registry `deleted` oluyor.
   - Cleanup delete hata verirse registry `cleanup_failed` ve error tutuyor.
7. Testlerde TypeScript hatasÄ± saklama:
   - Testlerde `CompleteIndexJobResult` iÃ§in gereken alanlarÄ± eksiksiz ver.
   - Runtime passing ama type-invalid test bÄ±rakma.

Dikkat:
- Migration/backward compatibility dÃ¼ÅŸÃ¼nme; proje henÃ¼z kullanÄ±lmÄ±yor. SQLite schema'yÄ± doÄŸru hedef hale getir.
- Eski `/rag/query` ve `/rag/retrieve` endpointlerini geri ekleme.
- JSON registry veya in-memory registry fallback ekleme.
- Physical Chroma collection adÄ±nÄ± public collectionId ile karÄ±ÅŸtÄ±rma.

DoÄŸrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. `npm.cmd run test:integration` yalnÄ±zca ortamda Chroma ayaktaysa; deÄŸilse neden Ã§alÄ±ÅŸtÄ±rmadÄ±ÄŸÄ±nÄ± finalde yaz.
4. Åu hÄ±zlÄ± smoke script ile activeVersion'Ä±n truncation yaÅŸamadÄ±ÄŸÄ±nÄ± doÄŸrula:
   - In-memory registry oluÅŸtur.
   - Collection oluÅŸtur.
   - Job baÅŸlat.
   - Job targetVersion ve targetPhysicalCollection deÄŸerlerini yazdÄ±r.
   - Job'Ä± valid physical record ile complete et.
   - Collection `activeVersion` exact targetVersion mÄ± kontrol et.

Final cevapta:
- Version parsing/truncation hatasÄ±nÄ±n nasÄ±l dÃ¼zeltildiÄŸini anlat.
- Registry state invariantlarÄ±nÄ± listele.
- Cleanup/physical record davranÄ±ÅŸÄ±nÄ± Ã¶zetle.
- Test/build sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 14: Job Version, Registry Invariants, and Physical Record Integrity" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 15: Acceptance Coverage, Test Typechecking, and Script Discipline

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin test suite'in planÄ±n kabul kriterlerini gerÃ§ekten kapsamasÄ±nÄ± saÄŸlamak ve testlerin TypeScript hatalarÄ±nÄ± saklamasÄ±nÄ± engellemektir.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Test Kabul Kriterleri"
- "Query/Retrieve Path"
- "Index/Rebuild Path"
- "Readiness ve Healthcheck"
- "Ollama ve Chroma Backpressure"
- "DoÄŸrulama KomutlarÄ±"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 14'Ã¼n tamamlandÄ±ÄŸÄ±nÄ± ve job/version invariant testlerinin eklendiÄŸini doÄŸrula.

BaÅŸlamadan Ã¶nce kontrol et:
- `package.json` test script'i hangi testleri Ã§alÄ±ÅŸtÄ±rÄ±yor?
- `tsconfig.json` test dosyalarÄ±nÄ± type-check ediyor mu?
- `test/integration/*.test.ts` normal test dÄ±ÅŸÄ±nda mÄ±?
- `npm.cmd test` Ã§Ä±ktÄ±sÄ± gerÃ§ekten tÃ¼m unit/acceptance testleri kapsÄ±yor mu?

Bilinen mevcut sorunlar:
1. `npm test` ÅŸu an `test/*.test.ts` Ã§alÄ±ÅŸtÄ±rÄ±yor; nested testler normal test dÄ±ÅŸÄ± kalÄ±yor.
2. `tsconfig.json` sadece `src/**/*.ts` include ediyor. Testlerdeki TypeScript hatalarÄ± `npm run build` tarafÄ±ndan yakalanmÄ±yor.
3. `node --import tsx --test` transpile ederek Ã§alÄ±ÅŸÄ±yor; test type-check garantisi vermiyor.
4. Acceptance kriterlerinin Ã§oÄŸu iddia edilmiÅŸ olsa da testlerde yok: `403 COLLECTION_FORBIDDEN`, registry-aware `/ready`, retention cleanup, Chroma configuration fidelity, different collections concurrent rebuild, rebuild sÄ±rasÄ±nda eski active version'dan query devamÄ±, backpressure mapping.

AmaÃ§:
YeÅŸil testlerin gerÃ§ek gÃ¼ven vermesini saÄŸla. Unit/acceptance testleri dÄ±ÅŸ servislerden baÄŸÄ±msÄ±z, type-checked ve plan kabul kriterleriyle eÅŸleÅŸir olmalÄ±.

YapÄ±lacaklar:
1. Test type-check altyapÄ±sÄ± kur:
   - `tsconfig.test.json` oluÅŸtur.
   - `src/**/*.ts` ve `test/**/*.test.ts` dosyalarÄ±nÄ± type-check etsin.
   - `noEmit: true` kullan.
   - `rootDir` sorunu yaÅŸamamak iÃ§in test tsconfig'i ayrÄ± tasarla.
   - `package.json` iÃ§ine script ekle:
     - `"typecheck": "tsc -p tsconfig.json --noEmit"`
     - `"typecheck:test": "tsc -p tsconfig.test.json --noEmit"`
   - `npm test` Ã¶ncesinde veya final doÄŸrulamada `typecheck:test` Ã§alÄ±ÅŸtÄ±r.
2. Test script disiplinini netleÅŸtir:
   - Normal unit/acceptance testler `test/**/*.test.ts` iÃ§inden integration olmayanlarÄ± Ã§alÄ±ÅŸtÄ±rmalÄ±.
   - `test/integration/**/*.test.ts` dÄ±ÅŸ servis gerektiriyorsa normal `npm test` dÄ±ÅŸÄ±nda kalmalÄ±.
   - Node test glob/pattern kullanÄ±mÄ±nÄ± Windows PowerShell ile uyumlu yap.
   - Gerekirse integration testleri `test/integration` altÄ±nda tutup `npm run test:integration` ile ayrÄ± Ã§alÄ±ÅŸtÄ±r.
   - `npm run test:all` ekleyebilirsin: typecheck + unit + opsiyonel integration deÄŸilse aÃ§Ä±k tasarla.
3. Acceptance test matrisi ekle:
   - Yeni `test/acceptance.multicollection.test.ts` veya mevcut testleri geniÅŸlet.
   - Her test adÄ± notes/multicollection.md kabul kriterlerinden biriyle aÃ§Ä±kÃ§a eÅŸleÅŸsin.
   - DÄ±ÅŸ servis Ã§aÄŸÄ±rmamak iÃ§in fake registry, fake Chroma/RAG resolver veya dependency injection kullan.
4. Åu acceptance kriterleri mutlaka testle:
   - `GET /v1/rag/collections` sadece current tenant visible collections dÃ¶ner.
   - BaÅŸka tenant'a ait bilinen collection id iÃ§in query/retrieve `403 COLLECTION_FORBIDDEN`.
   - Bilinmeyen collection id iÃ§in `404 COLLECTION_NOT_FOUND`.
   - Registry'de olmayan collection iÃ§in Chroma create Ã§aÄŸrÄ±lmaz.
   - Aktif sÃ¼rÃ¼mÃ¼ olmayan ve indexing sÃ¼ren collection iÃ§in `503 COLLECTION_INDEXING`.
   - Rebuild sÄ±rasÄ±nda active physical varsa query/retrieve eski active physical collection ile devam eder. Bunu gerÃ§ek Chroma yerine fake `retrieveSources`/resolver boundary ile test et.
   - AynÄ± collection iÃ§in ikinci rebuild `409 COLLECTION_INDEX_ALREADY_RUNNING`.
   - FarklÄ± collection'lar aynÄ± anda queued/running rebuild job sahibi olabilir.
   - Failed rebuild active pointer deÄŸiÅŸtirmez.
   - Physical Chroma create request `configuration.hnsw.space` deÄŸerini registry config/distanceMetric'ten alÄ±r.
   - Retention cleanup due deÄŸilse silmez; due ise siler.
   - `GET /v1/rag/collections/:collectionId/ready` active job, active version, Chroma readability ve capabilities alanlarÄ±nÄ± doÄŸru dÃ¶ner.
   - `/ready?details=true` registry dependency iÃ§erir.
   - Registry health fail olursa `/ready?strict=true` 503 dÃ¶ner.
   - Backpressure/timeout `503 MODEL_BACKPRESSURE` olarak map edilir; gerÃ§ek Ollama Ã§aÄŸÄ±rma.
   - Oversized JSON body structured JSON error dÃ¶ner.
   - Eski endpointler route-not-found kalÄ±r.
5. Dependency injection gerekiyorsa kontrollÃ¼ ekle:
   - `createApp` iÃ§ine test-only fake RAG service veya route dependency eklemek gerekiyorsa aÃ§Ä±k type ile yap.
   - Production default gerÃ§ek implementation olmalÄ±.
   - Route iÃ§inde module monkey-patching veya global mutable hack kullanma.
6. Test kalitesini dÃ¼zelt:
   - `setTimeout(1050)` gibi zaman beklemeleri kaldÄ±r.
   - Testlerde gerÃ§ek local `data/` veya Chroma/Ollama gereksinimi bÄ±rakma.
   - Test adlarÄ± yanÄ±ltÄ±cÄ± olmasÄ±n; bir test capability iddia ediyorsa gerÃ§ekten onu doÄŸrulasÄ±n.

Dikkat:
- Acceptance testleri yazarken davranÄ±ÅŸÄ± gevÅŸetme.
- Testleri geÃ§irmek iÃ§in plan dÄ±ÅŸÄ± fallback/compatibility endpoint ekleme.
- Integration test varsa aÃ§Ä±kÃ§a opsiyonel kalmalÄ±.

DoÄŸrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd test`
4. `npm.cmd run build`
5. DÄ±ÅŸ servisler ayaktaysa opsiyonel `npm.cmd run test:integration`; deÄŸilse finalde atlandÄ±ÄŸÄ±nÄ± belirt.

Final cevapta:
- Test scriptlerinin yeni anlamÄ±nÄ± Ã¶zetle.
- Type-check edilen kapsamÄ± belirt.
- Eklenen acceptance testlerini plan maddeleriyle eÅŸleÅŸtir.
- Komut sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 15: Acceptance Coverage, Test Typechecking, and Script Discipline" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 16: Readiness Contract, Runtime Copy Cleanup, and Operational Config

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin readiness response sÃ¶zleÅŸmesini netleÅŸtirmek, runtime'da kalan eski config/path metinlerini temizlemek ve operasyonel config'i planla uyumlu hale getirmektir.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "Readiness ve Healthcheck"
- "Yeni Endpoint KontratlarÄ±"
- "HTTP Hata KodlarÄ±"
- "Ollama ve Chroma Backpressure"
- "Faz 5: Backend Operasyonel Olgunluk"

AyrÄ±ca Ã§alÄ±ÅŸmaya baÅŸlamadan Ã¶nce notes/done.md dosyasÄ±nÄ± oku. Prompt 14-15 sonrasÄ± test/typecheck durumunu kontrol et.

Bilinen mevcut sorunlar:
1. `/ready` details=false iken Ã¶nceki summary contract yerine raw `checks` array dÃ¶nebiliyor; bu contract net deÄŸil ve testlenmiyor.
2. Runtime response/recommendedAction metinlerinde hÃ¢lÃ¢ `data.indexSampleSize` ve `rag.retrievalK` gibi eski config path'leri geÃ§iyor.
3. `config/rag.config.yaml` iÃ§inde cleanup retention ayarÄ± schema'da opsiyonel olsa da gÃ¶rÃ¼nÃ¼r ÅŸekilde yok.
4. `src/admin/onboard.ts` iÃ§inde eski `data.indexSampleSize` anlatÄ±mÄ± kalmÄ±ÅŸ.
5. Rate limit hÃ¢lÃ¢ TODO. Plan full rate limiter zorunlu kÄ±lmÄ±yor ama operasyonel hook ve dokÃ¼man gerÃ§ek durumu doÄŸru anlatmalÄ±.

AmaÃ§:
Servisin kullanÄ±cÄ±ya ve operatÃ¶re dÃ¶ndÃ¼rdÃ¼ÄŸÃ¼ readiness/config mesajlarÄ± yeni multi-collection config shape ile tutarlÄ± olsun. `/ready` response contract testlerle sabitlensin.

YapÄ±lacaklar:
1. `/ready` response contract'Ä±nÄ± netleÅŸtir:
   - `GET /ready` default response summary object dÃ¶nmeli; sadece raw array dÃ¶nmemeli.
   - Summary en az ÅŸunlarÄ± iÃ§ermeli:
     - `status`
     - `ready`
     - `systemReadyFor`
     - `queryReady`
     - `indexReady`
     - `blockerCodes`
     - `warningCodes`
     - `dependencies.registry.ok`
     - `dependencies.chroma.ok`
     - `dependencies.ollama.ok`
     - diagnostics linkleri
   - `GET /ready?details=true` full payload dÃ¶nmeli.
   - `GET /ready?strict=true` not ready ise 503 dÃ¶nmeli.
2. Registry health contract'Ä±nÄ± testle:
   - Normal registry ile `/ready?details=true` registry dependency pass.
   - Registry kapalÄ±/fake fail iken `/ready?strict=true` 503 ve `REGISTRY_UNREACHABLE`.
3. Runtime stale config metinlerini temizle:
   - `src/app.ts` iÃ§indeki `data.indexSampleSize` -> `collectionDefaults.indexSampleSize`.
   - `src/app.ts` iÃ§indeki `rag.retrievalK` -> `collectionDefaults.retrievalK`.
   - `src/admin/onboard.ts` iÃ§indeki eski `data.indexSampleSize` metnini dÃ¼zelt veya legacy baÄŸlamÄ± aÃ§Ä±kÃ§a belirt.
   - Product docs/code/test_frontend/config iÃ§inde stale active config path kalmasÄ±n. Tarihsel `notes/*` dosyalarÄ± hariÃ§ tutulabilir.
4. `config/rag.config.yaml` gÃ¼ncelle:
   - `cleanup.retentionMs` alanÄ±nÄ± aÃ§Ä±kÃ§a ekle.
   - EÄŸer `limits` schema'da varsa `limits.maxConcurrentEmbeddings` ve `limits.maxConcurrentGenerations` alanlarÄ±nÄ± da defaultlarÄ±yla gÃ¶rÃ¼nÃ¼r kÄ±lmayÄ± deÄŸerlendir.
   - README ve mimari dokÃ¼man bu alanlarÄ± doÄŸru anlatsÄ±n.
5. Collection ready contract'Ä±nÄ± testle:
   - `GET /v1/rag/collections/:collectionId/ready` active job, activeVersion, chromaReadable, chromaCount ve capabilities dÃ¶ndÃ¼rmeli.
   - Active physical yok + active job varsa query/retrieve false.
   - Active physical var ama collection status indexing ise query/retrieve true olmalÄ±, Chroma fake readable ise.
6. Rate limit durumunu netleÅŸtir:
   - Full rate limiter eklemiyorsan TODO ve README/mimari "henÃ¼z rate limit yok, sadece model backpressure var" diye dÃ¼rÃ¼st olmalÄ±.
   - EÄŸer basit rate limit middleware eklersen merkezi app middleware olarak ekle; route iÃ§ine daÄŸÄ±tma.
7. Static/stale testleri gÃ¼Ã§lendir:
   - Product source/runtime strings iÃ§in stale path testleri ekle.
   - `notes/multicollection.md`, `notes/prompts.md`, `notes/done.md` tarihsel olduÄŸu iÃ§in test kapsamÄ± dÄ±ÅŸÄ±nda tutulabilir.

Dikkat:
- Readiness endpointlerini collection readiness ile karÄ±ÅŸtÄ±rma.
- Default collection yok diye `/ready` fail etmemeli.
- Eski endpointleri geri ekleme.
- DokÃ¼manda olmayan Ã¶zelliÄŸi varmÄ±ÅŸ gibi anlatma.

DoÄŸrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. Stale scan:
   - `rg "data\\.indexSampleSize|rag\\.retrievalK|chroma\\.collection|/rag/query|/rag/retrieve" src test README.md vanilla_rag_backend_mimarisi.md test_frontend config`
   - Test dosyalarÄ±nda eski endpointleri route-not-found testleri iÃ§in kullanmak kabul edilebilir; product source/docs iÃ§inde aktif kullanÄ±m kalmamalÄ±.

Final cevapta:
- `/ready` contract'Ä±nÄ± Ã¶zetle.
- Temizlenen stale runtime/config metinlerini listele.
- Config'e eklenen operasyonel alanlarÄ± belirt.
- Test/build/stale-scan sonuÃ§larÄ±nÄ± yaz.
- notes/done.md dosyasÄ±na "Prompt 16: Readiness Contract, Runtime Copy Cleanup, and Operational Config" baÅŸlÄ±ÄŸÄ± altÄ±nda yaptÄ±klarÄ±nÄ±, deÄŸiÅŸtirdiÄŸin ana dosyalarÄ±, Ã§alÄ±ÅŸtÄ±rdÄ±ÄŸÄ±n komutlarÄ± ve varsa kalan riskleri eklediÄŸini belirt.
```

## Prompt 17: Documentation Truth, Done Log Repair, and Final Release Audit

```text
Bu repo Vanilla RAG Backend repo'sudur. GÃ¶revin son doÄŸruluk denetimini yapmak, dokÃ¼mantasyonu gerÃ§ek implementation ile hizalamak ve notes/done.md iÃ§indeki eksik/yanlÄ±ÅŸ coordination kayÄ±tlarÄ±nÄ± dÃ¼zeltmektir.

Ã–nce mutlaka notes/multicollection.md dosyasÄ±nÄ± baÅŸtan sona oku. Ã–zellikle ÅŸu bÃ¶lÃ¼mlere gÃ¶re Ã§alÄ±ÅŸ:
- "KÄ±sa Karar"
- "Son KullanÄ±cÄ± Collection'larÄ± Kolayca Bulabiliyor mu?"
- "Yeni Endpoint KontratlarÄ±"
- "Test Kabul Kriterleri"
- "Mimari Etkinlik DeÄŸerlendirmesi"

AyrÄ±ca notes/done.md dosyasÄ±nÄ± oku ve Ã¶nceki kayÄ±tlarÄ±n gerÃ§ek repo durumu ile tutarlÄ± olup olmadÄ±ÄŸÄ±nÄ± denetle.

Bilinen mevcut sorunlar:
1. notes/done.md iÃ§inde Prompt 9 ve Prompt 10 iÃ§in ayrÄ± kayÄ±t olmayabilir.
2. Prompt 13 kaydÄ± "her ÅŸey %100 tamam" diyebilir; ancak bu prompt baÅŸlamadan Ã¶nce bunun doÄŸru olduÄŸunu varsayma.
3. `vanilla_rag_backend_mimarisi.md` eski endpoint stringlerini iÃ§ermese bile yeni admin API, registry, physical collection lifecycle ve retention cleanup akÄ±ÅŸÄ±nÄ± eksik veya Ã§eliÅŸkili anlatabilir.
4. Product docs bazÄ± alanlarÄ± "garbage collection" gibi genel anlatÄ±yor ama retention sÃ¼resi, due cleanup ve startup cleanup davranÄ±ÅŸÄ±nÄ± netleÅŸtirmeyebilir.

AmaÃ§:
Kod, test, README, mimari dokÃ¼man ve done log aynÄ± gerÃ§eÄŸi anlatsÄ±n. Final release audit Ã¶nceki Prompt 13 gibi yÃ¼zeysel PASS vermesin; plan kabul kriterlerini tek tek kanÄ±tla.

YapÄ±lacaklar:
1. DokÃ¼mantasyon audit'i yap:
   - README gerÃ§ek endpointleri ve config alanlarÄ±nÄ± anlatÄ±yor mu?
   - `vanilla_rag_backend_mimarisi.md` ÅŸu akÄ±ÅŸÄ± aÃ§Ä±kÃ§a anlatÄ±yor mu:
     1. logical collection registry
     2. tenant-scoped public collectionId
     3. versioned physical Chroma collection
     4. job queued/running/succeeded/failed state
     5. active pointer swap
     6. retention-based cleanup
     7. registry-aware `/ready`
     8. collection-level `/v1/rag/collections/:id/ready`
     9. 403/404 ayrÄ±mÄ±
     10. model backpressure ve henÃ¼z varsa rate-limit TODO durumu
   - Eksik/yanlÄ±ÅŸ anlatÄ±mlarÄ± dÃ¼zelt.
2. `notes/done.md` coordination log'unu onar:
   - Prompt 9 ve Prompt 10 gerÃ§ekten Ã§alÄ±ÅŸtÄ±rÄ±lmÄ±ÅŸsa ayrÄ± baÅŸlÄ±klar altÄ±nda somut kayÄ±t ekle.
   - EÄŸer Ã¶nceki agent bunlarÄ± atladÄ±ysa bunu aÃ§Ä±kÃ§a yaz ve Prompt 14-16'nÄ±n hangi boÅŸluklarÄ± kapattÄ±ÄŸÄ±nÄ± belirt.
   - Prompt 13'teki "her ÅŸey %100 tamam" iddiasÄ± yanlÄ±ÅŸsa, altÄ±na dÃ¼zeltme notu ekle; geÃ§miÅŸ kaydÄ± silme, ama yeni audit kaydÄ±yla gerÃ§eÄŸi dÃ¼zelt.
   - Bu prompt sonunda "Prompt 17: Documentation Truth, Done Log Repair, and Final Release Audit" baÅŸlÄ±ÄŸÄ± ekle.
3. Final acceptance checklist Ã¼ret:
   - notes/multicollection.md "Test Kabul Kriterleri" listesindeki her madde iÃ§in:
     - `PASS`
     - `PARTIAL`
     - `FAIL`
     - `NOT TESTED`
   - Her madde iÃ§in kanÄ±t dosyasÄ±/test adÄ± yaz.
   - `PARTIAL/FAIL/NOT TESTED` varsa yeni prompt Ã¶ner; kÃ¼Ã§Ã¼kse bu promptta dÃ¼zelt.
4. Kod stale scan'i Ã§alÄ±ÅŸtÄ±r:
   - Product source/docs/config/frontend iÃ§in stale path ve endpoint kontrolÃ¼ yap.
   - Test dosyalarÄ±nda eski endpoint route-not-found amaÃ§lÄ± geÃ§iyorsa bunu kabul edilebilir olarak iÅŸaretle.
5. Build/test/typecheck final gate:
   - `npm.cmd run typecheck`
   - `npm.cmd run typecheck:test`
   - `npm.cmd run build`
   - `npm.cmd test`
   - Ortam uygunsa `npm.cmd run test:integration`
6. Git Ã§alÄ±ÅŸma aÄŸacÄ±nÄ± kontrol et:
   - `git status --short`
   - KullanÄ±cÄ±ya hangi dosyalarÄ±n deÄŸiÅŸtiÄŸini sÃ¶yle.

Dikkat:
- notes/multicollection.md planÄ±nÄ± geriye doÄŸru gevÅŸetme veya hedefi dÃ¼ÅŸÃ¼rme.
- HatalÄ± done kayÄ±tlarÄ±nÄ± silmek yerine yeni dÃ¼zeltme notlarÄ± ekle.
- DokÃ¼manda implementation'da olmayan Ã¶zelliÄŸi varmÄ±ÅŸ gibi anlatma.
- "Testler yeÅŸil" sonucunu tek baÅŸÄ±na release-ready kabul etme; kabul kriteri kanÄ±tÄ± ÅŸart.

DoÄŸrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. Opsiyonel `npm.cmd run test:integration`
6. `git status --short`

Final cevapta:
- Repo multiple collection hedefi iÃ§in hazÄ±r mÄ±: `evet`, `kÄ±smen`, veya `hayÄ±r`.
- Acceptance checklist Ã¶zetini ver.
- Kalan risk yoksa bunu aÃ§Ä±kÃ§a sÃ¶yle; varsa Ã¶ncelik sÄ±rasÄ±yla listele.
- DeÄŸiÅŸen dosyalarÄ± listele.
- Komut sonuÃ§larÄ±nÄ± yaz.
- notes/done.md iÃ§ine final audit ve done-log repair kaydÄ±nÄ± eklediÄŸini belirt.
```

## Prompt 18: Registry Patch Fields and Job Lifecycle Invariants

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin multi-collection refactor icin registry katmanindaki kalan lifecycle ve update invariant aciklarini kapatmaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Onerilen Registry Modeli"
- "Registry Semasi"
- "src/collections/types.ts"
- "Faz 2: Collection Registry Ekle"
- "Faz 4: Zero-Downtime Index/Rebuild"
- "Concurrency Stratejisi"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 14-17 kayitlarini gercek kodla karsilastir. Done log'da Prompt 14 kaydi eksik veya Prompt 15 duplicate olabilir; bunlari dogru kabul etmeden once repo durumunu dogrula.

Bilinen mevcut sorunlar:
1. `src/collections/sqliteRegistry.ts` icindeki `updateCollection` schema/type olarak `displayName`, `description`, `sourcePath`, `ozelgeDataPath` kabul ediyor, fakat bu alanlari SQL update'e eklemiyor.
2. `completeIndexJob` queued veya failed job'u dogrudan `succeeded` yapabiliyor. Job ancak `running` durumundayken tamamlanabilmeli.
3. `completeIndexJob` fallback olarak `versionFromJobId(existing.id)` kullaniyor. `targetVersion` icinde underscore varsa activeVersion kirpiliyor. Fallback `existing.target_version` olmali; mumkunse `versionFromJobId` tamamen kaldirilmali.
4. `completeIndexJob` ilgili `physical_collections` kaydi yoksa veya `building` degilse bile collection'i `ready` yapabiliyor. Pointer swap oncesi physical record integrity kontrolu yapilmali.
5. `failIndexJob` ve `failStaleJobs`, job'un target physical record'u `building` olarak kaldiysa terminal bir state'e cekmiyor. Failed build kayitlari sonsuza kadar `building` kalmamali.
6. Mevcut testler yesil ama bu invariant'lari kapsamiyor.

Amac:
SQLite registry, logical collection update ve index job lifecycle konusunda tek basina guvenilir kaynak olsun. Job state machine disina cikilmasin; collection pointer'i sadece dogrulanmis physical record basariyla aktiflenince degissin.

Yapilacaklar:
1. `updateCollection` alanlarini tamamla:
   - `displayName -> display_name`
   - `description -> description` nullable destekli olmali.
   - `sourcePath -> source_path`
   - `ozelgeDataPath -> ozelge_data_path`
   - Mevcut model/config/chunk/retrieval alanlari bozulmamali.
   - Bos patch gelirse sadece `updated_at` yazmak yerine davranisi bilincli sec: ya no-op olarak mevcut collection'i don ya da `400` route seviyesinde reddet. Secimini testle ve dokumante et.
2. Job state invariantlarini sikilastir:
   - `markIndexJobRunning` sadece `queued -> running` yapmaya devam etmeli.
   - `completeIndexJob` sadece `running` job icin calismali.
   - `failIndexJob` terminal job'larda tekrar status overwrite etmemeli; en azindan `succeeded` job'un failed yapilmasini engelle.
   - Hata mesajlari testlerde dogrulanabilir netlikte olsun.
3. Active version dogrulugunu duzelt:
   - `completeIndexJob` `result.activeVersion` yoksa `existing.target_version` kullanmali.
   - `versionFromJobId` artik gerekmiyorsa kaldir.
   - Underscore iceren target version icin activeVersion'in birebir korundugunu test et.
4. Physical record integrity ekle:
   - `completeIndexJob`, `activePhysicalCollection` icin registry'de physical record bulmali.
   - Bu record ayni tenantId + collectionId + targetVersion ile eslesmeli.
   - Record `building` degilse completion reddedilmeli.
   - `UPDATE physical_collections SET status = 'active' ...` sonucunda affected row sayisi 1 degilse transaction rollback olmali.
   - Bu durumda collection status/active pointer degismemeli ve job succeeded olmamali.
5. Failed build state'ini modelle:
   - `PhysicalCollectionStatus` icine gerekirse `failed_build` ekle.
   - `failIndexJob` running/queued job'un target physical record'u `building` ise onu `failed_build` yapmali ve hata bilgisini saklamali.
   - `failStaleJobs` de ayni mantigi uygulamali.
   - `failed_build` kayitlari cleanup due listesine karismamali; bunlar active/retired collection degildir.
6. Test edilebilir physical record okuma helper'i ekle:
   - Registry interface'e public HTTP'ye acilmayan `getPhysicalCollection(name)` veya `listPhysicalCollectionsForCollection(context, collectionId)` metodu ekle.
   - Bu metot unit testlerde state dogrulamasi icin kullanilsin.
7. Testleri genislet:
   - `test/collections.registry.test.ts`:
     - PATCH tum kabul edilen alanlari persist ediyor.
     - queued job complete edilemiyor.
     - failed/succeeded terminal job tekrar complete/fail edilemiyor.
     - completeIndexJob physical record yoksa collection ready olmuyor.
     - completeIndexJob targetVersion'i birebir activeVersion yapiyor.
     - failIndexJob building physical record'u `failed_build` yapiyor.
     - failStaleJobs stale building record'u `failed_build` yapiyor.
   - `test/indexing.jobs.test.ts`:
     - runIndexJob basarili path physical record'u create -> active yapar.
     - build hata verirse active pointer degismez ve physical record terminal failed_build olur.
8. HTTP tarafini gerekiyorsa uyumlu hale getir:
   - Admin PATCH basarili update testleri eklenince router response gercek updated collection'i dondurmeli.
   - Yeni error'lar `HttpError` mapping gerektiriyorsa `src/http/errors.ts` guncelle.

Dikkat:
- Geriye donuk compatibility endpoint ekleme.
- JSON registry veya config-backed default collection ekleme.
- Pointer swap'i Chroma'da collection yazilmis varsayimiyla yapma; registry physical record integrity kontrolu sart.
- Testleri sadece hata mesajina gevsek regex ile baglama; state degisimlerini de assert et.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- Hangi registry invariant'larini sikilastirdigini ozetle.
- PATCH alanlari ve job lifecycle icin eklenen testleri listele.
- Komut sonuclarini yaz.
- notes/done.md dosyasina "Prompt 18: Registry Patch Fields and Job Lifecycle Invariants" basligi altinda yaptiklarini, degistirdigin ana dosyalari, calistirdigin komutlari ve kalan riskleri ekledigini belirt.
```

## Prompt 19: Retention Cleanup Testability and Physical Collection Cleanup Semantics

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin retention cleanup akisini dis servisten izole, test edilebilir ve registry lifecycle ile tutarli hale getirmektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Chroma Dokumanlariyla Uyum Notlari"
- "Faz 4: Zero-Downtime Index/Rebuild"
- "src/indexing/buildPhysicalCollection.ts"
- "src/indexing/jobs.ts"
- "Concurrency Stratejisi"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 18 tamamlanmissa yeni physical status ve registry invariant degisikliklerini dikkate al.

Bilinen mevcut sorunlar:
1. `src/indexing/cleanup.ts` dogrudan `deletePhysicalChromaCollection` import ediyor; unit testlerde fake delete callback verilemiyor.
2. Retention cleanup icin due/not-due, retry, failure ve idempotent delete semantikleri yeterince testlenmemis.
3. Startup cleanup'in server bootstrap'i kirip kirmadigi ve hata loglama davranisi net testlenmiyor.
4. Failed build physical record'lari ile retired/delete_pending physical record'larin cleanup semantigi ayrismali.

Amac:
Eski active physical collection'lar pointer swap sonrasi retention suresi dolunca temizlensin; cleanup testleri Chroma/Ollama gerektirmesin; failure durumlari registry'de tekrar denenebilir olarak kalsin.

Yapilacaklar:
1. `cleanupRetiredPhysicalCollections` dependency injection alacak sekilde refactor et:
   - Input'a opsiyonel `deletePhysicalCollection?: (input: { name: string; runtimeConfig: ResolvedConfig }) => Promise<void>` ekle.
   - Production default `deletePhysicalChromaCollection` olmali.
   - Testlerde bu callback fake kullanilmali.
2. Cleanup state semantigini netlestir:
   - Sadece `delete_pending` ve `cleanup_failed` status'leri due ise listelenmeli.
   - `failed_build`, `building`, `active`, `retired`, `deleted` cleanup due listesine girmemeli.
   - `cleanup_failed` due ise tekrar denenebilmeli.
   - Basarili delete sonrasi `deleted_at` ve status `deleted` yazilmali.
   - Delete callback "not found" semantigini ayirt edebiliyorsa idempotent olarak `deleted` kabul etmeyi degerlendir; secimini test ve dokumanda belirt.
3. Registry cleanup helper'larini sikilastir:
   - `markPhysicalCollectionDeleted` ve `markPhysicalCollectionCleanupFailed` affected row sayisini kontrol etmeli.
   - Yanlis status'teki record'lari sessizce degistirmemeli.
   - `cleanup_error` basarili delete sonrasi temizlenmeli.
4. Startup cleanup davranisini kontrol et:
   - `src/server.ts` registry bootstrap sonrasi due cleanup calistiriyorsa hata server start'i gereksiz yere durdurmamali; loglamali.
   - Startup cleanup synchronous bekleniyorsa dokumante et; fire-and-forget ise process shutdown/drain etkisini degerlendir.
5. Test ekle:
   - `test/indexing.cleanup.test.ts` veya mevcut uygun dosya:
     - due collection yoksa delete callback cagrilmiyor.
     - delete_after gelecekteyse silinmiyor.
     - delete_after gecmisse fake delete cagriliyor ve registry `deleted` oluyor.
     - fake delete hata verirse status `cleanup_failed`, error saklaniyor.
     - `cleanup_failed` ve due ise tekrar deneniyor.
     - `failed_build` cleanup tarafindan silinmeye calisilmiyor.
   - `test/collections.registry.test.ts`:
     - `listDuePhysicalCollectionsForCleanup` status ve time filtrelerini dogru uyguluyor.
6. Dokumantasyonu guncelle:
   - README veya `vanilla_rag_backend_mimarisi.md` retention cleanup state'lerini gercek implementasyonla hizala.
   - "garbage collection" gibi genel anlatim yerine `delete_pending`, `cleanup_failed`, `deleted`, `failed_build` semantigini net yaz.

Dikkat:
- Cleanup unit testleri gercek Chroma servisine baglanmamali.
- Aktif physical collection cleanup'a dusmemeli.
- Failed build record'unu eski active physical gibi ele alma; pointer swap olmadiysa kullanici query path'i eski active version'da kalmali.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- Cleanup dependency injection ve state semantigini ozetle.
- Eklenen cleanup testlerini listele.
- Komut sonuclarini yaz.
- notes/done.md dosyasina "Prompt 19: Retention Cleanup Testability and Physical Collection Cleanup Semantics" basligi altinda yaptiklarini, degistirdigin ana dosyalari, calistirdigin komutlari ve kalan riskleri ekledigini belirt.
```

## Prompt 20: HTTP Contract Tightening, Collection Discovery, and Acceptance Gaps

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin public/admin HTTP kontratini planla birebir hizalamak, collection discovery davranisini yaniltici olmaktan cikarmak ve acceptance test bosluklarini kapatmaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Son Kullanici Collection'lari Kolayca Bulabiliyor mu?"
- "Yeni Endpoint Kontratlari"
- "HTTP Hata Kodlari"
- "Readiness ve Healthcheck"
- "Ollama ve Chroma Backpressure"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 18-19 tamamlanmissa registry lifecycle ve cleanup degisikliklerini dikkate al.

Bilinen mevcut sorunlar:
1. `GET /v1/rag/collections` collection kesfi sagliyor, fakat `capabilities.query/retrieve` su anda pratikte sadece `activePhysicalCollection` varligina bakabiliyor. Chroma/model readiness kontrolu yapilmadan "query true" demek kullaniciyi yaniltabilir.
2. Admin PATCH icin tenant forbidden testi var, fakat basarili PATCH'in tum alanlari persist ettigi HTTP seviyesinde testlenmiyor.
3. Backpressure/timeout error mapping acceptance seviyesinde yeterince kanitlanmamis.
4. Done log ve test adlari bazi davranislari iddia ediyor ama her zaman birebir assert etmiyor.

Amac:
Son kullanici var olan collection'lari kolayca bulabilsin, her collection'in durumunu dogru anlayabilsin ve query/retrieve/reindex akislari versioned multi-collection mimarisine uygun HTTP kontratlariyla calissin.

Yapilacaklar:
1. `GET /v1/rag/collections` response kontratini netlestir:
   - Liste endpoint'i pahali Chroma/Ollama readiness check yapmayacaksa `capabilities.query/retrieve` alanlarini yaniltici kullanma.
   - Seceneklerden birini uygula:
     - A) Liste endpoint'i sadece cheap registry bilgisi dondursun: `status`, `activeVersion`, `chunkCount`, `updatedAt`, `readyUrl`, `queryUrl`, `retrieveUrl`.
     - B) `capabilities` kalacaksa anlamini "registry-level eligibility" olarak dokumante et ve field adini netlestir, orn. `registryCapabilities`.
     - C) Gercek readiness hesaplayacaksan Chroma/Ollama checks'i bilincli ve limitli yap; latency etkisini test ve dokumanda belirt.
   - Hangi secimi yaptigini README ve testlerde sabitle.
2. Admin PATCH acceptance testleri ekle:
   - `PATCH /v1/admin/collections/:collectionId` basarili durumda `displayName`, `description`, `sourcePath`, `ozelgeDataPath`, `embeddingModel`, `chatModel`, `distanceMetric`, chunk ve retrieval alanlarini persist ediyor.
   - Baska tenant icin `403 COLLECTION_FORBIDDEN`.
   - Bilinmeyen collection icin `404 COLLECTION_NOT_FOUND`.
   - Unknown body key strict schema ile `400 INVALID_REQUEST_BODY`.
3. Query/retrieve HTTP tests:
   - `retrieve` body'deki explicit `k`, collection default `retrievalK` yerine kullaniliyor.
   - `query` collection default `retrievalK` kullanmaya devam ediyor.
   - Collection-specific `embeddingModel`, `chatModel`, `retrievalDistanceThreshold`, `activePhysicalCollection`, `activeVersion` response ve handler call icinde assert ediliyor.
   - Registry'de olmayan collection icin Chroma create/read/write cagrisi yapilmiyor.
4. Error mapping acceptance testleri ekle:
   - Fake RAG handler `MODEL_BACKPRESSURE` firlattiginda HTTP `503` ve `code: "MODEL_BACKPRESSURE"` donuyor.
   - Fake RAG handler storage inconsistency firlattiginda uygun 503/500 mapping planla uyumlu donuyor.
   - Oversized JSON ve invalid JSON structured error kontrati korunuyor.
5. Collection ready endpoint'i ile list endpoint'i arasindaki iliskiyi netlestir:
   - Liste, kullaniciyi `GET /v1/rag/collections/:collectionId/ready` endpoint'ine yonlendirmeli veya `readyUrl` sunmali.
   - `/ready` collection-ready degildir; bu ayrim dokumanda ve testlerde karismamali.
6. Frontend static contract'i guncelle:
   - `test_frontend/index.html` liste endpoint kontrati degistiyse uyarlansin.
   - UI query/retrieve butonlarini yalnizca secili collection ve ready/capability durumu uygunsa aktif etsin.
   - Eski `/rag/query` ve `/rag/retrieve` referanslari geri gelmesin.
7. Acceptance test dosyalarini dogru konumlandir:
   - Unit/acceptance testler `npm.cmd test` ile calismali.
   - Dis servis isteyen testler sadece `npm.cmd run test:integration` altinda kalmali.

Dikkat:
- Kullanilmayan veya dogrulanmayan capability alanlari ekleme.
- Eski endpoint fallback/redirect ekleme.
- HTTP testlerinde gercek Chroma/Ollama gerektirme; fake deps kullan.
- Test adlari iddia ettigi davranisi gercek assert etmeli.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`
6. Stale scan:
   - `rg "/rag/query|/rag/retrieve|chroma\\.collection|data\\.indexSampleSize|rag\\.retrievalK" src test README.md vanilla_rag_backend_mimarisi.md test_frontend config`

Final cevapta:
- Collection list/discovery kontratinda hangi secimi yaptigini acikla.
- Eklenen HTTP acceptance testlerini plan maddeleriyle eslestir.
- Komut ve stale scan sonuclarini yaz.
- notes/done.md dosyasina "Prompt 20: HTTP Contract Tightening, Collection Discovery, and Acceptance Gaps" basligi altinda yaptiklarini, degistirdigin ana dosyalari, calistirdigin komutlari ve kalan riskleri ekledigini belirt.
```

## Prompt 21: Final Plan Parity Audit, Done Log Repair, and Release Gate

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin Prompt 18-20 sonrasinda final plan-parity audit yapmak, notes/done.md coordination log'unu gercek durumla hizalamak ve release gate sonucunu kanitlariyla yazmaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini bastan sona oku. Ozellikle su bolumlere gore calis:
- "Kisa Karar"
- "Endpoint Path'ine Collection Hash Ekleyelim mi?"
- "Chroma Dokumanlariyla Uyum Notlari"
- "Coding Agent Icin Uygulama Blueprint'i"
- "Fazlara Bolunmus Uygulama Plani"
- "Test Kabul Kriterleri"
- "Mimari Etkinlik Degerlendirmesi"

Ayrica notes/done.md dosyasini oku ve Prompt 1-20 kayitlarini gercek repo durumu ile karsilastir. Done log tarihsel kayittir; hatali eski PASS iddialarini silme, yeni correction note ekle.

Amac:
Repo gercekten multiple collection destekleyen bir RAG backend'i oldu mu sorusuna kanitli cevap ver. Yesil test tek basina yeterli degil; plan kabul kriterleri kod, test ve dokumanla eslesmeli.

Yapilacaklar:
1. Plan parity checklist hazirla:
   - notes/multicollection.md "Faz 0" - "Faz 6" ve "Test Kabul Kriterleri" maddelerini tek tek denetle.
   - Her maddeye `PASS`, `PARTIAL`, `FAIL`, `NOT TESTED` ver.
   - Her madde icin kanit olarak dosya/test adi yaz.
   - `PARTIAL/FAIL/NOT TESTED` varsa kucukse bu promptta duzelt; buyukse notes/prompts.md icine Prompt 22+ olarak cold-start prompt ekle.
2. Done log'u onar:
   - Prompt 14 kaydi eksikse gercek repo durumuna gore backfill/correction entry ekle.
   - Duplicate Prompt 15 varsa silme; altina "duplicate historical entry" correction note ekle.
   - Prompt 13 ve Prompt 17 "release-ready" iddialari artik yanlissa correction note ekle.
   - Prompt 18-20 agent kayitlari gercekten var mi kontrol et.
   - Bu prompt sonunda "Prompt 21: Final Plan Parity Audit, Done Log Repair, and Release Gate" basligini ekle.
3. Kod audit'i yap:
   - `src/config.ts`, `config/rag.config.yaml`
   - `src/collections/types.ts`, `ids.ts`, `sqliteRegistry.ts`, `chromaCollections.ts`, `resolveReadableCollection.ts`
   - `src/indexing/buildPhysicalCollection.ts`, `jobs.ts`, `jobRunner.ts`, `cleanup.ts`
   - `src/rag.ts`, `src/index.ts`, `src/server.ts`, `src/app.ts`
   - `src/http/adminRouter.ts`, `ragRouter.ts`, `errors.ts`, `requestContext.ts`
   - `test_frontend/index.html`, README, `vanilla_rag_backend_mimarisi.md`
4. Spesifik regresyon scriptlerini calistir veya unit testlerin kapsadigini kanitla:
   - Admin/registry PATCH tum alanlari persist ediyor.
   - Queued job complete edilemiyor.
   - Failed/succeeded terminal job complete/fail edilemiyor.
   - completeIndexJob physical record olmadan collection'i ready yapmiyor.
   - targetVersion underscore dahil birebir activeVersion oluyor.
   - failed build physical record `building` kalmiyor.
   - cleanup due/not-due/failure/retry testleri mevcut.
   - list endpoint capability/discovery semantigi dokumanla ayni.
5. Stale scan yap:
   - Product source/docs/config/frontend icin eski endpoint ve eski config path kalmasin.
   - Testlerde eski endpointler sadece route-not-found amacli kalabilir.
6. Build/test final gate:
   - `npm.cmd run typecheck`
   - `npm.cmd run typecheck:test`
   - `npm.cmd run build`
   - `npm.cmd test`
   - `npm.cmd run test:integration`
7. Git calisma agacini raporla:
   - `git status --short`
   - Kullaniciya hangi dosyalarin degistigini soyle.

Dikkat:
- notes/multicollection.md hedefini geriye dogru gevsetme.
- Dokumanda implementation'da olmayan ozelligi varmis gibi anlatma.
- Hata bulursan "testler yesil" diyerek gecme.
- Yeni prompt ekliyorsan her yeni prompt notes/multicollection.md ve notes/done.md okuma zorunlulugu icermeli.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`
6. `git status --short`

Final cevapta:
- Repo multiple collection hedefi icin hazir mi: `evet`, `kismen`, veya `hayir`.
- Acceptance checklist ozetini ver.
- Kalan riskleri oncelik sirasiyla listele.
- Degisen dosyalari listele.
- Komut sonuclarini yaz.
- notes/done.md icine final audit ve done-log repair kaydini ekledigini belirt.
```

## Prompt 22: Operational Observability, Request Rate Limits, and Timeout Hardening

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin Prompt 21 plan-parity auditinde PARTIAL kalan Faz 5 operasyonel olgunluk maddelerini gercek implementasyon, test ve dokumanla kapatmaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini bastan sona oku. Ozellikle su bolumlere gore calis:
- "Faz 5: Backend Operasyonel Olgunluk"
- "Ollama ve Chroma Backpressure"
- "HTTP Hata Kodlari"
- "Test Kabul Kriterleri"
- "Mimari Etkinlik Degerlendirmesi"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku. Prompt 21 auditinde `kismen` release gate sonucu verildiyse bunun nedenlerini ve mevcut test kanitlarini dikkate al.

Amac:
Multi-collection core davranisi zaten korunurken backend'in operasyonel yuzeyini release gate icin tamamlamak: collection/user bazli request rate limiting, standart structured log alanlari, response/debug seviyesinde latency kontrati ve query path genelinde Chroma/Ollama timeout/abort hardening.

Yapilacaklar:
1. Request rate limiting ekle:
   - Merkezi middleware veya app-level hook kullan; route icinde ad-hoc limiter yazma.
   - Limit anahtari en az `tenantId`, `userId`, `collectionId` ve operation (`query`, `retrieve`, `reindex`) boyutlarini desteklemeli.
   - Config'e dokunuyorsan `config/rag.config.yaml`, `src/config.ts`, README ve mimari dokumani beraber guncelle.
   - Limit asiminda structured `429 RATE_LIMIT_EXCEEDED` don.
   - Unit/acceptance testleri Chroma/Ollama gerektirmemeli.
2. Structured logging standardi kur:
   - Log event shape'i standardize et: `requestId`, `tenantId`, `userId`, `collectionId`, `physicalCollection`, `jobId`, `operation`, `status`, `latencyMs`, `errorCode`.
   - RAG query/retrieve, admin reindex/job, indexing build/jobRunner ve cleanup akislari bu alanlari tutarli kullansin.
   - Testlerde log sink fake veya injectable olmali; console'a bagimli flaky assertion yazma.
3. Latency/debug kontratini netlestir:
   - Retrieval ve generation latency olcumlerini response'ta ancak kontrollu debug flag/config ile dondur; default response'u gereksiz kalabaliklastirma.
   - Debug kapaliyken response shape sabit kalsin.
   - README ve `vanilla_rag_backend_mimarisi.md` debug/latency sozlesmesini gercek implementasyonla hizala.
4. Timeout/abort hardening yap:
   - Chroma readability/vector search ve Ollama generation path'lerinde request abort ve configured timeout davranisini gozden gecir.
   - Query path'in tamaminda timeout hatalari typed error'a map edilmeli; mumkunse `MODEL_BACKPRESSURE` ile kapasite/timeout durumlarini, storage inconsistency ile Chroma read hatalarini ayirt et.
   - Testlerde fake deps ile timeout/abort semantigini dogrula.
5. Plan parity ve done log guncelle:
   - notes/plan-parity-audit.md Faz 5 maddelerini tekrar denetle.
   - notes/done.md icine "Prompt 22: Operational Observability, Request Rate Limits, and Timeout Hardening" basligi altinda yaptiklarini, degistirdigin ana dosyalari, calistirdigin komutlari ve kalan riskleri ekle.

Dikkat:
- Multi-collection acceptance davranislarini geriletme.
- Collection list endpoint'ini readiness probe ile pahali hale getirme; Prompt 20 contract'i korunmali.
- Rate limiter ve log sink testleri dis servislere baglanmamali.
- Dokumanda implementation'da olmayan ozelligi varmis gibi anlatma.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`
6. Stale scan:
   - `rg "/rag/query|/rag/retrieve|chroma\\.collection|data\\.indexSampleSize|rag\\.retrievalK" src README.md vanilla_rag_backend_mimarisi.md test_frontend config`

Final cevapta:
- Faz 5 partial maddelerinin hangilerinin PASS oldugunu yaz.
- Eklenen rate limit/log/latency/timeout testlerini listele.
- Komut ve stale scan sonuclarini yaz.
- notes/done.md ve notes/plan-parity-audit.md guncellemelerini belirt.
```

## Prompt 23: NO_RELEVANT_CONTEXT RetrievalK Metadata Accuracy

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin tek bir kucuk dogruluk bug'ini duzeltmektir: `NO_RELEVANT_CONTEXT` hata detaylarinda `retrievalK` collection/request-specific kullanilan degeri gostermeli, global `runtimeConfig.retrievalK` degerini degil.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Faz 1: RAG Core'u Collection-Aware Yap"
- "Concurrency Stratejisi"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku. Mevcut multi-collection release gate durumunu dikkate al, fakat bu promptun kapsamini genisletme.

Bug:
`src/rag.ts` icinde `answerQuestion(...)`, retrieved source kalmadiginda `NO_RELEVANT_CONTEXT` hatasi firlatiyor. Bu hatanin `details.retrievalK` alani su anda `runtimeConfig.retrievalK` kullaniyor. Ancak multi-collection refactor sonrasi gercek kullanilan `k`, `options.retrievalK ?? runtimeConfig.retrievalK` olarak hesaplanmis collection/request-specific degerdir. Error metadata bu gercek degeri gostermeli.

Amac:
Davranisi degistirmeden sadece hata metadata dogrulugunu duzelt. Collection-specific `retrievalK` kullanan bir collection `NO_RELEVANT_CONTEXT` hatasi aldiginda response/error details icinde ayni `retrievalK` gorunmeli.

Yapilacaklar:
1. Once failing test ekle:
   - Uygun test dosyasini sec:
     - `test/acceptance/api.endpoints.test.ts` HTTP response details uzerinden test etmek icin uygunsa onu kullan.
     - Alternatif olarak `test/rag.core.test.ts` veya mevcut uygun unit test dosyasi ekleyebilirsin.
   - Testte collection/request-specific `retrievalK` degeri global config default'undan farkli olmali.
   - Retrieve sonucunda hic source kalmayan bir senaryo kur.
   - Beklenti:
     - Hata code `NO_RELEVANT_CONTEXT`.
     - `details.retrievalK` gercek kullanilan collection/request-specific `k` degeri olmali.
     - Global `runtimeConfig.retrievalK` degeri olmamali.
2. Minimal fix uygula:
   - `src/rag.ts` icinde `NO_RELEVANT_CONTEXT` error details altindaki `retrievalK` alanini `runtimeConfig.retrievalK` yerine mevcut lokal `k` degeriyle doldur.
   - Baska error code'lari, retrieval algoritmasi, threshold davranisi, endpoint contract'i veya config shape'i degistirme.
3. notes/done.md guncelle:
   - Dosyanin sonuna su baslikla kisa kayit ekle:
     `## Prompt 23: NO_RELEVANT_CONTEXT RetrievalK Metadata Accuracy`
   - Ne yaptigini, degisen dosyalari ve calistirdigin komutlari yaz.

Dikkat:
- Bu prompt tek bug fix kapsamindadir.
- notes/prompts.md dosyasini degistirme.
- notes/plan-parity-audit.md dosyasini degistirme veya yeniden adlandirma.
- Collection list, readiness, rate limit, cleanup, registry veya frontend davranislarina dokunma.
- Testi gecirmek icin `NO_RELEVANT_CONTEXT` davranisini gevsetme; sadece metadata alanini duzelt.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- Eklenen failing regression testini ozetle.
- `src/rag.ts` icindeki metadata fix'ini ozetle.
- Degisen dosyalari listele.
- Komut sonuclarini yaz.
- notes/done.md icine `Prompt 23: NO_RELEVANT_CONTEXT RetrievalK Metadata Accuracy` kaydini ekledigini belirt.
```

## Prompt 24: Query Resolve Abort and Timeout Propagation

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin query/retrieve request akisinin ilk Chroma readability preflight adimini da request abort ve RAG timeout zincirine dahil etmektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Query/Retrieve Path"
- "Ollama ve Chroma Backpressure"
- "Faz 5: Backend Operasyonel Olgunluk"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku. Prompt 22 ve Prompt 23 sonrasindaki mevcut durumu dikkate al.

Bug:
`src/http/ragRouter.ts` icinde query/retrieve handler'lari `AbortController`'i `resolveReadableCollection(...)` cagrisi bittikten sonra olusturuyor. `src/collections/resolveReadableCollection.ts` ise Chroma `assertChromaCollectionReadable(...)` cagrisi yaparken `abortSignal` almiyor ve default olarak `readyTimeoutMs` kullaniyor. Bu nedenle request, active physical collection resolve/readability preflight sirasinda client disconnect veya query-level timeout tarafindan tam korunmuyor.

Amac:
Request basinda tek bir abort controller olusturulsun ve ayni `AbortSignal` hem `resolveReadableCollection` Chroma guard'ina hem de RAG core'a iletilsin. Query/retrieve request boyunca ayni physical collection ile calissin, fakat preflight da abort/timeout aware olsun.

Yapilacaklar:
1. Once failing regression test ekle:
   - Uygun dosya: `test/acceptance/api.endpoints.test.ts` ve/veya yeni `test/collections.resolveReadable.test.ts`.
   - Test, `resolveReadableCollection` veya router cagrisi uzerinden sunlari kanitlamali:
     - Chroma readability guard'a `abortSignal` iletiliyor.
     - Timeout olarak query path icin `runtimeConfig.ragTimeoutMs` kullaniliyor; default `readyTimeoutMs` ile sinirli kalmiyor.
     - Abort edilmis signal veya timeout durumunda HTTP/RAG error typed kaliyor: `503 COLLECTION_STORAGE_INCONSISTENT` veya mevcut typed error mapping ile uyumlu bir code.
   - Test gercek Chroma/Ollama istememeli; dependency injection veya fake guard kullan.
2. `src/collections/resolveReadableCollection.ts` imzasini geriye uyumlu sekilde genislet:
   - Mevcut kullanimi kirmadan opsiyonel bir options object kabul et:
     `resolveReadableCollection(req, deps, runtimeConfig, options?)`
   - `options` icinde en az:
     - `timeoutMs?: number`
     - `abortSignal?: AbortSignal`
     - test edilebilirlik icin `assertChromaCollectionReadable?: typeof assertChromaCollectionReadable`
   - Chroma readability cagrisi bu `timeoutMs` ve `abortSignal` degerlerini kullanmali.
3. `src/http/ragRouter.ts` guncelle:
   - `AbortController` query/retrieve handler basinda, body validationdan sonra ve `resolveCollection(...)` cagrÄ±sÄ±ndan once olusturulsun.
   - `req.on("close", ...)` ayni controller'i abort etsin.
   - `resolveCollection(...)` cagrisi `timeoutMs: runtimeConfig.ragTimeoutMs` ve `abortSignal: ac.signal` alsin.
   - Ayni `ac.signal` RAG handler'a da iletilmeye devam etsin.
4. Error mapping'i bozma:
   - Missing logical collection halen `404 COLLECTION_NOT_FOUND`.
   - Forbidden collection halen `403 COLLECTION_FORBIDDEN`.
   - Active physical Chroma'da yoksa halen `503 COLLECTION_STORAGE_INCONSISTENT`.
   - Eski `/rag/query` ve `/rag/retrieve` geri gelmemeli.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 24: Query Resolve Abort and Timeout Propagation` basligi altinda kisa kayit ekle.

Dikkat:
- Collection list endpoint'ini pahali readiness probe'a cevirmeye calisma.
- RAG core'daki ikinci readability guard'i kaldirma; bu guard LangChain read path icin ek savunmadir.
- Testleri gercek Chroma/Ollama'ya baglama.
- Kapsami rate limit, registry schema veya frontend degisikliklerine genisletme.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- Eklenen regression testini ozetle.
- `resolveReadableCollection` ve router abort/timeout propagation fix'ini ozetle.
- Degisen dosyalari listele.
- Komut sonuclarini yaz.
- notes/done.md icine Prompt 24 kaydini ekledigini belirt.
```

## Prompt 25: Active Embedding Model Snapshot for Zero-Downtime Reads

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin aktif physical collection ile query-time embedding modeli arasindaki tutarsizlik riskini gidermektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Chroma Dokumanlariyla Uyum Notlari"
- "Index/Rebuild Path"
- "Query/Retrieve Path"
- "Zero-Downtime Index/Rebuild"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku. Prompt 24 yapildiysa onun abort/timeout imza degisikliklerini dikkate al.

Bug:
Hazir ve aktif physical collection'i olan bir logical collection'da `PATCH /v1/admin/collections/:collectionId` ile `embeddingModel` degistirilebiliyor. Query/retrieve route'lari daha sonra yeni `collection.embeddingModel` degerini hemen kullanarak eski embedding modeliyle build edilmis aktif Chroma vectors uzerinde arama yapiyor. Bu, embedding dimension mismatch, anlamsiz skorlar veya Chroma tarafinda runtime hata uretme riski tasir. Plan, embedding modeli degisirse yeni physical collection build + active pointer swap gerektigini soyluyor.

Amac:
Aktif read path, her zaman aktif physical collection'in build edildigi embedding modelini kullanmali. Desired/future `embeddingModel` admin tarafindan degisse bile bu deger, reindex basarili olup active pointer swap tamamlanana kadar mevcut aktif physical read modelini degistirmemeli.

Yapilacaklar:
1. Once failing regression test ekle:
   - Uygun dosyalar: `test/collections.registry.test.ts` ve `test/acceptance/api.endpoints.test.ts`.
   - Senaryo:
     1. Collection `embeddingModel = "embed-v1"` ile olusturulur.
     2. Reindex job basarili tamamlanir ve active physical collection set edilir.
     3. Admin PATCH ile collection desired `embeddingModel = "embed-v2"` yapilir.
     4. Query/retrieve cagrisi active physical collection degismedigi surece RAG handler'a `"embed-v1"` ile gitmelidir.
     5. Yeni reindex basarili tamamlaninca active read embedding modeli `"embed-v2"` olur ve query/retrieve artik `"embed-v2"` kullanir.
2. Registry modelini netlestir:
   - `RagCollection` icine aktif physical surume ait read embedding snapshot alanini ekle. Ornek:
     - `activeEmbeddingModel?: string`
   - Gerekirse DB kolonunu ekle. Proje henuz kullanilmadigi icin geriye donuk migration zorunlu degil, fakat test DB init temiz calismali.
   - `completeIndexJob(...)`, job'un build ettigi collection embedding modelini `activeEmbeddingModel` olarak yazmali.
   - `createCollection` asamasinda active snapshot bos kalabilir.
3. Query/retrieve route'larini guncelle:
   - `src/http/ragRouter.ts` RAG handler'a `embeddingModel: collection.activeEmbeddingModel ?? collection.embeddingModel` gondersin.
   - Collection active physical varsa ve active snapshot yoksa fallback mevcut `collection.embeddingModel` olabilir.
   - `GET /v1/rag/collections/:collectionId/ready` embedding model availability check'i active physical varsa active read embedding modelini kontrol etmeli.
4. Reindex akisini koru:
   - Yeni reindex build'i desired `collection.embeddingModel` ile yapilmali.
   - Basarili complete sonrasi active snapshot desired modele donmeli.
   - Failed rebuild eski active snapshot'i degistirmemeli.
5. HTTP response/dokuman:
   - Public response'a yeni field eklemek zorunda degilsin. Eklersen internal/desired/active ayrimini dokumanda net yaz.
   - README veya mimari dokumanda "embeddingModel update reindex basarili olana kadar active read modelini degistirmez" davranisini kisa sekilde belirt.
6. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 25: Active Embedding Model Snapshot for Zero-Downtime Reads` basligi altinda kisa kayit ekle.

Dikkat:
- Bu fix sadece `embeddingModel` mismatch bug'ini kapatmaya odaklansin.
- `chatModel`, `retrievalK` ve `retrievalDistanceThreshold` reindex gerektirmeyen runtime ayarlar olabilir; onlari gereksiz yere dondurma.
- Query path eski active physical collection uzerinde zero-downtime davranisini korumali.
- Testlerde gercek Chroma/Ollama kullanma.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- Eklenen failing regression senaryosunu ozetle.
- Active embedding snapshot modelini ve query route degisikligini ozetle.
- Failed rebuild'in eski snapshot'i korudugunu belirt.
- Degisen dosyalari ve komut sonuclarini yaz.
- notes/done.md icine Prompt 25 kaydini ekledigini belirt.
```

## Prompt 26: Public Collection Detail DTO Sanitization

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin public RAG collection detail endpoint'inin internal registry alanlarini acmasini engellemektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Son Kullanici Collection'lari Kolayca Bulabiliyor mu?"
- "Yeni Endpoint Kontratlari"
- "Query/Retrieve Path"
- "Faz 3: API Endpointlerini Yeniden Tasarla"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku. Prompt 25 yapildiysa active embedding snapshot alanini public DTO'ya sizdirmemeye dikkat et.

Bug:
`GET /v1/rag/collections/:collectionId` su anda `res.json({ collection })` ile tum `RagCollection` objesini donduruyor. Bu public RAG endpoint'i `sourcePath`, `ozelgeDataPath`, `tenantId`, `createdBy`, model isimleri, Chroma configuration ve olasi active physical storage detaylarini son kullaniciya acabilir. Liste endpoint'i ise daha kontrollu bir public discovery DTO donduruyor.

Amac:
Public collection detail endpoint'i, list endpoint'iyle uyumlu ve son kullaniciya uygun sanitize edilmis DTO dondursun. Internal registry/source/storage alanlari public response'ta yer almasin.

Yapilacaklar:
1. Once failing acceptance test ekle:
   - Uygun dosya: `test/acceptance/api.endpoints.test.ts`.
   - `GET /v1/rag/collections/:collectionId` icin response'ta bulunmasi gereken public alanlari assert et:
     - `id`
     - `displayName`
     - `description`
     - `status`
     - `chunkCount`
     - `activeVersion`
     - `updatedAt`
     - `readyUrl`
     - `queryUrl`
     - `retrieveUrl`
   - Response'ta su alanlarin olmadigini assert et:
     - `tenantId`
     - `createdBy`
     - `sourcePath`
     - `ozelgeDataPath`
     - `embeddingModel`
     - `chatModel`
     - `distanceMetric`
     - `chromaCollectionConfiguration`
     - `activePhysicalCollection`
     - Prompt 25 eklediyse `activeEmbeddingModel`
2. `src/http/ragRouter.ts` icinde public collection DTO mapper'i olustur:
   - List ve detail endpoint ayni mapper'i kullanmali.
   - `description`, `chunkCount`, `activeVersion` gibi nullable alanlar stable sekilde `null` donmeli.
   - URL alanlari collection id uzerinden uretilmeli.
3. Error davranisini koru:
   - Baska tenant icin `403 COLLECTION_FORBIDDEN`.
   - Bilinmeyen collection icin `404 COLLECTION_NOT_FOUND`.
4. Frontend/dokuman:
   - `test_frontend/index.html` detail endpoint'i kullanmiyorsa degistirme.
   - README veya mimari dokumanda detail endpoint anlatimi varsa public DTO ile hizala.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 26: Public Collection Detail DTO Sanitization` basligi altinda kisa kayit ekle.

Dikkat:
- Admin endpointleri internal collection config gosterebilir; bu prompt sadece public `/v1/rag/collections/:collectionId` endpoint'i icindir.
- Collection list endpoint'ini pahali readiness probe'a cevirmeyin.
- `GET /v1/rag/collections` contract'ini bozma.
- Eski endpointleri geri ekleme.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- Public detail DTO'dan hangi internal alanlarin kaldirildigini ozetle.
- Eklenen acceptance testini yaz.
- Degisen dosyalari ve komut sonuclarini yaz.
- notes/done.md icine Prompt 26 kaydini ekledigini belirt.
```

## Prompt 27: CLI Index Command Must Fail on Failed Job

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin CLI indexing akisinin basarisiz index job'larda basarili exit sinyali uretmesini engellemektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "`src/index.ts`"
- "`src/indexing/jobs.ts`"
- "Index/Rebuild Path"
- "Zero-Downtime Index/Rebuild"
- "Coding Agent Calisma Sirasi"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku.

Bug:
`src/indexing/jobs.ts` icindeki `runIndexJob(...)` build failure durumunda job'u registry'de `failed` yapiyor fakat hatayi swallow edip `Promise<void>` olarak donuyor. HTTP background worker icin bu kabul edilebilir olabilir, ancak `src/index.ts` / `npm run index -- --collection-id <id>` bu fonksiyonu bekledigi icin build failure olsa bile CLI komutu basarili tamamlanmis gibi exit code 0 uretebilir.

Amac:
CLI indexing komutu, job `succeeded` degilse hata firlatsin ve process non-zero exit ile bitsin. HTTP background job runner ise mevcut davranisla job status'unu registry'de failed olarak kaydetmeye devam etsin.

Yapilacaklar:
1. Once failing test ekle:
   - Uygun dosya: `test/indexing.jobs.test.ts` veya yeni `test/index.cli.test.ts`.
   - Test, injected fake `buildPhysicalCollection` failure durumunda:
     - Job registry'de `failed` olur.
     - CLI-facing akisin hata firlattigi kanitlanir.
   - Gercek Chroma/Ollama kullanma.
2. `runIndexJob` sonuc sozlesmesini netlestir:
   - Seceneklerden birini uygula:
     - A) `runIndexJob(...)` final `IndexJob` dondursun; success'te `succeeded`, handled failure'da `failed`.
     - B) `runIndexJob(...)` opsiyonel `throwOnFailure?: boolean` alsin; HTTP runner default false, CLI true kullansin.
   - Hangi secimi yaparsan testle sabitle.
3. `src/index.ts` guncelle:
   - `runIndexing(...)`, job tamamlandiktan sonra final job status'unu kontrol etmeli.
   - Final status `succeeded` degilse job error mesajiyla `throw new Error(...)` yapmali.
   - `main().catch(...)` zaten process exit code 1 set ediyor; bunu koru.
4. `src/indexing/jobRunner.ts` davranisini bozma:
   - HTTP background runner, job failure'i registry status'u olarak kaydetmeye devam etmeli.
   - Unhandled exception log davranisi gereksiz duplicate log uretmeyecek sekilde dikkatli ol.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 27: CLI Index Command Must Fail on Failed Job` basligi altinda kisa kayit ekle.

Dikkat:
- Destructive reset veya eski single-collection indexing geri gelmemeli.
- `npm run index` halen explicit `--collection-id` istemeli.
- HTTP `POST /v1/admin/collections/:collectionId/reindex` halen `202 Accepted` donmeli; build failure daha sonra job status'unda gorulmeli.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- CLI failure contract'ini nasil sabitledigini ozetle.
- HTTP background job davranisinin korundugunu belirt.
- Eklenen testi, degisen dosyalari ve komut sonuclarini yaz.
- notes/done.md icine Prompt 27 kaydini ekledigini belirt.
```

## Prompt 28: Rate Limit Key Collision Hardening

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin request rate limiter anahtar uretimini collision-safe hale getirmektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Ollama ve Chroma Backpressure"
- "Faz 5: Backend Operasyonel Olgunluk"
- "Test Kabul Kriterleri"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku.

Bug:
`src/http/rateLimit.ts` icindeki `createRateLimitKey(...)`, `tenantId`, `userId`, `collectionId`, `operation` degerlerini `:` ile join ediyor. Header tabanli tenant/user degerleri `:` karakteri icerebilir. Bu durumda farkli tenant/user kombinasyonlari ayni key'e duserek yanlis rate limit uygulanmasina veya limit bypass/false-positive durumuna yol acabilir.

Ornek collision:
- `{ tenantId: "a:b", userId: "c", collectionId: "d", operation: "query" }`
- `{ tenantId: "a", userId: "b:c", collectionId: "d", operation: "query" }`
Mevcut join ile ikisi de `a:b:c:d:query` olabilir.

Amac:
Rate limit key uretimi structured ve collision-safe olsun. Farkli tenant/user/collection/operation tuple'lari asla sadece ayirici karakter yuzunden ayni bucket'a dusmemeli.

Yapilacaklar:
1. Once failing unit test ekle:
   - Uygun dosya: `test/observability.test.ts` veya yeni `test/rateLimit.test.ts`.
   - Yukaridaki collision ornegini kullan.
   - `maxRequestsPerWindow: 1` ile ilk tuple allowed olduktan sonra ikinci farkli tuple da allowed olmali.
   - Mevcut kodda ikinci tuple ayni key'e dusecegi icin test fail etmeli.
2. `createRateLimitKey(...)` guncelle:
   - Structured key kullan. Ornek kabul edilebilir yaklasimlar:
     - `JSON.stringify([tenantId, userId, collectionId, operation])`
     - veya her parcayi length-prefix ile encode etmek.
   - Key deterministik olmali.
   - Testlerde exact string'e gereksiz baglanma; collision-free davranisi test et.
3. Opsiyonel ama onerilir:
   - `createInMemoryRequestRateLimiter` expired bucket'lari firsat buldukca prune etsin veya map'in suresiz buyumesini engelleyen basit bir cleanup mekanizmasi eklesin.
   - Eger prune eklersen bunu disari debug API acmadan davranis testiyle veya kucuk internal helper unit testiyle kanitla.
4. Rate limit HTTP contract'ini koru:
   - `429 RATE_LIMIT_EXCEEDED`.
   - `Retry-After`, `X-RateLimit-*` header'lari.
   - Rate limit input boyutlari tenant/user/collection/operation olarak kalmali.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 28: Rate Limit Key Collision Hardening` basligi altinda kisa kayit ekle.

Dikkat:
- Collection/user/tenant boyutlarini kaldirma.
- Limiter'i route icine tasima; merkezi middleware contract'i korunmali.
- Testler gercek HTTP server gerektirmeden unit seviyesinde calisabilmeli; istersen mevcut acceptance rate limit testini de koru.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd run build`
4. `npm.cmd test`
5. `npm.cmd run test:integration`

Final cevapta:
- Key collision regression testini ozetle.
- Yeni key encoding yaklasimini yaz.
- Degisen dosyalari ve komut sonuclarini yaz.
- notes/done.md icine Prompt 28 kaydini ekledigini belirt.
```

## Prompt 29: Recursive Directory Ingestion

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin veri yukleme (ingestion) asamasinda directory source desteÄŸini recursive (ic ice dizinleri tarayacak) hale getirmektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "src/ingestion/pipeline.ts"
- "Faz 5: Backend Operasyonel Olgunluk"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku.

Bug/Limitation:
`src/ingestion/pipeline.ts` su anda `sourcePath` bir dizin oldugunda sadece o dizinin altindaki dosyalari listeliyor. Alt dizinlerdeki dosyalar endekslenmiyor.

Amac:
Koleksiyonun `sourcePath` ayari altindaki tÃ¼m dizin hiyarsisini tarayarak desteklenen tum dosyalari toplasin.

Yapilacaklar:
1. `src/ingestion/pipeline.ts` icindeki dosya listeleme mantigini guncelle:
   - `fs.readdir` yerine recursive tarama yapan bir mantik kullan (orn. `withFileTypes: true` ile dongu veya `glob` pattern).
   - Gizli dizinleri (.git, node_modules vb.) ignore etmeyi unutma.
2. Performans:
   - Cok derin dizin yapilarinda veya cok fazla dosyada sistemin kilitlenmesini onlemek icin asenkron isleme dikkat et.
3. Test ekle:
   - Test data dizini altinda bir sub-directory yarat ve icine test dosyasi koy.
   - Reindex isinin bu dosyayi da bulup endeksledigini dogrula.
4. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 29: Recursive Directory Ingestion` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Recursive tarama yaklasimini ozetle.
- notes/done.md icine Prompt 29 kaydini ekledigini belirt.
```

## Prompt 30: Admin Job Cancellation and Abort Handling

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin admin API uzerinden calisan veya sirada bekleyen (queued) index islerini iptal etme yetenekleri eklemektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Index/Rebuild Path"
- "Yeni Endpoint Kontratlari"
- "src/indexing/jobs.ts"

Ayrica calismaya baslamadan once notes/done.md ve notes/plan-parity-audit.md dosyalarini oku.

Amac:
Uzun suren veya hatalÄ± baslatilmis bir reindex isini durdurabilmek.

Yapilacaklar:
1. `POST /v1/admin/jobs/:jobId/cancel` endpoint'ini ekle:
   - Sadece `queued` veya `running` durumundaki isler iptal edilebilir.
   - Is `cancelled` durumuna gecmeli.
   - Response `200 OK` veya `204 No Content`.
2. Registry guncelleme:
   - `CollectionRegistry` interface'ine `cancelIndexJob(jobId)` ekle.
   - Is `running` ise ilgili physical collection `failed_build` olarak isaretlenmeli.
3. Job Runner entegrasyonu:
   - `IndexJobRunner` iptal edilen isleri durdurabilmeli.
   - `AbortSignal` kullanarak devam eden `buildPhysicalCollection` islemini sonlandir (Chroma/Ollama istegi varsa iptal edilmeli).
4. Test ekle:
   - Queued bir isi iptal et.
   - Running bir isi iptal et ve build isleminin abort sinyali aldigini dogrula.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 30: Admin Job Cancellation` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd test`

Final cevapta:
- Iptal mekanizmasini ozetle.
- notes/done.md icine Prompt 30 kaydini ekledigini belirt.
```

## Prompt 31: Logical Collection Deletion API

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin bir logical collection'i ve ona bagli tum fiziksel verileri (registry ve Chroma) tamamen silme yetenegi eklemektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku.

Amac:
Kullanilmayan veya hatalÄ± olusturulan koleksiyonlari sistemden tamamen temizleyebilmek. Proje henuz gelistirme asamasinda oldugu icin dogrudan silme (hard delete) tercih edilebilir.

Yapilacaklar:
1. `DELETE /v1/admin/collections/:collectionId` endpoint'ini ekle.
2. Registry Guncelleme:
   - Koleksiyon kaydini registry'den sil.
   - Bagli tum `physical_collections` kayitlarini `delete_pending` durumuna al.
3. Cleanup Entegrasyonu:
   - Mevcut retention cleanup mekanizmasi bu fiziksel koleksiyonlari Chroma'dan temizleyecektir.
4. Test ekle:
   - Bir koleksiyonu sil ve artik listede gorunmedigini, fiziksel kayitlarinin temizlige dustugunu dogrula.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 31: Logical Collection Deletion API` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Silme akisini ozetle.
- notes/done.md icine Prompt 31 kaydini ekledigini belirt.
```

## Prompt 32: Graceful Server Termination

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin server surecinin (process) sonlandirilma sinyallerini (SIGTERM, SIGINT) yakalayarak SQLite kilitlenmelerini onlemektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku.

Problem:
`Ctrl+C` ile server kapatildiginda SQLite baglantilari acik kalabiliyor ve sonraki baslatmalarda "database is locked" hatalari alinabiliyor.

Amac:
Gelistirme sirasinda sikca yapilan kapat/ac islemlerini stabil hale getirmek.

Yapilacaklar:
1. `src/server.ts` icinde `SIGINT` ve `SIGTERM` sinyallerini yakala.
2. Shutdown Akisi:
   - `server.close()` ile HTTP dinlemesini durdur.
   - `jobRunner.shutdown()` ile bekleyen islerin bitmesini sagla.
   - `registry.close()` ile SQLite baglantisini guvenle kapat.
3. Timeout:
   - Drain islemi cok uzun surerse (orn. 10 saniye), sureci zorla sonlandir.
4. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 32: Graceful Server Termination` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Kapanis siralamasini yaz.
- notes/done.md icine Prompt 32 kaydini ekledigini belirt.
```

## Prompt 33: Document Source Hashing for Change Detection

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin her belgenin icerik ozetini metadata'da saklayarak degisiklik tespiti altyapisini kurmaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku.

Amac:
Gelecekteki artimli (incremental) indeksleme icin temel olusturmak.

Yapilacaklar:
1. `src/ingestion/pipeline.ts` icinde dosya okunurken iceriginden bir hash (MD5 veya SHA256) uret.
2. Bu hash degerini `Document` metadata'sina `sourceHash` olarak ekle.
3. Chunk'lara bolunurken bu hash'in korundugundan emin ol.
4. Test ekle:
   - Endekslenen chunk metadata'sinda `sourceHash` oldugunu ve dosya icerigi degisince hash'in degistigini dogrula.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 33: Document Source Hashing` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd test`

Final cevapta:
- Kullanilan algoritmayi yaz.
- notes/done.md icine Prompt 33 kaydini ekledigini belirt.
```

## Prompt 34: Test Suite Typecheck and Mock Synchronization

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin test suite'inde (test files) arayuz (interface) guncellemeleri sonrasi olusan TypeScript derleme hatalarini (Typecheck Failures) gidermektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku.

Problem:
Son promptlar ile `IndexJobRunner`, `CollectionRegistry` arayuzlerine yeni metotlar (`abort`, `cancelIndexJob`, `deleteCollection`) ve `IndexJob` tipine `targetEmbeddingModel` eklendi. Ancak test dosyalarindaki mock/stub nesneleri guncellenmedigi icin `npm run typecheck:test` komutu su an 6 adet hata veriyor.

Amac:
Test dosyalarindaki mock nesnelerini yeni tiplerle uyumlu hale getirip derleme hatalarini %100 gidermek.

Yapilacaklar:
1. `test/acceptance/api.endpoints.test.ts` guncelle:
   - `jobRunner` mock nesnesine no-op `abort(jobId)` metodunu ekle.
2. `test/app.foundation.test.ts` guncelle:
   - Registry mock nesnesine no-op `cancelIndexJob(jobId)` ve `deleteCollection(context, collectionId)` metodlarini ekle.
3. `test/indexing.cleanup.test.ts` guncelle:
   - `jobRunner` mock nesnesine no-op `abort(jobId)` metodunu ekle.
4. `test/indexing.jobs.test.ts` guncelle:
   - Mocked `IndexJob` nesnelerine `targetEmbeddingModel: "embed-test"` alanini ekle.
   - `getJob`, `markIndexJobRunning`, `failIndexJob` stub'larindaki donen nesnelerin tip uyumunu sagla.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 34: Test Suite Typecheck and Mock Synchronization` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd run typecheck:test`
3. `npm.cmd test`

Final cevapta:
- Duzeltilen dosyalari listele.
- notes/done.md icine Prompt 34 kaydini ekledigini belirt.
```

## Prompt 35: Auto-Fill Collection Creation Defaults from Config

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin koleksiyon olusturma endpoint'ini (`POST /v1/admin/collections`) daha kullanici dostu hale getirmek ve eksik parametreleri otomatik tamamlamaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle "Yeni Endpoint Kontratlari" ve "src/config.ts" bolumlerine odaklan.

Problem:
Åu anki `createCollectionSchema` zod validation semasi neredeyse tum alanlari (`embeddingModel`, `chunkSize`, `retrievalK` vb.) zorunlu kiliyor. Ancak planda bu alanlarin config'teki `collectionDefaults` ve `ollama` default'lari ile otomatik doldurulabilecegi belirtilmisti.

Amac:
Kullanici sadece `displayName` ve `sourcePath` (ve gerekiyorsa `description`) gondererek koleksiyon olusturabilsin. Gonderilmeyen diger alanlar sistem config'inden devralinsin.

Yapilacaklar:
1. `src/http/adminRouter.ts` icindeki `createCollectionSchema` semasini guncelle:
   - `displayName`, `sourcePath` ve `ozelgeDataPath` disindaki alanlari opsiyonel (`optional()`) yap.
2. Default Tamamlama Mantigi:
   - Router handler'da, gelen istekteki eksik alanlari `runtimeConfig.collectionDefaults` alanlariyla birlestir (merge).
   - `embeddingModel` gonderilmediyse `runtimeConfig.ollamaEmbeddingModel` kullan.
   - `chatModel` gonderilmediyse `runtimeConfig.ollamaChatModel` kullan.
3. Test ekle:
   - Sadece `displayName`, `sourcePath` ve `ozelgeDataPath` gondererek koleksiyon olustur.
   - Olusturulan koleksiyonun `chunkSize`, `retrievalK`, `embeddingModel` vb. alanlarinin config default'lariyla eslestigini assert et.
4. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 35: Auto-Fill Collection Creation Defaults from Config` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd test`

Final cevapta:
- Varsayilan tamamlama yaklasimini ozetle.
- notes/done.md icine Prompt 35 kaydini ekledigini belirt.
```

## Prompt 36: Robust Collection Deletion with Job Cascade and FK Integrity

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin bir logical collection silindiginde (`DELETE /v1/admin/collections/:collectionId`) veritabani bÃ¼tÃ¼nlÃ¼gÃ¼nÃ¼ (Foreign Key integrity) korumak ve bagli background islerini guvenle sonlandirmaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku.

Problem:
Mevcut `deleteCollection` metodu `foreign_keys = OFF` yaparak collections kaydini siliyor ancak `index_jobs` tablosundaki iliskili kayitlar silinmis koleksiyona isaret etmeye (dangling reference) devam ediyor. Ayrica eger o an calisan bir is varsa, worker `completeIndexJob` sirasinda collection bulunamadigi icin crash oluyor ve fiziksel Chroma verileri temizlik listesine girmeden sÄ±zÄ±yor.

Amac:
Koleksiyon silindiginde, o koleksiyona ait bekleyen ve koÅŸan tÃ¼m index isleri iptal edilmeli, fiziksel kayitlar temizlige atilmali ve veritabaninda tutarsiz foreign key kayitlari birakilmamalidir.

Yapilacaklar:
1. `deleteCollection` metodunu transaction icinde guncelle (`src/collections/sqliteRegistry.ts`):
   - Koleksiyona bagli `queued` ve `running` durumundaki `index_jobs` kayitlarini `cancelled` durumuna getir.
   - Bagli tum `physical_collections` kayitlarini `delete_pending` ve `delete_after = now` yap (boylece hemen temizlenirler).
   - `DELETE FROM index_jobs WHERE collection_id = @collectionId` ile tamamlanmis veya iptal edilmis diger tum isleri de temizleyebilirsin ya da koruyup status `cancelled` yapabilirsin. `foreign_keys` constraints korundugundan collections silinmeden once `index_jobs` temizlenmis veya iliskisiz olmalidir (ya da CASCADE davranisi kurulmali).
   - `foreign_keys = OFF` hilesini tamamen kaldir veya guvenli cascade kullan.
2. Background Worker Abort Entegrasyonu:
   - Eger silinen koleksiyona ait koÅŸan bir is varsa, `IndexJobRunner` bunu `SIGINT` gibi iptal etmeli (Prompt 30'da eklenen abort/cancel mantigiyla).
   - Worker, is tamamlanmaya calistiginda koleksiyonun silindigini fark ederse unhandled error firlatmadan sessizce abort olmali.
3. Test ekle:
   - Calisan bir index isi olan koleksiyonu sil.
   - Veritabaninda foreign key violation kalmadigini dogrula.
   - IsÄ±n abort edildigini ve fiziksel verilerin `delete_pending` ile Chroma'dan silinmek uzere isaretlendigini assert et.
4. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 36: Robust Collection Deletion with Job Cascade` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd test`

Final cevapta:
- Cascade ve iptal mantigini ozetle.
- notes/done.md icine Prompt 36 kaydini ekledigini belirt.
```

## Prompt 37: Fault-Tolerant Ingestion Pipeline

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin veri yukleme asamasinda tek bir bozuk/kilitli dosya yÃ¼zÃ¼nden tÃ¼m indeksleme (reindex) isinin cokmesini engellemek ve pipeline'i hataya dayanikli (fault-tolerant) hale getirmektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku.

Problem:
`src/ingestion/pipeline.ts` icindeki `loadFileDocuments` metodu dizin altindaki dosyalari listeler ve her birini yukler. Eger bir adet PDF bozuksa veya kilitliyse, loader hata firlatir ve tÃ¼m `runIndexJob` islemi Ã§Ã¶ker. Buyuk klasorlerde tek bir bozuk dosya yuzunden tum indekslemenin durmasi kabul edilemez.

Amac:
Dizin indekslenirken, okunamayan/yuklenemeyen dosyalar loglanmali, `unsupportedFiles` listesine hata mesajiyla eklenmeli ve geri kalan saglikli dosyalarin indekslenmesine devam edilmelidir.

Yapilacaklar:
1. `src/ingestion/pipeline.ts` icindeki `analyzeIndexingSource` metodunu guncelle:
   - Dosya bazli dongude, `loadFileDocuments` cagrisini bir `try-catch` blogu icine al.
2. Hata Yakalama ve Raporlama:
   - Eger bir dosya yuklenirken hata firlatirsa, bu hatayi yakala ve logla (operational logging).
   - Bu dosyayi `unsupportedFiles` listesine ekle: `{ path: filePath, extension: ext, reason: `Failed to load: ${error.message}` }`.
   - Ä°ndeksleme akisini durdurma, bir sonraki dosyaya gec.
3. IsÄ±n SÄ±nÄ±rlarÄ±:
   - Eger dizindeki *tÃ¼m* dosyalar hata verirse, is en sonunda bos dÃ¶kÃ¼man sebebiyle zaten dogal olarak basarisiz olmalidir (hiÃ§ dÃ¶kÃ¼man kalmadi uyarisiyla).
4. Test ekle:
   - Test data dizine okunamayacak/bozuk veya gecersiz formatta bir dosya ekle (veya mock loader firlattir).
   - Reindex isinin Ã§Ã¶kmedigini, diger saglikli dÃ¶kÃ¼manlari basariyla indeksledigini ve bozuk dÃ¶kÃ¼mani `unsupportedFiles` icinde raporladigini verify et.
5. notes/done.md guncelle:
   - Dosyanin sonuna `## Prompt 37: Fault-Tolerant Ingestion Pipeline` basligi altinda kisa kayit ekle.

Dogrulama:
1. `npm.cmd run typecheck`
2. `npm.cmd test`

Final cevapta:
- Hata yakalama ve tolerans mantigini ozetle.
- notes/done.md icine Prompt 37 kaydini ekledigini belirt.
```

## Prompt 38: Queued Job Cancellation Must Restore Collection State

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin queued durumdaki bir index job iptal edildiginde collection state'inin tutarli kalmasini saglamaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Index/Rebuild Path"
- "HTTP Hata Kodlari"
- "Yeni Endpoint Kontratlari"
- "Registry Semasi"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 30, 31, 36 ve 37 kayitlarini ozellikle kontrol et. Daha once yapilanlari tekrar yazma; sadece bu prompttaki bug'i kapat.

Problem:
`src/collections/sqliteRegistry.ts` icindeki `cancelIndexJob(jobId)` queued job'u `cancelled` yapiyor ama collection status'unu guncellemiyor. Ilk build icin queued job iptal edilirse collection `indexing` durumunda, active job olmadan ve active physical olmadan takili kalabiliyor. Bu da kullanicinin collection'i "indeksleniyor" sanmasina ve backend'in sonsuz not-ready state uretmesine neden olur.

Amac:
Queued veya running job iptal edildiginde collection status her zaman deterministik olmali:
- Collection'in `active_physical_collection` degeri varsa status `ready` olmali.
- Collection'in `active_physical_collection` degeri yoksa status `failed` olmali.
- Iptalden sonra ayni collection icin `getActiveJobForCollection(...)` null donmeli.
- Queued job iptalinde fiziksel Chroma collection kaydi olusturulmamis olabilir; bu normaldir.

Yapilacaklar:
1. `src/collections/sqliteRegistry.ts` icindeki `cancelIndexJob(jobId)` metodunu dar kapsamda duzelt:
   - `existing.status === "queued"` ve `existing.status === "running"` icin collection status'unu ayni kuralla guncelle.
   - Running job icin var olan target physical `failed_build` isaretleme davranisini koru.
   - Queued job icin target physical record yoksa yeni physical record yaratma.
   - `updated_at` alanini collection ve job icin guncel tut.
   - `existing.status === "cancelled"` idempotent kalmali ve ayni job'u tekrar dondurmeli.
2. `src/http/adminRouter.ts` icindeki `POST /v1/admin/jobs/:jobId/cancel` endpoint'i bu registry davranisini kullanmaya devam etmeli. Endpoint response kontratini genisletme.
3. Baska endpoint, Chroma helper veya RAG query/retrieve davranisini degistirme.

Testleri once ekle, sonra fix'i yaz:
1. `test/collections.registry.test.ts` icine queued ilk build iptali testi ekle:
   - Collection yarat.
   - `beginIndexJob(...)` ile job'u queued baslat.
   - `cancelIndexJob(job.id)` cagir.
   - Job status `cancelled` olmali.
   - `getActiveJobForCollection(...)` null olmali.
   - Collection status `failed` olmali.
   - Collection `activePhysicalCollection` undefined kalmali.
   - Target physical record yoksa bu kabul edilmeli; varsa `active` olmamali.
   - `cancelIndexJob(job.id)` ikinci kez cagrildiginda hata firlatmamali.
2. `test/collections.registry.test.ts` icine ready collection rebuild iptali testi ekle:
   - Collection'i once active physical ile `ready` yap.
   - Yeni queued reindex job baslat.
   - Job'u iptal et.
   - Collection status tekrar `ready` olmali.
   - Eski `activePhysicalCollection` ve `activeVersion` korunmali.
3. Mumkunse `test/acceptance/api.endpoints.test.ts` icinde admin cancel endpoint'i icin queued job testi ekle:
   - Fake `jobRunner.abort(jobId)` registry `cancelIndexJob(jobId)` cagirsin.
   - `POST /v1/admin/jobs/:jobId/cancel` 204 donsun.
   - Sonrasinda ready response `activeJob: null`, `status: "failed"` ve query/retrieve capability false donsun.

Atomik komutlar:
1. `node --import tsx --test test/collections.registry.test.ts`
2. `node --import tsx --test test/acceptance/api.endpoints.test.ts`
3. `npm.cmd run typecheck`
4. `npm.cmd run typecheck:test`
5. `npm.cmd test`

Dikkat:
- Bu prompt deletion, Chroma cleanup veya build pipeline refactor'u yapmayacak.
- Collection'i `indexing` veya `creating` durumunda active job olmadan birakma.
- Iptal edilen job'u `failed` yapma; job status `cancelled` kalmali.

notes/done.md:
- Is bitince dosyanin sonuna `## Prompt 38: Queued Job Cancellation Must Restore Collection State` basligi altinda yaptiklarini, ekledigin testleri ve calistirdigin komutlari yaz.

Final cevapta:
- Queued cancel sonrasi collection status kuralini ozetle.
- Eklenen testleri ve komut sonuclarini yaz.
- notes/done.md kaydini ekledigini belirt.
```

## Prompt 39: Cancelled Running Jobs Must Not Become Failed After Abort Race

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin running index job iptal edilirken worker ile registry arasindaki yarisi idempotent ve hatasiz hale getirmektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Index/Rebuild Path"
- "`src/indexing/jobs.ts`"
- "Backpressure / Timeout / Coklu Kullanici"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 30, Prompt 32, Prompt 36 ve Prompt 38 kayitlarini ozellikle kontrol et.

Problem:
`src/indexing/jobs.ts` icindeki `runIndexJob(...)` catch blogu her hatada `registry.failIndexJob(jobId, message)` cagiriyor. Ancak `jobRunner.abort(jobId)` once registry'de job'u `cancelled` yaparsa, build daha sonra `Build aborted` firlattiginda `failIndexJob` cancelled job'u failed yapmaya calisir ve hata firlatir. Bu durum background runner'da gereksiz `INDEX_JOB_UNHANDLED_ERROR` log'una veya job state tutarsizligina yol acabiliyor.

Ayrica `src/indexing/buildPhysicalCollection.ts` icindeki final `assertReadable(...)` cagrisi mevcut `AbortSignal` bilgisini Chroma readability helper'ina gecirmiyor. Iptal edilen build, readability check sirasinda gereksiz bekleyebilir.

Amac:
Iptal edilmis veya abort sinyali almis running job asla `failed` durumuna zorlanmamali. Iptal akisi su sekilde olmali:
- Registry job status `cancelled` ise `runIndexJob(...)` bunu final state kabul edip return etmeli.
- `signal.aborted === true` ve job henuz running ise `registry.cancelIndexJob(jobId)` cagrilip job `cancelled` yapilmali.
- Abort kaynakli hata icin `INDEX_JOB_FAILED` veya `INDEX_JOB_UNHANDLED_ERROR` operasyonel log'u uretilmemeli.
- Normal build hatalari eskisi gibi `failed` kalmali.

Yapilacaklar:
1. `src/indexing/jobs.ts` icindeki catch blogunu guncelle:
   - Hata mesaji `"Build aborted"` ise veya `signal?.aborted` true ise once `registry.getJob(jobId)` ile current state'i oku.
   - Current job `cancelled` ise onu return et.
   - Current job `queued` veya `running` ise `registry.cancelIndexJob(jobId)` cagir ve cancelled job'u return et.
   - Bu abort/cancel branch'inde failed log uretme; istersen `status: "cancelled"` operasyonel log ekle.
   - Normal hata branch'i eskisi gibi `failIndexJob` kullanmali.
2. `src/indexing/buildPhysicalCollection.ts` icinde `assertReadable(...)` cagrisi su bilgileri almali:
   - `abortSignal: signal`
   - `timeoutMs: runtimeConfig.readyTimeoutMs`
3. `src/indexing/jobRunner.ts` icinde abort kaynakli hata zaten `runIndexJob` tarafindan swallow/return ediliyorsa runner ek unhandled log uretmemeli. Gerekirse sadece dar kapsamli adjustment yap.
4. Bu promptta collection deletion davranisini veya registry semasini degistirme.

Testleri once ekle, sonra fix'i yaz:
1. `test/indexing.jobs.test.ts` icine "cancelled running job returns cancelled instead of failed" testi ekle:
   - Collection yarat ve reindex job baslat.
   - `runIndexJob(...)` icin fake `buildPhysicalCollection` kullan.
   - Fake build once `registry.cancelIndexJob(job.id)` cagirsin, sonra `new Error("Build aborted")` firlatsin.
   - `runIndexJob(...)` hata firlatmamali.
   - Final job status `cancelled` olmali.
   - Final job status `failed` olmamali.
   - Operational log'larda `INDEX_JOB_FAILED` veya `INDEX_JOB_UNHANDLED_ERROR` olmamali.
2. `test/indexing.jobs.test.ts` icine "aborted signal cancels running job when registry has not cancelled yet" testi ekle:
   - AbortController olustur ve build fake'i icinde `controller.abort()` yapip `Build aborted` firlat.
   - Final job `cancelled` olmali.
3. `test/buildPhysicalCollection.test.ts` icine assertReadable signal propagation testi ekle:
   - Mock `assertChromaCollectionReadable` input'unu yakala.
   - `buildPhysicalCollection(...)` icine bir `AbortController.signal` gecir.
   - Mock'un `abortSignal` alaninin ayni signal oldugunu assert et.
   - `timeoutMs` de runtimeConfig.readyTimeoutMs olmali.

Atomik komutlar:
1. `node --import tsx --test test/indexing.jobs.test.ts`
2. `node --import tsx --test test/buildPhysicalCollection.test.ts`
3. `npm.cmd run typecheck`
4. `npm.cmd run typecheck:test`
5. `npm.cmd test`

Dikkat:
- Normal build failure semantigini bozma: abort olmayan hata hala failed olmali.
- Cancelled job'u tekrar failed yapma.
- Bu prompt Chroma create/delete timeout refactor'u yapmayacak; sadece mevcut readability helper'ina signal gecirecek.

notes/done.md:
- Is bitince dosyanin sonuna `## Prompt 39: Cancelled Running Jobs Must Not Become Failed After Abort Race` basligi altinda yaptiklarini, ekledigin testleri ve calistirdigin komutlari yaz.

Final cevapta:
- Abort/cancel branch'inin nasil calistigini ozetle.
- Eklenen testleri ve komut sonuclarini yaz.
- notes/done.md kaydini ekledigini belirt.
```

## Prompt 40: Empty Indexing Source Must Fail Instead Of Publishing Empty Collection

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin hic indexlenebilir dokuman veya hic chunk uretilmeyen build'lerin basarili collection olarak yayinlanmasini engellemektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Index/Rebuild Path"
- "Yeni Endpoint Kontratlari"
- "HTTP Hata Kodlari"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 37 kaydini ozellikle kontrol et.

Problem:
Prompt 37 fault-tolerant ingestion ile bozuk dosyalar tek tek atlanabiliyor. Ancak dizindeki tum dosyalar bozuksa veya desteklenen hic dokuman yoksa `buildPhysicalCollection(...)` su an `documents.length === 0` veya `indexedChunks.length === 0` durumunu acikca fail etmiyor. Bu, Chroma'ya bos `addDocuments([])` denemesi veya 0 chunk'li bir physical collection'in ready yayinlanmasi ile sonuclanabilir.

Amac:
Bos kaynaklar basarili index gibi yayinlanmamali:
- Hic indexlenebilir dokuman yoksa build fail etmeli.
- Hic chunk uretilmezse build fail etmeli.
- Target physical collection best-effort Chroma delete ile temizlenmeli.
- `runIndexJob(...)` bu normal build hatasini `failed` job olarak kaydetmeli.
- Eski active physical varsa collection `ready` kalmali; yoksa collection `failed` olmali.

Yapilacaklar:
1. `src/indexing/buildPhysicalCollection.ts` icinde acik guard ekle:
   - `analysis.documents.length === 0` ise `Error("No indexable documents found for collection ...")` veya benzer net mesaj firlat.
   - Split sonrasi `indexedChunks.length === 0` ise `Error("No indexable chunks produced for collection ...")` veya benzer net mesaj firlat.
   - Bu guard'lar catch bloguna dusmeli ve mevcut best-effort `deletePhysicalChromaCollection` calismali.
2. `src/ingestion/pipeline.ts` icindeki fault-tolerant file handling'i geri alma:
   - Tek bozuk dosya diger saglam dosyalari engellememeli.
   - Sadece sonuc tamamen bos ise build fail etmeli.
3. `src/indexing/jobs.ts` normal build error akisini bozma:
   - Bu hata abort/cancel degil; job `failed` olmali.

Testleri once ekle, sonra fix'i yaz:
1. `test/buildPhysicalCollection.test.ts` icine "fails when analysis returns no documents" testi ekle:
   - Mock `analyzeIndexingSource` bos `documents: []` dondursun.
   - Mock `createPhysicalChromaCollection` cagrildigini assert edebilirsin.
   - Mock `splitDocuments` ve `vectorStore.addDocuments` cagrilmamali.
   - Mock `deletePhysicalChromaCollection` target physical ile cagrilmali.
   - Promise reject olmali ve hata mesaji `No indexable documents` icermeli.
2. `test/buildPhysicalCollection.test.ts` icine "fails when splitter returns zero chunks" testi ekle:
   - Mock analysis bir Document dondursun.
   - Mock `splitDocuments` bos array dondursun.
   - `vectorStore.addDocuments` cagrilmamali.
   - Delete cleanup cagrilmali.
   - Hata mesaji `No indexable chunks` icermeli.
3. `test/indexing.jobs.test.ts` icine job-level test ekle:
   - Fake build `No indexable documents found` firlatsin.
   - Job status `failed` olmali.
   - No active physical varsa collection status `failed` olmali.
   - Eski active physical varsa collection `ready` ve eski pointer korunmali.

Atomik komutlar:
1. `node --import tsx --test test/buildPhysicalCollection.test.ts`
2. `node --import tsx --test test/indexing.jobs.test.ts`
3. `npm.cmd run typecheck`
4. `npm.cmd run typecheck:test`
5. `npm.cmd test`

Dikkat:
- Bos index'i "ready" yapma.
- Fault-tolerant ingestion'i bozma; tek dosya hatasi tum isi fail etmemeli.
- Hata mesaji kullaniciya/debug log'a yeterince acik olmali.

notes/done.md:
- Is bitince dosyanin sonuna `## Prompt 40: Empty Indexing Source Must Fail Instead Of Publishing Empty Collection` basligi altinda yaptiklarini, ekledigin testleri ve calistirdigin komutlari yaz.

Final cevapta:
- Bos dokuman ve bos chunk guard'larini ozetle.
- Eklenen testleri ve komut sonuclarini yaz.
- notes/done.md kaydini ekledigini belirt.
```

## Prompt 41: Collection Deletion Must Preserve Registry Invariants

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin logical collection deletion akisini registry invariants, cleanup metadata ve foreign key tutarliligi acisindan guvenli hale getirmektir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Onerilen Registry Modeli"
- "Registry Semasi"
- "Physical Chroma Collection Stratejisi"
- "Zero-Downtime Rebuild ve Cleanup"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 31 ve Prompt 36 kayitlarini ozellikle kontrol et.

Problem:
`src/collections/sqliteRegistry.ts` semasinda `index_jobs.collection_id` ve `physical_collections.collection_id` nullable ve `ON DELETE SET NULL`. Fakat TypeScript domain tipleri `collectionId: string` bekliyor. `deleteCollection(...)` once physical kayitlari `delete_pending` yapiyor, sonra collection row'u hard-delete ediyor; FK `SET NULL` sebebiyle cleanup ve operasyonel loglar logical collection id bilgisini kaybedebiliyor. Bu planlanan registry modeline ve mevcut type'lara ters.

Amac:
Logical collection silme, public/admin gorunurlugu kaldirmali ama registry metadata'sini bozmamali:
- Collection row hard-delete edilmemeli; `status = "archived"` ile soft-delete edilmeli.
- `listVisibleCollections` ve `getVisibleCollection` archived collection'i dondurmemeli.
- `collectionExists(collectionId)` public route'lar icin archived collection'i "var" saymamali; silinmis collection 404 davranisi vermeli.
- `index_jobs.collection_id` ve `physical_collections.collection_id` domain modelde string kalmali ve cleanup sirasinda korunmali.
- Fresh schema'da `collection_id` kolonlari `TEXT NOT NULL` olmali ve `ON DELETE SET NULL` kaldirilmali. Proje henuz gelistirme asamasinda oldugu icin migration yazma.
- Silme sirasinda physical kayitlar Chroma cleanup icin `delete_pending` + `delete_after = now` olmali; `deleted` durumundaki physical kayitlari tekrar `delete_pending` yapma.
- Archived collection complete/fail/cancel akisiyla tekrar `ready` veya `failed` olarak reaktive edilmemeli.

Yapilacaklar:
1. `src/collections/sqliteRegistry.ts` schema'yi taze DB icin duzelt:
   - `index_jobs.collection_id TEXT NOT NULL`
   - `physical_collections.collection_id TEXT NOT NULL`
   - FK'larda `ON DELETE SET NULL` kullanma.
2. `deleteCollection(context, collectionId)` metodunu hard-delete yerine archive yapacak sekilde guncelle:
   - Active `queued` ve `running` job'lari `cancelled` yap.
   - Collection status'unu `archived` yap ve `updated_at` guncelle.
   - Physical kayitlardan `status != "deleted"` olanlari `delete_pending` ve `delete_after = now` yap.
   - Active job id'lerini runner abort icin dondurmeye devam et.
3. `collectionExists(collectionId)` metodunu public visibility amacina uygun hale getir:
   - Archived collection icin false donmeli.
   - Baska tenant'a ait non-archived collection icin true donmesi 403 ayrimi icin kabul edilebilir.
4. `completeIndexJob(...)`, `failIndexJob(...)` ve `cancelIndexJob(...)` archived collection'i reaktive etmemeli:
   - Collection yoksa veya `status === "archived"` ise active pointer/status update yapma.
   - Running job target physical gerekiyorsa cleanup'a dusmeli veya failed_build kalmali; archived collection ready/failed olmamali.
5. `src/http/adminRouter.ts` endpoint kontratini degistirme; `DELETE /v1/admin/collections/:collectionId` 204 kalmali.

Testleri once ekle, sonra fix'i yaz:
1. `test/collections.registry.test.ts` icine deletion invariant testi ekle:
   - Collection yarat, physical record yarat.
   - `deleteCollection(...)` cagir.
   - `getVisibleCollection(...)` null donmeli.
   - `collectionExists(collection.id)` false donmeli.
   - Raw SQLite sorgusu ile `collections` tablosunda row'un kaldigini ve `status = "archived"` oldugunu dogrula.
   - `getPhysicalCollection(physicalName)` `collectionId` olarak eski collection id'yi korumali.
   - Physical status `delete_pending`, `deleteAfter` dolu olmali.
   - `PRAGMA foreign_key_check` bos donmeli.
2. `test/collections.registry.test.ts` icine "deleted physical is not resurrected" testi ekle:
   - Collection'a ait bir physical kaydi once `deleted` yap.
   - Collection'i sil.
   - O physical kayit `deleted` kalmali, tekrar `delete_pending` olmamali.
3. `test/indexing.cleanup.test.ts` veya uygun registry testine cleanup metadata testi ekle:
   - Delete sonrasi `listDuePhysicalCollectionsForCleanup(...)` donen kaydin `collectionId` alaninin null degil eski id oldugunu assert et.
4. `test/acceptance/api.endpoints.test.ts` icine public/admin visibility testi ekle:
   - Admin DELETE 204 donsun.
   - Sonrasinda public `GET /v1/rag/collections/:id` 404 donsun; 403 donmemeli.
   - List endpoint silinen/archived collection'i dondurmemeli.

Atomik komutlar:
1. `node --import tsx --test test/collections.registry.test.ts`
2. `node --import tsx --test test/indexing.cleanup.test.ts`
3. `node --import tsx --test test/acceptance/api.endpoints.test.ts`
4. `npm.cmd run typecheck`
5. `npm.cmd run typecheck:test`
6. `npm.cmd test`

Dikkat:
- Migration yazma; proje henuz development asamasinda.
- Foreign key checks'i kapatma.
- `collectionId` bilgisini null'a dusurme.
- Archived collection'i query/retrieve veya reindex icin gorunur yapma.

notes/done.md:
- Is bitince dosyanin sonuna `## Prompt 41: Collection Deletion Must Preserve Registry Invariants` basligi altinda yaptiklarini, ekledigin testleri ve calistirdigin komutlari yaz.

Final cevapta:
- Hard-delete yerine archive kararini ve registry invariantlarini ozetle.
- Eklenen testleri ve komut sonuclarini yaz.
- notes/done.md kaydini ekledigini belirt.
```

## Prompt 42: Public Ready Contract Must Hide Physical Storage Names

```text
Bu repo Vanilla RAG Backend repo'sudur. Gorevin public RAG ready endpoint'inin internal Chroma physical collection adlarini son kullaniciya sizdirmamasini saglamaktir.

Bu prompt cold-start calisacak bir coding agent'a verilecektir. Once mutlaka notes/multicollection.md dosyasini oku. Ozellikle su bolumlere gore calis:
- "Yeni Endpoint Kontratlari"
- "Collection ID ve Endpoint Path Karari"
- "Physical Chroma Collection Stratejisi"

Ayrica calismaya baslamadan once notes/done.md dosyasini oku. Prompt 26 kaydini ozellikle kontrol et.

Problem:
Prompt 26 public collection detail DTO'sundan internal alanlari temizledi. Ancak `GET /v1/rag/collections/:collectionId/ready` response'u hala `activePhysicalCollection` ile Chroma physical collection adini public API'de donduruyor. Physical collection adi tenant, logical collection id ve version bilgilerini tasiyan internal storage identifier'dir. Son kullanici logical collection id ve public linklerle calismali; Chroma physical name bilmek zorunda degil.

Amac:
Public ready endpoint internal storage name dondurmemeli:
- `activePhysicalCollection` response alanini kaldir.
- Yerine sadece boolean `hasActivePhysicalCollection` dondur.
- `activeVersion`, `activeJob`, `chromaReadable`, `chromaCount`, `modelAvailability` ve `capabilities` alanlari korunabilir.
- Query/retrieve handler'lari ve operational logs internal physical name kullanmaya devam edebilir.
- Admin job response'larinda `targetPhysicalCollection` kalabilir; bu prompt sadece public RAG ready endpoint icindir.

Yapilacaklar:
1. `src/http/ragRouter.ts` icindeki ready response'u guncelle:
   - `activePhysicalCollection: ...` alanini kaldir.
   - `hasActivePhysicalCollection: Boolean(collection.activePhysicalCollection)` ekle.
2. `test/acceptance/api.endpoints.test.ts` icindeki ready endpoint beklentilerini guncelle:
   - Response'ta `activePhysicalCollection` property olmadigini assert et.
   - `hasActivePhysicalCollection` true/false beklentilerini ekle.
   - Query/retrieve'in hala dogru internal physical collection'i kullandigini mevcut handler call assert'leriyle koru.
3. `test/docs.contract.test.ts`, `README.md` ve `test_frontend/index.html` icinde public ready kontrati dokumante ediliyorsa yeni alan adina gore guncelle.
4. Eski `activePhysicalCollection` alanina compatibility alias ekleme.

Testleri once ekle, sonra fix'i yaz:
1. Ready endpoint active physical yokken:
   - `hasActivePhysicalCollection === false`
   - `"activePhysicalCollection" in body === false`
   - `capabilities.query === false`
2. Ready endpoint active physical varken:
   - `hasActivePhysicalCollection === true`
   - `"activePhysicalCollection" in body === false`
   - Chroma/model uygunsa query/retrieve capability true kalmali.
3. Public collection detail DTO sanitization testi hala gecmeli:
   - `activePhysicalCollection`, `sourcePath`, `ozelgeDataPath`, model/config alanlari public detail DTO'da olmamali.

Atomik komutlar:
1. `node --import tsx --test test/acceptance/api.endpoints.test.ts`
2. `node --import tsx --test test/docs.contract.test.ts`
3. `node --import tsx --test test/frontend.static.test.ts`
4. `npm.cmd run typecheck`
5. `npm.cmd run typecheck:test`
6. `npm.cmd test`

Dikkat:
- Physical collection adini public ready response'a baska isimle tekrar koyma.
- Query/retrieve'in internal active physical kullanmasini bozma.
- Admin endpoint kontratini bu promptta dar kapsam disinda degistirme.

notes/done.md:
- Is bitince dosyanin sonuna `## Prompt 42: Public Ready Contract Must Hide Physical Storage Names` basligi altinda yaptiklarini, ekledigin testleri ve calistirdigin komutlari yaz.

Final cevapta:
- Public ready response'tan hangi internal alanin kaldirildigini yaz.
- Eklenen/guncellenen testleri ve komut sonuclarini yaz.
- notes/done.md kaydini ekledigini belirt.
```
