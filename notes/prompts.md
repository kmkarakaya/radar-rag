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

## Prompt 8: Job Lifecycle, Worker Safety, and Version Uniqueness

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin Prompt 1-7 sonrası kalan job lifecycle açıklarını kapatmak, reindex job state'ini gerçek queued/running/succeeded/failed akışına oturtmak ve background worker davranışını test edilebilir hale getirmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Concurrency Stratejisi"
- "Index/Rebuild Path"
- "`src/indexing/jobs.ts`"
- "Registry Şeması"
- "Zero-Downtime Index/Rebuild"
- "Test Kabul Kriterleri"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1-7 çıktılarının tamamlandığını, özellikle Prompt 5 ve Prompt 7 altında not edilen job, stale lock ve backpressure davranışlarını kontrol et.

Bu prompt, Prompt 1-7'nin uygulanmış olduğunu varsayar. Başlamadan önce kontrol et:
- `src/indexing/jobs.ts` var mı?
- `src/collections/sqliteRegistry.ts` içinde `index_jobs.started_at` alanı var mı?
- `src/http/adminRouter.ts` içinde reindex endpoint'i var mı?
- `npm.cmd run build` mevcut durumda geçiyor mu?
Eksik veya build kırık ise kod yazmadan önce kısa raporla.

Bilinen mevcut riskler:
- Reindex endpoint'i job'ı fire-and-forget başlatıyor ve test teardown sırasında SQLite bağlantısı kapanınca background job `database connection is not open` hatası üretebiliyor.
- Job state pratikte `queued -> succeeded/failed` gidiyor; `running` ve `started_at` kullanılmıyor.
- Aynı saniye içinde ardışık job oluşturulursa physical collection target name çakışma riski var.
- API testleri gerçek background job başlattığı için flaky davranabilir.

Amaç:
Job lifecycle'ı sağlam, gözlemlenebilir ve test edilebilir hale getir. HTTP route doğrudan dinamik import ve kontrolsüz fire-and-forget yapmasın; job runner dependency olarak yönetilsin.

Yapılacaklar:
1. `src/collections/types.ts` içindeki `CollectionRegistry` interface'ini genişlet:
   - `markIndexJobRunning(jobId, input?)` veya eşdeğer bir method ekle.
   - Bu method job'ı sadece `queued` durumundan `running` durumuna geçirebilmeli.
   - `startedAt`, `updatedAt` ve varsa `lockToken`/fencing bilgisi set edilmeli.
   - `getActiveJobForCollection(context, collectionId)` veya `listActiveJobsForCollection(context, collectionId)` benzeri bir method ekle. Sonraki promptlar collection readiness içinde bunu kullanacak.
2. `src/collections/sqliteRegistry.ts` güncelle:
   - `markIndexJobRunning` transaction içinde çalışmalı.
   - `queued` olmayan job tekrar running yapılamamalı.
   - `succeeded`, `failed`, `cancelled` job tekrar çalıştırılamamalı.
   - `started_at` doğru set edilmeli.
   - Aynı collection için ikinci `queued/running` job engeli korunmalı.
   - `failStaleJobs` hem `queued` hem `running` jobları fail edebilmeli ve active pointer varsa collection status'u tekrar `ready`, yoksa `failed` yapmalı.
3. Version/physical target uniqueness düzelt:
   - `createVersionString` veya job target üretiminde saniye hassasiyetine bağlı çakışma riskini kaldır.
   - Aynı collection için iki başarılı job kısa aralıkla oluşturulursa target physical collection adları farklı olmalı.
   - Çözüm olarak timestamp'e milisaniye ekleyebilir veya physical name suffix'ine job id/random parçası dahil edebilirsin.
   - Testlerde `setTimeout(1050)` gibi yapay bekleme kalmamalı.
4. `src/indexing/jobs.ts` güncelle:
   - `runIndexJob` build başlamadan önce registry'de job'ı `running` yapmalı.
   - Job bulunamazsa veya terminal state'teyse açık hata vermeli.
   - Build başarısız olursa `failIndexJob` çağrısı korunmalı.
   - Başarılı olursa `completeIndexJob` çağrısı korunmalı.
   - Bu promptta eski physical collection cleanup işini değiştirme; Prompt 9 bunu retention modeline taşıyacak. Sadece job lifecycle'ı düzelt.
