# Multi-Collection Refactor Coding Agent Prompts

Bu dosyadaki promptlar sırayla ayrı coding agent oturumlarına verilecek şekilde yazılmıştır. Her prompt, yeni agent'ın sıfır context ile çalışacağını varsayar. Her agent önce [notes/multicollection.md](notes/multicollection.md) dosyasını okumalı, özellikle kendi promptunda belirtilen bölümlere göre implementation yapmalıdır.

Genel kural:

- Promptları sırayla kullan.
- Her prompt sonunda `npm.cmd run build` ve ilgili test komutları çalışmalı.
- Bir prompt önceki promptların çıktısını bekliyorsa, agent önce repo durumunu kontrol etmeli. Önceki faz eksikse kod yazmaya başlamadan bunu raporlamalı.
- Eski `/rag/query` ve `/rag/retrieve` endpointleri korunmayacak. Geriye dönük uyumluluk, redirect, default fallback veya config-backed default registry eklenmeyecek.
- Ana referans doküman her zaman [notes/multicollection.md](notes/multicollection.md).
- Her agent çalışmaya başlamadan önce [notes/done.md](notes/done.md) dosyasını okumalı ve önceki agentların ne yaptığını anlamalıdır.
- Her agent kendi görevlerini tamamladıkça [notes/done.md](notes/done.md) dosyasına uygun bir başlık altında yaptıklarını, değiştirdiği ana dosyaları, çalıştırdığı doğrulama komutlarını ve varsa kalan riskleri eklemelidir.
- [notes/done.md](notes/done.md) dosyası coordination log'dur; kısa ama somut yazılmalı, implementation detayları gereksiz uzatılmamalıdır.

## Prompt 1: Foundation, Test Harness, App Bootstrap

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin multi-collection refactor için foundation katmanını hazırlamak.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Kısa Karar"
- "Coding Agent İçin Uygulama Blueprint'i"
- "`src/app.ts` ve `src/server.ts`"
- "HTTP Hata Kodları"
- "Coding Agent Çalışma Sırası"
- "Faz 0" ve "Faz 0.5"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Önceki agentların tamamladığı işleri ve kalan riskleri dikkate al.

Amaç:
Express app bootstrap'ını test edilebilir hale getir, test altyapısını ekle ve eski public RAG endpointlerini kaldırmaya başla. Bu prompt registry veya Chroma indexing implementation yapmayacak; sadece foundation kuracak.

Yapılacaklar:
1. `package.json` içine test script'i ekle:
   - `"test": "node --import tsx --test \"test/**/*.test.ts\""`
2. `src/app.ts` oluştur:
   - `createApp(deps)` export et.
   - Express middleware, JSON parser, invalid JSON error handler, `/health`, `/ready`, `/test-frontend` static route ve root route burada kurulsun.
   - İlk aşamada registry dependency type'ı placeholder olabilir ama shape net olsun:
     `type AppDependencies = { registry?: unknown }`
   - `app.listen` burada çağrılmasın.
3. `src/server.ts` sade bootstrap dosyasına dönsün:
   - config import et.
   - `createApp(...)` çağır.
   - `app.listen(config.port, ...)` sadece burada kalsın.
4. Eski public endpointleri kaldır:
   - `GET /rag/query`
   - `GET /rag/retrieve`
   - `POST /rag/query`
   - `POST /rag/retrieve`
   Bu endpointlere compatibility, redirect veya fallback ekleme.
5. Root endpoint cevabını yeni hedef API yönünü gösterecek şekilde güncelle:
   - `/v1/rag/collections`
   - `/v1/rag/collections/:collectionId/query`
   - `/v1/rag/collections/:collectionId/retrieve`
   Bu endpointler bu promptta implement edilmek zorunda değil; sonraki promptlarda gelecek.
6. `test/app.foundation.test.ts` ekle:
   - `GET /health` 200 dönmeli.
   - `GET /` 200 dönmeli ve yeni `/v1/rag/collections` yönünü göstermeli.
   - Eski `/rag/query` ve `/rag/retrieve` endpointleri artık 404 veya route-not-found davranışı göstermeli. 405 dönmemeli.