5. Job runner dependency ekle:
   - `src/indexing/jobRunner.ts` veya benzeri bir modül oluştur.
   - `createIndexJobRunner({ registry, runtimeConfig, log })` export et.
   - Runner `start(jobId)` veya `enqueue(jobId)` ile job'ı background çalıştırmalı ve promise'i internal olarak track etmeli.
   - `drain()` ve `shutdown()` gibi test/server teardown için kullanılabilecek methodlar ekle.
   - Bu in-memory tracking lock yerine geçmemeli; sadece process içindeki background promise lifecycle'ını yönetmeli. Writer lock/source of truth SQLite registry olarak kalmalı.
6. `src/app.ts` ve `src/server.ts` dependency wiring'i güncelle:
   - `AppDependencies` içine `jobRunner?: IndexJobRunner` ekle.
   - `src/server.ts` registry ve runtime config ile job runner oluştursun, `createApp({ registry, jobRunner })` versin.
7. `src/http/adminRouter.ts` güncelle:
   - Reindex route dynamic import ile `runIndexJob` çağırmasın.
   - `deps.jobRunner.start(job.id)` veya eşdeğer runner methodunu kullansın.
   - Testlerde fake/noop runner inject edilebilir olmalı.
   - Runner yoksa açık `500 INTERNAL_ERROR` dönsün; sessizce job başlatmadan 202 dönme.
8. API testlerini düzelt:
   - `test/api.endpoints.test.ts` gerçek Chroma/data source gerektiren background job başlatmamalı.
   - Test için fake job runner kullan ve duplicate reindex davranışını registry state üzerinden deterministik test et.
   - Test teardown öncesi runner `drain()`/`shutdown()` çağır.
9. Unit test ekle/güncelle:
   - Job `queued -> running -> succeeded`.
   - `startedAt` set ediliyor.
   - Terminal job tekrar çalıştırılamıyor.
   - Aynı collection için active job varken ikinci job engelleniyor.
   - Aynı saniye içinde ardışık iki job target physical name çakışmıyor.
   - Eski `setTimeout(1050)` tabanlı test kaldırılıyor.

Dikkat:
- JSON registry veya in-memory writer lock ekleme.
- Eski `/rag/query` ve `/rag/retrieve` endpointlerini geri ekleme.
- Worker tracking in-memory olabilir ama lock ve job state mutlaka SQLite registry'de kalmalı.
- Build kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Job lifecycle state akışını özetle.
- Fire-and-forget/dynamic import davranışının nasıl değiştiğini belirt.
- Same-second physical name çakışma riskinin nasıl kapatıldığını yaz.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 8: Job Lifecycle, Worker Safety, and Version Uniqueness" başlığı altında yaptıklarını, değiştirdiğin ana dosyaları, çalıştırdığın komutları ve varsa kalan riskleri eklediğini belirt.
```

## Prompt 9: Zero-Downtime Retention Cleanup and Chroma Configuration Fidelity

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin Prompt 8 sonrası reindex akışını gerçek zero-downtime modeline yaklaştırmak, eski physical Chroma collection'ları hemen silmek yerine retention/cleanup state'i ile yönetmek ve Chroma create configuration davranışını registry ile uyumlu hale getirmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Chroma Dokümanlarıyla Uyum Notları"
- "Zero-Downtime Index/Rebuild"
- "Index/Rebuild Path"
- "`src/collections/chromaCollections.ts`"
- "`src/indexing/buildPhysicalCollection.ts`"
- "Test Kabul Kriterleri"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 8'in tamamlandığını ve job lifecycle notlarını kontrol et.

Bu prompt, Prompt 8'in tamamlandığını varsayar. Başlamadan önce kontrol et:
- `markIndexJobRunning` veya eşdeğer running transition var mı?
- Reindex route job runner dependency kullanıyor mu?
- Same-second target name çakışma riski giderilmiş mi?
Eksikse kod yazmadan raporla.

Bilinen mevcut riskler:
- Başarılı rebuild sonrası eski active physical collection hemen siliniyor. Bu, request başında eski physical collection'a bağlanan in-flight query/retrieve isteklerini kırabilir.
- Registry `chromaCollectionConfiguration` saklıyor ama physical collection creation sadece `distanceMetric` üzerinden `configuration.hnsw.space` kuruyor; registry'deki configuration source of truth olarak tam kullanılmıyor.
- `createPhysicalChromaCollection` dışarıdan gelen name'i kendi içinde validate etmiyor.

Amaç:
Pointer swap sonrası eski physical collection'lar retention süresi dolmadan silinmesin. Cleanup ayrı, retry edilebilir ve test edilebilir olsun. Physical Chroma collection creation registry'deki configuration ile uyumlu olsun.

Yapılacaklar:
1. Registry storage modelini genişlet:
   - `collection_versions`, `physical_collections` veya benzeri bir tablo ekle. İsim repo stiline göre seçilebilir.
   - En az şu alanları tut:
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
   - Mevcut `collections.active_physical_collection` ve `active_version` alanları source of truth olarak kalabilir; yeni tablo version/cleanup audit için kullanılmalı.
2. Config'e cleanup retention ayarı ekle:
   - `config/rag.config.yaml` içine örn. `cleanup.retentionMs` veya `indexing.cleanupRetentionMs`.
   - `src/config.ts` schema ve `ResolvedConfig` içinde defaultlu şekilde doğrula.
   - Varsayılan lokal geliştirme için kısa ama güvenli olabilir; örn. `3600000` ms. Testlerde override edilebilir olmalı.
3. `completeIndexJob` akışını güncelle:
   - Yeni physical collection version kaydı `active` olsun.
   - Önceki active physical collection hemen silinmesin.
   - Önceki active physical collection varsa registry'de `retired/delete_pending` durumuna alınsın ve `delete_after = now + retentionMs` set edilsin.
   - Pointer swap transaction içinde atomik kalmalı.
4. `src/indexing/jobs.ts` içindeki immediate cleanup'ı kaldır:
   - Başarılı job sonrası `deletePhysicalChromaCollection` doğrudan çağrılmamalı.
   - Cleanup ayrı servis/fonksiyon üzerinden yapılmalı.
5. Cleanup service ekle:
   - `src/indexing/cleanup.ts` veya `src/collections/cleanup.ts`.
   - `cleanupRetiredPhysicalCollections({ registry, runtimeConfig, now, limit, log })`.
   - Registry'den `delete_after <= now` olan due physical collection'ları listele.
   - Chroma'dan delete dene.
   - Başarılı olursa registry status `deleted`.
   - Missing collection delete başarılı kabul edilebilir.
   - Hata olursa `cleanup_failed` ve error kaydı bırak; tekrar denenebilir olmalı.
6. Server startup davranışı:
   - İstersen startup'ta bir kez due cleanup çalıştırabilirsin.
   - Uzun süreli interval ekleyeceksen testlerde kapatılabilir olmalı.
   - Testlerin kapanmasını engelleyen interval bırakma.
7. Chroma configuration fidelity:
   - `src/collections/chromaCollections.ts` içinde create request builder veya helper ekle:
     - `buildCreateCollectionRequest({ name, chromaConfiguration })`
   - Name validation için `assertValidChromaCollectionName(name)` çağır.
   - Registry'de saklanan `chromaCollectionConfiguration` create request'te kullanılmalı.
   - Default configuration `{ hnsw: { space: collection.distanceMetric } }` registry collection create sırasında üretilmeli.
   - Eğer custom configuration yoksa distanceMetric ile HNSW space tutarlı olmalı.
8. `src/indexing/buildPhysicalCollection.ts` güncelle:
   - `createPhysicalChromaCollection` çağrısı collection'ın `chromaCollectionConfiguration` değerini kullanmalı.
   - `distanceMetric` sadece default config üretimi veya validation için kullanılmalı.
9. Tests:
   - Başarılı rebuild sonrası eski physical collection hemen `deletePhysicalChromaCollection` ile silinmiyor.
   - Retention süresi dolmadan cleanup silmiyor.
   - Retention süresi dolunca cleanup due collection'ı siliyor ve registry status `deleted` oluyor.
   - Cleanup delete hata verirse registry `cleanup_failed` ve error tutuyor.
   - Build edilen physical collection create request `configuration.hnsw.space` değerini registry `distanceMetric` değerinden alıyor.
   - Custom `chromaCollectionConfiguration` create request'e taşınıyor.
   - Invalid physical collection name helper seviyesinde fail ediyor.
   - Farklı collection'lar aynı anda queued/running rebuild job sahibi olabiliyor; aynı collection için tek active job kuralı korunuyor.

Dikkat:
- Zero-downtime davranışı için eski physical collection'ı immediate delete etme.
- Cleanup source of truth registry olmalı; Chroma `listCollections()` tek başına ürün state'i gibi kullanılmamalı.
- Chroma docs'a göre HNSW ayarları metadata değil `configuration` altında kurulmalı.
- Build/test gerçek Chroma servisinin ayakta olmasına bağlı olmamalı; create request/config testleri mümkünse pure unit veya mock ile yazılmalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Immediate cleanup'ın kaldırıldığını ve retention modelinin nasıl çalıştığını anlat.
- Chroma create configuration'ın registry ile nasıl hizalandığını belirt.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 9: Zero-Downtime Retention Cleanup and Chroma Configuration Fidelity" başlığı altında yaptıklarını, değiştirdiğin ana dosyaları, çalıştırdığın komutları ve varsa kalan riskleri eklediğini belirt.
```