7. `src/http/requestContext.ts` ekle:
   - `createRequestContext(req)` veya benzeri helper export et.
   - Şimdilik `tenantId = "default"`, `userId = "local-dev"` ve random/request id üretimi yeterli.
8. `src/http/errors.ts` ekle:
   - Ortak error response helper/type iskeleti ekle.
   - Henüz tüm error mapping'i bitirmek zorunda değilsin, ama sonraki promptların kullanacağı shape hazır olsun.

Dikkat:
- `notes/multicollection.md` eski endpointleri kaldırmayı net söylüyor. Eski endpointleri canlı tutma.
- Registry, SQLite, Chroma physical collection ve indexing job bu promptun kapsamı dışında.
- `GET /ready` mevcut davranışını şimdilik koruyabilir; sonraki promptlarda registry-aware yapılacak.
- TypeScript build kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Değişen dosyaları listele.
- Eski endpointlerin kaldırıldığını belirt.
- Çalıştırdığın komutları ve sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 1: Foundation, Test Harness, App Bootstrap" başlığı altında yaptıklarını eklediğini belirt.
```

## Prompt 2: Collection IDs, Config Shape, SQLite Registry

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin multi-collection refactor için collection ID üretimi, config hedef şekli ve SQLite registry katmanını implement etmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "`src/config.ts`"
- "Önerilen Registry Modeli"
- "Coding Agent İçin Uygulama Blueprint'i"
- "Registry Storage Kararı"
- "Registry Şeması"
- "`src/collections/types.ts`"
- "`src/collections/ids.ts`"
- "Faz 2: Collection Registry Ekle"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1 çıktılarının gerçekten tamamlandığını ve önceki agentın not ettiği riskleri kontrol et.

Bu prompt, Prompt 1'in tamamlandığını varsayar. Başlamadan önce kontrol et:
- `src/app.ts` var mı?
- `package.json` içinde `test` script'i var mı?
- Eski `/rag/query` ve `/rag/retrieve` endpointleri kaldırılmış mı?
Eksikse kod yazmadan raporla.

Amaç:
Config'i hedef multi-collection şekline yaklaştır, SQLite registry'yi ekle ve collection ID/physical Chroma name üretimini testlerle kilitle.

Yapılacaklar:
1. Dependency ekle:
   - `better-sqlite3`
   - Dev dependency olarak `@types/better-sqlite3`
2. `config/rag.config.yaml` hedef yapıya dönsün:
   - `registry.path: data/registry.sqlite`
   - `chroma.url`
   - `collectionDefaults`
   - `ollama`
   - `readiness`
   - `chroma.collection` kaldırılmalı.
   - Mevcut `data.*` ve `rag.*` değerleri `collectionDefaults` altına taşınmalı.
3. `src/config.ts` güncelle:
   - `configSchema` yeni yapıyı doğrulasın.
   - `resolveConfig` `registryPath` ve `collectionDefaults` alanlarını dönsün.
   - `chromaCollection` artık runtime config alanı olmamalı.
   - Bu değişiklik build'i kırıyorsa geçici fallback ekleme; ilgili kullanımları sonraki prompta bırakmadan derlenecek şekilde uyumlu hale getir.
4. `src/collections/types.ts` oluştur:
   - `RequestContext`
   - `CollectionStatus`
   - `IndexJobStatus`
   - `RagCollection`
   - `IndexJob`
   - `CollectionRegistry` interface'i
5. `src/collections/ids.ts` oluştur:
   - `slugifyCollectionName(displayName)`
   - `generateCollectionId(displayName)`
   - `createPhysicalCollectionName({ tenantId, collectionId, version })`
   - `isValidChromaCollectionName(name)`
   - `assertValidChromaCollectionName(name)`
6. Chroma name kurallarını uygula:
   - 3-512 karakter.
   - Küçük harf veya rakamla başlar ve biter.
   - Arada küçük harf/rakam/nokta/tire/alt çizgi olabilir.
   - Ardışık nokta yok.
   - IP adresi formatı yok.
7. `src/collections/sqliteRegistry.ts` oluştur:
   - `createSqliteCollectionRegistry({ dbPath })` export et.
   - Startup'ta tabloları `CREATE TABLE IF NOT EXISTS` ile oluştur.
   - `collections` ve `index_jobs` tabloları notes/multicollection.md "Registry Şeması" ile uyumlu olsun.
   - `listVisibleCollections(context)`
   - `getVisibleCollection(context, collectionId)`
   - `createCollection(context, input)`
   - `updateCollection(context, collectionId, patch)`
   - `beginIndexJob(collectionId)` veya interface'te tanımladığın job create methodu
   - `completeIndexJob(jobId, result)`
   - `failIndexJob(jobId, error)`
   - Aynı collection için running/queued ikinci job engellenmeli.
8. `src/server.ts` bootstrap registry oluşturup `createApp({ registry })` içine versin.
9. `src/app.ts` dependency type'ını gerçek `CollectionRegistry` ile güncelle.
10. Test ekle:
    - `test/collections.ids.test.ts`
    - `test/collections.registry.test.ts`
    - ID slug üretimi.
    - Physical Chroma name validasyonu.
    - SQLite registry collection create/list/get.
    - Aynı collection için ikinci running/queued job engelleniyor.

Dikkat:
- JSON registry yazma.
- Config-backed default registry yazma.
- Eski `chroma.collection` alanını geri ekleme.
- Bu prompt Chroma collection oluşturmayacak; sadece registry ve ID/config katmanını kuracak.
- Build kırık kalmamalı. `src/rag.ts` veya `src/index.ts` eski `config.chromaCollection` bekliyorsa bu prompt kapsamında uyumlu hale getir.

Doğrulama:
1. `npm.cmd install better-sqlite3`
2. `npm.cmd install -D @types/better-sqlite3`
3. `npm.cmd run build`
4. `npm.cmd test`

Final cevapta:
- Registry storage kararının SQLite olduğunu belirt.
- `chroma.collection` kaldırıldıysa ve yerine hangi alanlar geldiğini özetle.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 2: Collection IDs, Config Shape, SQLite Registry" başlığı altında yaptıklarını eklediğini belirt.
```