## Prompt 10: Tenant Access, Registry-Aware Readiness, and Collection Capabilities

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin request context, tenant/access davranışı, servis readiness ve collection-level readiness/capability sözleşmesini tamamlamak.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Son Kullanıcı Collection'ları Kolayca Bulabiliyor mu?"
- "Yeni Endpoint Kontratları"
- "HTTP Hata Kodları"
- "Query/Retrieve Path"
- "Readiness ve Healthcheck"
- "Test Kabul Kriterleri"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 8 ve Prompt 9 sonrasında job lifecycle, cleanup ve Chroma configuration değişikliklerini kontrol et.

Bu prompt, Prompt 8-9'un tamamlandığını varsayar. Başlamadan önce kontrol et:
- Job runner dependency var mı?
- Registry active job sorgusu veya eşdeğeri var mı?
- Retention cleanup immediate delete yerine registry state kullanıyor mu?
Eksikse kod yazmadan raporla.

Bilinen mevcut riskler:
- `COLLECTION_FORBIDDEN` error code var ama pratikte üretilmiyor.
- `/ready` registry reachable kontrolü yapmıyor.
- `GET /v1/rag/collections` capability hesabı sadece `status === "ready"` üzerinden yapılıyor; active physical varsa rebuild sırasında query devam edebilmeli.
- `GET /v1/rag/collections/:id/ready` active job bilgisini ve rebuild sırasında query/retrieve capability ayrımını yeterince göstermiyor.

Amaç:
Gerçek auth sistemi eklemeden development için merkezi, test edilebilir tenant/user context kur. Registry erişimini tenant scoped tut, forbidden/missing ayrımını tek helper'da çöz, readiness endpointlerini planla uyumlu hale getir.

Yapılacaklar:
1. `src/http/requestContext.ts` güncelle:
   - Varsayılanlar korunmalı: `tenantId = "default"`, `userId = "local-dev"`.
   - Development/test için header desteği ekle:
     - `x-tenant-id`
     - `x-user-id`
     - `x-request-id`
   - Header değerlerini trim et, boşsa default kullan.
   - Request id yoksa üret.
   - Bu gerçek auth değildir; sadece backend boundary ve test edilebilir tenant scoping içindir.
2. Registry access helper ekle:
   - `resolveReadableCollection` içinde veya ayrı `resolveCollectionAccess` helper olarak yapılabilir.
   - Akış:
     1. collectionId path parametresini validate et.
     2. `getVisibleCollection(context, collectionId)` ile tenant scoped lookup yap.
     3. Bulunursa devam et.
     4. Bulunmazsa registry'de aynı id herhangi bir tenant altında var mı diye güvenli access check yap.
     5. Varsa `403 COLLECTION_FORBIDDEN`.
     6. Yoksa `404 COLLECTION_NOT_FOUND`.
   - Bunun için `CollectionRegistry` interface'ine `collectionExists(collectionId)` veya `getCollectionAccessState(context, collectionId)` gibi method ekleyebilirsin.
   - Bu helper bütün RAG route'larında kullanılmalı; controller içinde kopyalanmamalı.
3. `src/http/errors.ts` güncelle:
   - `COLLECTION_FORBIDDEN` gerçek route path'lerinden dönebilmeli.
   - `ANSWER_NOT_IN_RETRIEVED_CONTEXT` ve `DISALLOWED_FALLBACK_ANSWER` gibi RAG error code'ları type/response contract içinde tutarlı olsun.
4. `/ready` registry-aware olsun:
   - Registry için `healthCheck()` / `ping()` / basit `SELECT 1` methodu ekle.
   - `/ready` payload'ında `dependencies.registry` alanı olsun.
   - Registry unreachable ise `indexReady` ve `queryReady` blocking fail olmalı.
   - Default collection yok diye fail olmasın.
   - `?strict=true` davranışı korunmalı.
5. `GET /v1/rag/collections` capability hesabını düzelt:
   - Collection status `indexing` olsa bile `activePhysicalCollection` varsa query/retrieve capability true olabilir.
   - İlk indexing sırasında active yoksa query/retrieve false olmalı.
   - List endpoint Chroma'ya her collection için count atmak zorunda değil; hızlı list için registry state yeterli olabilir.
   - Response içinde `hasActiveVersion` veya `activeVersion` zaten varsa capability bunu yansıtmalı.