## Prompt 3: Chroma Helpers and RAG Core Refactor

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin Chroma lifecycle helper'larını ve RAG core fonksiyonlarını multi-collection aware hale getirmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Chroma Dokümanlarıyla Uyum Notları"
- "`src/rag.ts`"
- "`src/collections/chromaCollections.ts`"
- "`src/rag.ts` Refactor Hedefi"
- "Query/Retrieve Path"
- "Test Kabul Kriterleri"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1-2 çıktılarının durumunu ve varsa dependency/config risklerini dikkate al.

Bu prompt, Prompt 1 ve Prompt 2'nin tamamlandığını varsayar. Başlamadan önce kontrol et:
- `src/collections/types.ts` var mı?
- `src/collections/ids.ts` var mı?
- `src/collections/sqliteRegistry.ts` var mı?
- Config'te `registry.path` ve `collectionDefaults` var mı?
Eksikse kod yazmadan raporla.

Amaç:
Read path'te Chroma collection yaratma riskini ortadan kaldır, physical collection creation için direct ChromaClient helper ekle ve RAG fonksiyonlarını explicit collectionName alacak şekilde refactor et.

Yapılacaklar:
1. `src/collections/chromaCollections.ts` oluştur:
   - `createPhysicalChromaCollection({ name, distanceMetric, runtimeConfig })`
   - `assertChromaCollectionReadable({ name, runtimeConfig })`
   - `deletePhysicalChromaCollection({ name, runtimeConfig })`
   - `listPhysicalChromaCollections(runtimeConfig)` opsiyonel ama faydalı.
2. `createPhysicalChromaCollection` direct `ChromaClient.createCollection` kullanmalı:
   - `embeddingFunction: null`
   - `configuration: { hnsw: { space: distanceMetric } }`
   - `getOrCreateCollection` kullanma.
   - Name çakışması fail etmeli.
3. `assertChromaCollectionReadable`:
   - `ChromaClient.getCollection({ name })` kullanmalı.
   - `count()` dönmeli.
   - Missing collection hatasını typed error'a çevirecek şekilde yardımcı hata üretmeli.