6. `GET /v1/rag/collections/:collectionId/ready` endpointini tamamla:
   - Access/missing/forbidden helper kullan.
   - Response şu alanları içermeli:
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
   - Active physical readable ise collection status `indexing` olsa da query/retrieve true olmalı.
   - Active physical yok ve active job varsa query/retrieve false, indexing true.
7. Query/retrieve resolve davranışını doğrula:
   - Rebuild sırasında active physical varsa query/retrieve eski active physical ile devam etmeli.
   - Active physical yok ve status/index job varsa `503 COLLECTION_INDEXING`.
   - Active physical yok ve job yoksa `404 COLLECTION_NOT_READY`.
8. Tests:
   - Default context ile mevcut testler kırılmamalı.
   - `x-tenant-id` ile farklı tenant collection'ları listelenmez.
   - Başka tenant'a ait bilinen collection id için query/retrieve `403 COLLECTION_FORBIDDEN`.
   - Bilinmeyen collection id için `404 COLLECTION_NOT_FOUND`.
   - `/ready?details=true` registry dependency alanı döner.
   - Registry ping fail ederse `/ready?strict=true` 503 döner. Bunun için fake registry veya kapatılmış SQLite bağlantısı kullanılabilir.
   - Collection `indexing` ama active physical varsa list/ready capabilities query/retrieve true olur.
   - İlk indexing sırasında active physical yoksa ready capabilities query/retrieve false olur.

Dikkat:
- Full authentication/authorization sistemi ekleme. Bu prompt sadece merkezi context ve tenant-scoped registry boundary kurar.
- 403 davranışı sadece collection id registry'de var ama current tenant'a görünmüyorsa dönmeli.
- Eski endpointleri geri ekleme.
- Build/test kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`

Final cevapta:
- Request context ve tenant header davranışını özetle.
- `/ready` ve collection ready contract'ının nasıl değiştiğini belirt.
- 403/404 ayrımını açıkça yaz.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 10: Tenant Access, Registry-Aware Readiness, and Collection Capabilities" başlığı altında yaptıklarını, değiştirdiğin ana dosyaları, çalıştırdığın komutları ve varsa kalan riskleri eklediğini belirt.
```

## Prompt 11: Acceptance Tests, Test Isolation, and External-Service Boundaries

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin test suite'i planın kabul kriterlerini gerçekten kanıtlayacak hale getirmek ve normal `npm test` komutunu Chroma/Ollama gibi dış servislerin ayakta olmasına bağımlı olmaktan çıkarmaktır.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Test Kabul Kriterleri"
- "Query/Retrieve Path"
- "Index/Rebuild Path"
- "Readiness ve Healthcheck"
- "Ollama ve Chroma Backpressure"
- "Coding Agent Çalışma Sırası"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 8-10 sonrasında job runner, cleanup, tenant access ve readiness değişikliklerini dikkate al.

Bu prompt, Prompt 8-10'un tamamlandığını varsayar. Başlamadan önce kontrol et:
- `npm.cmd test` mevcut durumda geçiyor mu?
- Test çıktısında background job, Chroma veya Ollama kaynaklı beklenmeyen log/error var mı?
- `test/rag.test.ts` veya API testleri gerçek Chroma/Ollama servisine bağımlı mı?
Eksik veya flaky davranış varsa önce bunu raporla, sonra düzelt.

Amaç:
Unit ve endpoint testleri deterministik, hızlı ve dış servis bağımsız olmalı. Gerçek Chroma/Ollama smoke testleri gerekiyorsa opsiyonel integration test olarak ayrılmalı.

Yapılacaklar:
1. Test dependency injection sınırlarını iyileştir:
   - `createApp` testlerde runtime config, registry, jobRunner ve RAG/chroma service fake'leri ile çalışabilecek şekilde genişletilebilir.
   - Büyük mimari bozma; sadece test edilebilirlik için açık dependency boundary ekle.
   - Production path varsayılan gerçek implementation'ı kullanmalı.
2. Chroma/Ollama dış servis bağımlılığını normal testlerden kaldır:
   - `test/rag.test.ts` gerçek Chroma'ya bağlanıyorsa mock/fake helper ile değiştir.
   - `npm.cmd test` Chroma/Ollama kapalıyken de geçmeli.
   - Gerçek servis gerektiren test varsa `test/integration/*.test.ts` altına taşı ve `RUN_INTEGRATION=1` gibi env flag olmadan çalıştırma.
   - `package.json` içinde gerekirse ayrı script ekle:
     - `test:integration`