4. `src/rag.ts` refactor:
   - `createVectorStore({ runtimeConfig, collectionName })`
   - `retrieveSources(question, { collectionName, k, runtimeConfig })`
   - `answerQuestion(question, { collectionName, runtimeConfig, retrievalK })`
   - Eski positional/default collection imzaları kaldırılmalı.
   - `runtimeConfig.chromaCollection` referansı kalmamalı.
5. `RagQueryErrorCode` içine ekle:
   - `COLLECTION_NOT_FOUND`
   - `COLLECTION_NOT_READY`
   - `COLLECTION_INDEXING`
   - `COLLECTION_STORAGE_INCONSISTENT`
   - `MODEL_BACKPRESSURE`
6. `checkChromaHealth` güncelle:
   - Collection parametresi verilmezse sadece Chroma reachability kontrol etsin.
   - Collection parametresi verilirse collection exists/count/readability kontrol etsin.
   - `/ready` multi-collection boş başlangıcı fail saymamalı.
7. Read path guard:
   - RAG route'ları daha sonra `assertChromaCollectionReadable` çağıracak; bu promptta helper hazır olsun.
   - Unit test ile missing collection için LangChain `getOrCreateCollection` çağrılmadığını kanıtla. Gerekirse Chroma helper/mock kullan.
8. `src/index.ts` compile kırılmayacak şekilde uyumlu hale getir:
   - Destructive legacy davranış bırakma.
   - Eğer `src/index.ts` henüz yeni job runner'a geçmediyse komut kullanıcıya yeni admin reindex akışını kullanması gerektiğini söyleyebilir ya da sonraki prompta kadar minimal build-safe wrapper olarak kalabilir.

Dikkat:
- `getOrCreateCollection` read path'te de build path'te de kullanılmamalı.
- Chroma collection `embeddingFunction: null` olmalı.
- LangChain wrapper sadece embedding üretme/upsert/search için kullanılmalı; collection creation source of truth Chroma helper olsun.
- Build kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- `runtimeConfig.chromaCollection` referanslarının kaldırıldığını belirt.
- Direct Chroma create helper'ın nasıl çalıştığını özetle.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 3: Chroma Helpers and RAG Core Refactor" başlığı altında yaptıklarını eklediğini belirt.
```

## Prompt 4: Versioned Physical Collection Build and Index Jobs

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin destructive indexing'i kaldırıp versioned physical Chroma collection build + registry pointer swap modelini implement etmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "`src/index.ts`"
- "`src/indexing/buildPhysicalCollection.ts`"
- "`src/indexing/jobs.ts`"
- "Index/Rebuild Path"
- "Zero-Downtime Index/Rebuild"
- "Test Kabul Kriterleri"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1-3 çıktılarının durumunu, özellikle registry ve Chroma helper notlarını dikkate al.

Bu prompt, Prompt 1-3'ün tamamlandığını varsayar. Başlamadan önce kontrol et:
- `src/collections/chromaCollections.ts` var mı?
- `src/rag.ts` collection-aware mi?
- `CollectionRegistry` ve SQLite registry var mı?
Eksikse kod yazmadan raporla.

Amaç:
Indexleme artık Chroma collection silip baştan yazmayacak. Her reindex yeni physical collection'a build edecek, başarılı olunca registry active pointer'ı değiştirecek.

Yapılacaklar:
1. `src/indexing/buildPhysicalCollection.ts` oluştur:
   - `buildPhysicalCollection({ collection, targetPhysicalCollection, targetVersion, runtimeConfig, log })`
   - Akış notes/multicollection.md ile birebir uyumlu olmalı.
2. Build akışı:
   - `createPhysicalChromaCollection`
   - collection source ayarlarıyla `analyzeIndexingSource`
   - chunk split
   - metadata ekle:
     - `collectionId`
     - `collectionVersion`
     - `physicalCollection`
   - `createVectorStore({ collectionName: targetPhysicalCollection })`
   - `addDocuments`
   - `assertChromaCollectionReadable`
   - Hata olursa target physical collection best-effort delete.
3. `src/indexing/jobs.ts` oluştur:
   - `startReindexJob`
   - `runIndexJob`
   - job state registry'de kalıcı olmalı.
   - Aynı collection için ikinci running/queued job `409 COLLECTION_INDEX_ALREADY_RUNNING` karşılığı üretecek hata dönmeli.
   - Job target physical collection adı `createPhysicalCollectionName` ile üretilmeli.
   - Job başarılı olunca collection:
     - `status = ready`
     - `activePhysicalCollection = target`
     - `activeVersion = targetVersion`
     - `chunkCount`, `documentCount`, `lastIndexedAt` güncellenmeli.
   - Job başarısız olursa önceki active pointer değişmemeli.
4. `src/index.ts` güncelle:
   - `npm run index -- --collection-id <id>` şeklinde registry/job runner akışını çağırmalı.
   - Parametre yoksa açık hata mesajı vermeli.
   - `resetChromaCollection` kullanmamalı.
5. `src/admin/onboard.ts` güncelle:
   - Config-only onboarding ile collection lifecycle karışmamalı.
   - Mevcut destructive reindex onayı kaldırılmalı veya yeni job runner'a yönlendirilmeli.
6. Test ekle:
   - failed build active pointer değiştirmez.
   - aynı collection için ikinci job engellenir.
   - target physical name Chroma-safe.
   - metadata içine collection/version eklenir.
   - immutable HNSW/distanceMetric veya embedding model değişince yeni physical collection hedeflenir.

Dikkat:
- Chroma collection delete sadece cleanup/hata rollback için kullanılmalı.
- Active pointer swap registry transaction içinde olmalı.
- Query path önceki active version'dan okumaya devam edebilmeli.
- Build kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Destructive reset'in kaldırıldığını belirt.
- Yeni job flow'u özetle.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 4: Versioned Physical Collection Build and Index Jobs" başlığı altında yaptıklarını eklediğini belirt.
```

## Prompt 5: `/v1` Admin and RAG API Endpoints

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin multi-collection `/v1` HTTP API yüzeyini implement etmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "`src/server.ts`"
- "Yeni Endpoint Kontratları"
- "HTTP Hata Kodları"
- "Query/Retrieve Path"
- "Readiness ve Healthcheck"
- "Faz 3: API Endpointlerini Yeniden Tasarla"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1-4 çıktılarının durumunu, özellikle job runner ve registry notlarını dikkate al.

Bu prompt, Prompt 1-4'ün tamamlandığını varsayar. Başlamadan önce kontrol et:
- `createApp({ registry })` var mı?
- SQLite registry çalışıyor mu?
- job service var mı?
- `retrieveSources` ve `answerQuestion` collection-aware mi?
Eksikse kod yazmadan raporla.

Amaç:
Yeni admin collection lifecycle endpointlerini ve collection-scoped RAG query/retrieve endpointlerini eklemek.

Endpointler:
1. `POST /v1/admin/collections`
   - Collection registry kaydı oluşturur.
   - Request body zod ile validate edilmeli.
   - Defaults `collectionDefaults` ve runtime model config'ten gelebilir.
   - Response `201`.
2. `PATCH /v1/admin/collections/:collectionId`
   - Display/source/retrieval config güncelleyebilir.
   - Active physical collection'ı direkt değiştirmemeli.
3. `POST /v1/admin/collections/:collectionId/reindex`
   - `startReindexJob` çağırır.
   - Response `202`.
   - Job arka planda başlatılabilir.
4. `GET /v1/admin/jobs/:jobId`
   - Job durumunu döner.
5. `GET /v1/rag/collections`
   - Kullanıcının/tenant'ın collection listesini döner.
6. `GET /v1/rag/collections/:collectionId`
   - Collection detayını döner.
7. `GET /v1/rag/collections/:collectionId/ready`
   - Registry + active physical Chroma count + job state kontrol eder.
8. `POST /v1/rag/collections/:collectionId/retrieve`
   - `resolveReadableCollection` helper kullan.
   - Chroma read guard çalışmadan `retrieveSources` çağırma.
   - Response mevcut retrieve shape + `collectionId`, `collectionDisplayName`, `activeVersion`.