3. Acceptance testleri tamamla:
   - `GET /v1/rag/collections` sadece current tenant visible logical collection'ları listeler.
   - Registry'de olmayan collection için Chroma'da yeni boş collection oluşmaz; fake Chroma create çağrılmadığını doğrula.
   - Üretilen physical collection adları Chroma ad kurallarına uyar.
   - Build edilen physical collection create request'i `configuration.hnsw.space` değerini registry `distanceMetric` veya registry config'ten alır.
   - Bilinmeyen `collectionId` için query/retrieve `404 COLLECTION_NOT_FOUND`.
   - Yetkisiz collection için `403 COLLECTION_FORBIDDEN`.
   - Aktif sürümü olmayan ve indexing süren collection için `503 COLLECTION_INDEXING`.
   - Rebuild sırasında önceki aktif sürüm varsa query/retrieve eski active physical collection ile başarılı çalışır.
   - Aynı collection için iki rebuild isteğinden ikincisi `409 COLLECTION_INDEX_ALREADY_RUNNING`.
   - Farklı collection'lar aynı anda rebuild edilebilir.
   - Rebuild başarısız olursa önceki active pointer değişmeden kalır.
   - `GET /v1/rag/collections/:collectionId/ready` collection bazlı doğru readiness verir.
   - Oversized JSON body structured JSON error döner.
   - Eski `/rag/query` ve `/rag/retrieve` public API yüzeyinde yok.
4. Testlerde background lifecycle temizliği:
   - API testleri job runner `drain()` veya fake runner ile kapanmalı.
   - Test sonunda kapalı SQLite connection'a yazmaya çalışan background job logu kalmamalı.
5. Backpressure/timeout testleri:
   - Semaphore limitleri deterministik küçük config ile test edilmeli.
   - Limit/timeout durumunda `503 MODEL_BACKPRESSURE` mapping'i test edilmeli.
   - Bu test gerçek Ollama çağırmamalı.
6. Docs/static contract testleri:
   - README ve test frontend eski endpointleri aktif kullanım olarak içermiyor mu test et.
   - Bu promptta architecture docs temizliğini tamamen yapman gerekmiyor; Prompt 12 bunu detaylandıracak. Ama test helper'ı kurulabilir.

Dikkat:
- Testleri yeşil yapmak için plan davranışını gevşetme.
- Gerçek Chroma/Ollama gerektiren normal unit test bırakma.
- Fake'ler production code path'e fallback olarak sızmamalı.
- Eski endpointleri geri ekleme.

Doğrulama:
1. Chroma/Ollama kapalıyken `npm.cmd run build`
2. Chroma/Ollama kapalıyken `npm.cmd test`
3. Eğer integration script eklediysen ve servisler lokal ayaktaysa opsiyonel:
   - `npm.cmd run test:integration`