9. `POST /v1/rag/collections/:collectionId/query`
   - `resolveReadableCollection` helper kullan.
   - Chroma read guard çalışmadan `answerQuestion` çağırma.
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

Yapılacaklar:
1. `src/http/errors.ts` tam error mapper haline gelsin.
2. `src/http/requestContext.ts` her request için context üretip request'e bağlasın.
3. `resolveReadableCollection(req/deps)` helper ekle:
   - collectionId validate.
   - registry lookup.
   - status/activePhysicalCollection kontrol.
   - active Chroma collection readable assert.
4. Route'ları `src/app.ts` içinde veya ayrı route modüllerinde kur.
5. Eski `/rag/query` ve `/rag/retrieve` endpointleri geri eklenmemeli.
6. Test ekle:
   - `GET /v1/rag/collections`
   - missing collection -> 404.
   - no active version -> 404 veya 503 sözleşmeye göre.
   - indexing collection -> 503.
   - duplicate reindex -> 409.
   - old `/rag/query` and `/rag/retrieve` -> 404.

Dikkat:
- Auth gerçek değilse `tenantId = "default"` merkezi helper'dan gelsin.
- Controller içinde registry/Chroma resolve mantığını kopyalama; helper kullan.
- Build kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Eklenen endpointleri listele.
- Eski endpointlerin geri eklenmediğini belirt.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 5: /v1 Admin and RAG API Endpoints" başlığı altında yaptıklarını eklediğini belirt.
```

## Prompt 6: Frontend, README, Smoke Flow

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin test frontend ve dokümantasyonu yeni multi-collection API'ye göre güncellemek ve manuel smoke flow'u çalışır hale getirmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "`test_frontend/index.html`"
- "Yeni Endpoint Kontratları"
- "Doğrulama Komutları"
- "Faz 6: Test Frontend ve Dokümantasyon"
- "Test Kabul Kriterleri"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1-5 çıktılarının durumunu ve yeni endpoint sözleşmelerindeki olası notları dikkate al.

Bu prompt, Prompt 1-5'in tamamlandığını varsayar. Başlamadan önce kontrol et:
- `/v1/rag/collections` endpointi var mı?
- `/v1/admin/collections` endpointi var mı?
- collection-scoped query/retrieve endpointleri var mı?
Eksikse kod yazmadan raporla.

Amaç:
Kullanıcı artık test frontend üzerinden collection listesini görebilmeli, collection seçebilmeli ve seçili collection'a query/retrieve atabilmeli. README eski endpointleri anlatmamalı.

Yapılacaklar:
1. `test_frontend/index.html` güncelle:
   - Sayfa açılınca `GET /v1/rag/collections` çağır.
   - Collection dropdown/list ekle.
   - Seçili collection status/readiness göster.
   - Retrieve butonu `POST /v1/rag/collections/:collectionId/retrieve` çağırmalı.
   - Query butonu `POST /v1/rag/collections/:collectionId/query` çağırmalı.
   - Collection yoksa query formu pasif olmalı.
   - `503 COLLECTION_INDEXING`, `404 COLLECTION_NOT_READY`, `404 COLLECTION_NOT_FOUND` kullanıcıya net gösterilmeli.
2. Eski frontend referanslarını kaldır:
   - `/rag/query`
   - `/rag/retrieve`
3. README güncelle:
   - Multi-collection akışı.
   - Admin collection create.
   - Reindex job başlatma.
   - Collection list.
   - Collection-scoped retrieve/query.
   - Eski endpointleri anlatma.
   - `npm run index -- --collection-id <id>` yeni davranışını anlat.
4. `vanilla_rag_backend_mimarisi.md` veya ilgili mimari dokümanda eski endpoint yüzeyi anlatılıyorsa güncelle.
5. Manuel smoke test için README'ye PowerShell örneği ekle:
   - collection create
   - reindex
   - job status
   - list collections
   - query/retrieve
6. Test güncelle:
   - frontend statik dosyada eski endpoint stringleri kalmadığını basit bir testle doğrula.
   - README'de eski endpoint örnekleri kalmadığını test etmek opsiyonel ama faydalı.

Dikkat:
- Landing page yapma; mevcut test console işlevsel kalmalı.
- Eski endpointleri tekrar kullanma.
- Build/test kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. Gerekirse `npm.cmd run dev` ile manuel frontend smoke.

Final cevapta:
- Frontend davranışını özetle.
- README'deki yeni API örneklerini belirt.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 6: Frontend, README, Smoke Flow" başlığı altında yaptıklarını eklediğini belirt.
```

## Prompt 7: Final Hardening, Readiness, Backpressure, Cleanup

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin multi-collection refactor sonrası son hardening, readiness, cleanup ve acceptance testlerini tamamlamak.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Ollama ve Chroma Backpressure"
- "Readiness ve Healthcheck"
- "Concurrency Stratejisi"
- "Test Kabul Kriterleri"
- "Mimari Etkinlik Değerlendirmesi"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1-6 çıktılarının durumunu ve önceki agentların bıraktığı riskleri dikkate al.

Bu prompt, Prompt 1-6'nın tamamlandığını varsayar. Başlamadan önce kontrol et:
- Yeni `/v1` API çalışıyor mu?
- SQLite registry var mı?
- Versioned physical collection build var mı?
- Frontend yeni endpointleri kullanıyor mu?
Eksikse kod yazmadan raporla.

Amaç:
Yeni mimarinin operasyonel davranışını sertleştirmek ve planın kabul kriterlerini kapatmak.

Yapılacaklar:
1. `/ready` registry-aware olsun:
   - Chroma reachable.
   - Ollama reachable.
   - embedding model available.
   - chat model available.
   - registry reachable.
   - Default collection yok diye fail olmasın.
2. `GET /v1/rag/collections/:collectionId/ready` tam çalışsın:
   - registry var mı?
   - active physical var mı?
   - Chroma count okunuyor mu?
   - job running mı?
   - query/retrieve capability.
3. Request ID ve structured logging ekle:
   - requestId
   - tenantId/userId, merkezi `requestContext` helper'ından
   - collectionId
   - physicalCollection
   - jobId
   - total latency
   - retrieval latency
   - generation latency
   - error code
   - Registry erişimleri tenant-scoped olmalı; controller'lar context'i bypass etmemeli.
4. Basit model backpressure ekle:
   - `maxConcurrentEmbeddings`
   - `maxConcurrentGenerations`
   - Şimdilik config veya sabit değer olabilir ama merkezi olmalı.
   - Limit aşılırsa `503 MODEL_BACKPRESSURE` dön.
5. Request guard ve limit davranışlarını netleştir:
   - JSON body limit merkezi app bootstrap'ta kalmalı ve test edilebilir olmalı.
   - Collection/user bazlı rate limit için merkezi hook veya açık TODO bırak; dağınık route içi limit yazma.
   - Full auth sistemi ekleme; mevcut aşamada `requestContext` üzerinden tenant/user sınırını koru.
6. Timeout/abort davranışını gözden geçir:
   - Chroma retrieval timeout.
   - Ollama generation timeout.
   - client disconnect durumunda gereksiz generation başlatmama.
7. Eski destructive helper cleanup:
   - `resetChromaCollection` public/index job path'te kullanılmamalı.
   - Kullanılmayan import/fonksiyonları temizle.
8. Acceptance testleri tamamla:
   - `GET /v1/rag/collections` sadece visible collections.
   - registry'de olmayan collection Chroma'da yaratılmaz.
   - physical Chroma collection names valid.
   - `configuration.hnsw.space` registry distanceMetric'ten gelir.
   - duplicate reindex -> 409.
   - failed rebuild active pointer değiştirmez.
   - registry access tenant-scoped context ile yapılır.
   - oversized JSON body kontrollü hata döner.
   - old endpoints yok.

Dikkat:
- Büyük mimariyi değiştirme; eksik operasyonel davranışları tamamla.
- Eski endpointleri geri ekleme.
- JSON registry veya config-backed fallback ekleme.

Doğrulama:
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
- Kalan risk veya manuel doğrulama ihtiyacı varsa net yaz.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 7: Final Hardening, Readiness, Backpressure, Cleanup" başlığı altında yaptıklarını eklediğini belirt.
```