Final cevapta:
- Normal test suite'in hangi dış servislerden bağımsız hale geldiğini belirt.
- Kapatılan acceptance kriterlerini listele.
- Opsiyonel integration test varsa nasıl çalıştırılacağını yaz.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 11: Acceptance Tests, Test Isolation, and External-Service Boundaries" başlığı altında yaptıklarını, değiştirdiğin ana dosyaları, çalıştırdığın komutları ve varsa kalan riskleri eklediğini belirt.
```

## Prompt 12: Documentation, Frontend Contract, and Architecture Cleanup

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin Prompt 1-11 sonrası dokümantasyon, test frontend ve mimari metinlerde kalan eski single-collection/destructive reset anlatımlarını temizlemek ve kullanıcı akışını yeni multi-collection backend sözleşmesiyle tutarlı hale getirmek.

Önce mutlaka notes/multicollection.md dosyasını oku. Özellikle şu bölümlere göre çalış:
- "Son Kullanıcı Collection'ları Kolayca Bulabiliyor mu?"
- "Yeni Endpoint Kontratları"
- "Faz 6: Test Frontend ve Dokümantasyon"
- "Readiness ve Healthcheck"
- "Test Kabul Kriterleri"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 8-11 sonrası gerçek endpoint, readiness, cleanup ve test sözleşmelerini dikkate al.

Bu prompt, Prompt 11'in tamamlandığını varsayar. Başlamadan önce kontrol et:
- README, `vanilla_rag_backend_mimarisi.md`, `test_frontend/index.html` ve varsa onboarding dokümanlarında eski `/rag/query`, `/rag/retrieve`, `chroma.collection`, `data.indexSampleSize`, destructive reset anlatımları var mı?
- `npm.cmd test` mevcut durumda geçiyor mu?
Eksik veya çelişkili implementation varsa dokümana yanlış bilgi yazmadan önce raporla.

Amaç:
Dokümanlar ve test frontend artık repo gerçekliğini doğru anlatsın: logical collection registry, public collectionId, versioned physical Chroma collection, retention cleanup, registry-aware readiness, tenant-scoped list/query ve yeni `/v1` endpointleri.

Yapılacaklar:
1. README güncelle:
   - Eski active endpoint olarak `/rag/query` ve `/rag/retrieve` anlatımı kalmamalı.
   - `chroma.collection` config örneği kalmamalı.
   - `data.indexSampleSize` yerine yeni config path'i kullanılmalı: `collectionDefaults.indexSampleSize`.
   - Collection create, reindex job, job status, list, collection ready, retrieve, query örnekleri güncel olmalı.
   - Rebuild sırasında active version varsa query/retrieve'in eski active physical collection'dan devam ettiği açıklanmalı.
   - Eski physical collection cleanup'ın retention sonrası yapıldığı açıklanmalı.
   - Normal `npm test` dış servis gerektirmiyorsa bunu belirt; integration test varsa ayrı anlat.
2. `vanilla_rag_backend_mimarisi.md` güncelle:
   - Aktif mimariyi anlatan bölümlerde eski `/rag/query`, `/rag/retrieve` endpointleri kalmamalı.
   - Destructive "Chroma collection resetlenir/silinir/baştan yazılır" anlatımı aktif akış gibi kalmamalı.
   - Yeni akış şu sırayla anlatılmalı:
     1. logical collection registry kaydı
     2. reindex job
     3. yeni versioned physical Chroma collection
     4. build/readability check
     5. registry pointer swap
     6. retention cleanup
   - `/ready` ve `/v1/rag/collections/:id/ready` ayrımı anlatılmalı.
   - Tenant/access boundary ve `403 COLLECTION_FORBIDDEN` davranışı anlatılmalı.
3. `notes/onboardin_plan.md` veya başka onboarding notları güncel davranışla çelişiyorsa:
   - Ya güncelle.
   - Ya da dosyanın en üstüne açıkça "legacy plan / güncel değil" notu koy ve güncel README'ye yönlendir.
4. `test_frontend/index.html` iyileştir:
   - Collection list/dropdown mevcut kalmalı.
   - Collection yoksa query/retrieve butonları pasif olmalı ve kullanıcıya collection oluşturma/reindex için admin API yönü gösterilmeli.
   - Collection status/readiness sonucu active job, activeVersion, chromaCount ve capabilities alanlarını gösteriyorsa güncel response contract ile uyumlu olmalı.
   - Eski endpoint stringleri kalmamalı.
   - Gerekirse admin create/reindex butonu ekleyebilirsin, ancak test frontend'i production admin UI'a çevirmeye çalışma; amaç smoke/debug kolaylığı.
5. Static/docs contract testleri ekle/güncelle:
   - `test/frontend.static.test.ts` sadece quoted string aramakla kalmasın; `/rag/query` ve `/rag/retrieve` aktif fetch/action olarak kalmadığını yakalasın.
   - `test/docs.contract.test.ts` ekle:
     - README içinde aktif endpoint olarak `/rag/query` veya `/rag/retrieve` geçmesin.
     - README içinde `chroma.collection` ve `data.indexSampleSize` stale config path'i geçmesin.
     - Architecture doc içinde eski endpointler varsa sadece "legacy/removed" bağlamında geçsin; mümkünse tamamen temizle.
   - `notes/multicollection.md` ve `notes/prompts.md` tarihsel plan/prompt dosyaları olduğu için bu testlerin kapsamı dışında kalabilir.
6. Smoke flow'u doğrula:
   - README'deki PowerShell örnekleri syntactically tutarlı olsun.
   - Endpoint path'leri gerçek route'larla eşleşsin.

Dikkat:
- Dokümanda implementation'da olmayan özelliği tamamlanmış gibi anlatma.
- Eski endpointleri "kullanılabilir fallback" gibi göstermeme.
- Migration/backward compatibility anlatımı ekleme; proje henüz kullanılmıyor ve hedef doğru yeni mimari.
- Build/test kırık kalmamalı.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. Manuel olarak README smoke komutlarını gözden geçir; dış servis çalıştırman gerekiyorsa bunu finalde açıkça belirt.

Final cevapta:
- Temizlenen dokümanları ve frontend contract değişikliklerini listele.
- Eski endpoint/config/destructive reset anlatımlarının temizlendiğini belirt.
- Test/build sonuçlarını yaz.
- notes/done.md dosyasına "Prompt 12: Documentation, Frontend Contract, and Architecture Cleanup" başlığı altında yaptıklarını, değiştirdiğin ana dosyaları, çalıştırdığın komutları ve varsa kalan riskleri eklediğini belirt.
```

## Prompt 13: Final Multi-Collection Audit and Release Gate

```text
Bu repo Vanilla RAG Backend repo'sudur. Görevin Prompt 1-12 sonrası son kalite kapısını çalıştırmak: implementation'ı notes/multicollection.md planı ve test kabul kriterleriyle birebir karşılaştır, eksik varsa küçük düzeltmeleri yap, büyük eksik varsa kod yazmadan raporla.

Önce mutlaka notes/multicollection.md dosyasını baştan sona oku. Özellikle şu bölümlere göre çalış:
- "Kısa Karar"
- "Mimari Etkinlik Değerlendirmesi"
- "Test Kabul Kriterleri"
- "Readiness ve Healthcheck"
- "Concurrency Stratejisi"
- "Fazlara Bölünmüş Uygulama Planı"

Ayrıca çalışmaya başlamadan önce notes/done.md dosyasını oku. Prompt 1-12 boyunca ne yapıldığını, hangi risklerin kapandığını ve kalan notları çıkar.

Amaç:
Repo gerçekten multiple collection destekleyen RAG backend hedefini karşılıyor mu, bunu son kez doğrula. Bu prompt çoğunlukla audit + küçük contract düzeltmeleri içindir; büyük mimari eksik bulursan bunu net raporla ve gerekiyorsa yeni prompt öner.

Yapılacaklar:
1. Plan karşılaştırması yap:
   - Config shape.
   - Registry storage ve schema.
   - Public collection ID / physical Chroma name ayrımı.
   - Chroma create configuration.
   - Query/retrieve resolve path.
   - Reindex job lifecycle.
   - Zero-downtime pointer swap.
   - Retention cleanup.
   - Registry-aware readiness.
   - Tenant/access/403 davranışı.
   - Backpressure/timeouts.
   - Frontend collection discovery.
   - README/architecture docs.
2. Kod taraması yap:
   - `rg "chromaCollection|chroma.collection|/rag/query|/rag/retrieve|resetChromaCollection|data.indexSampleSize|rag.retrievalK"` ile stale referansları kontrol et.
   - `notes/multicollection.md`, `notes/prompts.md` ve `notes/done.md` tarihsel/plan dosyaları olduğu için stale referansları otomatik hata sayma; product docs/code/test/frontend için değerlendir.
3. Testleri çalıştır:
   - `npm.cmd run build`
   - `npm.cmd test`
   - Eğer integration test script'i varsa ve dış servisler ayakta değilse çalıştırma; finalde neden çalıştırmadığını belirt.
4. Küçük eksik düzeltmeleri yap:
   - Stale README path'i.
   - Test isimleri.
   - Error code type union eksikleri.
   - Missing docs/static contract test.
   - Obvious route response contract mismatch.
5. Büyük eksik bulursan:
   - Yeni kod yazmadan önce final raporda açıkça belirt.
   - Hangi dosyada, hangi plan maddesine göre eksik olduğunu yaz.
   - Gerekirse "Prompt 14" için kısa öneri bırak ama bu dosyaya otomatik yeni prompt eklemek zorunda değilsin.
6. Final acceptance checklist hazırla:
   - Her `notes/multicollection.md` test kabul kriteri için `pass`, `partial`, `fail`, `not tested` durumu.
   - `partial/fail/not tested` varsa nedenini ve önerilen fix'i yaz.
7. notes/done.md güncelle:
   - "Prompt 13: Final Multi-Collection Audit and Release Gate" başlığı altında audit sonucunu, küçük düzeltmeleri, komut sonuçlarını ve kalan riskleri yaz.

Dikkat:
- Yeşil testleri tek başına yeterli kabul etme; plan kabul kriterleriyle karşılaştır.
- Eski endpointleri geri ekleme.
- Compatibility/migration katmanı ekleme.
- Büyük refactor gerekiyorsa yarım yamalak implement etme; net raporla.

Doğrulama:
1. `npm.cmd run build`
2. `npm.cmd test`
3. Stale referans taraması:
   - `rg "chromaCollection|chroma.collection|/rag/query|/rag/retrieve|resetChromaCollection|data.indexSampleSize|rag.retrievalK" src test README.md vanilla_rag_backend_mimarisi.md test_frontend config`

Final cevapta:
- Repo multi-collection hedefi için hazır mı, doğrudan "evet/hayır/kısmen" diye cevapla.
- Acceptance checklist özetini ver.
- Kalan riskleri öncelik sırasıyla listele.
- Test/build/stale-scan sonuçlarını yaz.
- notes/done.md dosyasına final audit kaydını eklediğini belirt.
```
