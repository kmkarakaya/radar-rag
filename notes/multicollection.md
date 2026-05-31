# Vanilla RAG Backend: Multi-Collection ve Concurrency Refactor Planı

## Kısa Karar

Mevcut repo tek Chroma collection varsayımıyla çalışıyor. Proje geliştirme aşamasında ve henüz dış kullanıcı olmadığı için geriye dönük uyumluluk, migration veya eski endpointleri yaşatma hedefi yoktur. Plan doğrudan doğru multi-collection backend mimarisini kurmaya odaklanmalıdır.

Önerilen mimari:

- HTTP path içinde URL-safe bir `collectionId` kullanılmalı: `POST /v1/rag/collections/:collectionId/query`.
- Bu `collectionId` Chroma collection adı olmak zorunda değil; kullanıcıya açık, stabil, okunabilir ve yetkilendirme kapsamına alınmış bir public ID olmalı.
- Chroma'daki gerçek collection adı registry'de tutulmalı ve versioned olmalı.
- Re-index sırasında mevcut collection silinmemeli. Yeni fiziksel Chroma collection'a build yapılmalı, başarılı olunca registry'de aktif sürüm atomik değiştirilmeli.
- In-memory lock sadece lokal/dev için yeterlidir. Bir backend mimarisinde lock ve job state DB/Redis gibi paylaşılan ve TTL destekli bir state katmanında tutulmalıdır.

Bu yaklaşımla aynı anda birden fazla kullanıcı farklı veya aynı collection'a query/retrieve atabilir; admin rebuild işlemi de mümkün olduğunca query kesintisi yaratmadan ilerler.

## İkinci Repo İncelemesiyle Eklenen Netleştirmeler

Bu plan tekrar repo üzerinden kontrol edildiğinde aşağıdaki noktalar özellikle önemli hale geliyor:

- Repo şu anda DB/registry bağımlılığı içermiyor. `package.json` içinde Express, Chroma, LangChain, Ollama ve YAML var; kalıcı registry için SQLite/Postgres/Redis benzeri bir bağımlılık henüz yok.
- `tsconfig.json` `NodeNext` ve `ES2022` hedefliyor; yeni modüller ESM uyumlu yazılmalı.
- Node runtime lokal olarak `v22.18.0`, ancak plan Node'a gömülü deneysel/versiyona bağlı API'lere yaslanmamalı. Bu implementasyon için registry storage SQLite olmalı.
- `@langchain/community` Chroma vector store read path'te de `getOrCreateCollection` kullanıyor. Bu yüzden query/retrieve çağrısı, collection yoksa yanlışlıkla boş Chroma collection yaratabilir. Multi-collection backend için query path mutlaka önce registry ve Chroma `getCollection/count` doğrulaması yapmalı; doğrulama geçmeden LangChain `Chroma` instance'ı oluşturulmamalı.
- Chroma collection adları URL içinde kullanıldığı için Chroma'nın ad kurallarına uymalıdır: 3-512 karakter, küçük harf veya rakamla başlayıp bitme, arada nokta/tire/alt çizgi kullanabilme, ardışık nokta içermeme ve IP adresi formatında olmama. Public `collectionId` ve physical Chroma collection adı bu kurallara göre ayrı ayrı validate edilmelidir.
- Chroma'nın güncel collection configuration modeli HNSW ayarlarını metadata değil `configuration: { hnsw: { ... } }` altında tanımlar. Mevcut repo LangChain wrapper üzerinden `collectionMetadata: { "hnsw:space": ... }` kullanıyor; multi-collection build path'te physical collection önce doğrudan `ChromaClient.createCollection` ile doğru `configuration.hnsw.space` kullanılarak oluşturulmalı, sonra LangChain sadece doküman/embedding yazma ve query için kullanılmalıdır.
- `src/ingestion/pipeline.ts` şu an directory source için yalnızca ilk seviye dosyaları topluyor. Collection'a özel `sourcePath` tasarlanırken bu davranış bilinmeli; recursive source desteği isteniyorsa ayrıca planlanmalı.
- `src/index.ts` zaten reusable `runIndexing(runtimeConfig, options)` export ediyor. Bu iyi bir başlangıç; yeni job runner bu fonksiyonun etrafında değil, bu fonksiyonun destructive reset davranışını parametreli/versiyonlu hale getirecek şekilde kurulmalı.
- Test altyapısı henüz yok. Multi-collection refactor'ı başlamadan önce en azından utility ve controller seviyesinde küçük bir test omurgası eklenmeli.

## Repo ile Mevcut Durum Karşılaştırması

### `src/config.ts`

Mevcut durum:

- `chroma.collection` tek string olarak tanımlı.
- `ResolvedConfig.chromaCollection` bütün runtime akışlarının varsayılan hedefi.
- Collection registry, display name, owner/tenant, status, active version veya kaynak bilgisi yok.

Gereken değişiklik:

- `chroma.collection` config schema'dan çıkarılmalı. Query, retrieve ve indexing hedefi sadece registry'den çözülmeli.
- Yeni registry katmanı SQLite ile eklenmeli. JSON dosyası registry olarak kullanılmamalı; eşzamanlı backend davranışı için transaction gerekir.
- Config servis geneli default'ları taşımalı; collection'a özel source path, embedding model, metric, chunk ayarları registry'de tutulmalı.

Hedef config şekli:

```yaml
server:
  port: 3010
registry:
  path: data/registry.sqlite
chroma:
  url: http://localhost:8000
ollama:
  baseUrl: http://localhost:11434
  chatModel: gemma3:4b-cloud
  embeddingModel: bge-m3
  numCtx: 4096
  numPredict: 128
collectionDefaults:
  sourcePath: data
  ozelgeDataPath: data/ozelge_veri.json
  distanceMetric: l2
  chunkSize: 500
  chunkOverlap: 200
  retrievalK: 5
  retrievalDistanceThreshold: 1
readiness:
  timeoutMs: 30000
  embeddingProbeText: readiness probe
  chatProbeText: hazirlik kontrolu
```

`rag.*` ve `data.*` mevcut halleriyle runtime query/index source of truth olmamalı; yeni collection oluştururken `collectionDefaults` olarak kullanılabilirler.

### `src/rag.ts`

Mevcut durum:

- `createVectorStore(runtimeConfig)` doğrudan `runtimeConfig.chromaCollection` kullanıyor.
- `retrieveSources()` ve `answerQuestion()` collection seçimi almıyor.
- Chroma collection listeleme dışarı açılmıyor.
- Missing collection hatası query path'te anlamlı `404 COLLECTION_NOT_FOUND` olarak normalize edilmiyor.

Gereken değişiklik:

- RAG çekirdeği logical collection değil, resolved physical Chroma collection adı almalı.
- `createVectorStore({ runtimeConfig, collectionName })` gibi açık bir imza kullanılmalı.
- `retrieveSources(question, { collectionName, k, runtimeConfig })` ve `answerQuestion(question, { collectionName, runtimeConfig })` haline getirilmeli.
- `listChromaCollections()` ve `getChromaCollectionCount(collectionName)` gibi düşük seviyeli helper'lar eklenmeli.
- Chroma'nın `not found`, `does not exist`, `404` varyasyonları `RagQueryError("COLLECTION_NOT_FOUND", ..., 404)` olarak normalize edilmeli.
- Query/retrieve path'te LangChain `Chroma.ensureCollection()` davranışına güvenilmemeli; bu helper collection yoksa `getOrCreateCollection` çağırabildiği için read path'te accidental empty collection creation riski var.
- Read path için `assertCollectionReadable(physicalCollectionName)` gibi bir guard eklenmeli. Bu guard `ChromaClient.getCollection()` ve gerekirse `count()` ile doğrulama yapmalı; başarısızsa vector store hiç oluşturulmamalı.
- Write/build path'te physical collection önce `createCollection` ile açıkça oluşturulmalı; `getOrCreateCollection` yeni physical collection creation için kullanılmamalı, çünkü name çakışmasını saklayabilir.
- Physical collection creation için LangChain wrapper yerine direct `ChromaClient.createCollection({ name, embeddingFunction: null, configuration: { hnsw: { space } } })` benzeri düşük seviye helper tercih edilmeli. Bu repo embeddings'i Ollama/LangChain tarafında hesaplayıp Chroma'ya hazır vector olarak yazdığı için Chroma collection embedding function `null` kalmalıdır.

### `src/index.ts`

Mevcut durum:

- `runIndexing()` tek config collection'ı hedefliyor.
- `resetChromaCollection()` ile collection silinip baştan yazılıyor.
- Re-index sırasında aynı collection'a query atan kullanıcı `Collection not found`, boş sonuç veya `500` görebilir.
- Aynı anda iki indexleme işini engelleyen state yok.

Gereken değişiklik:

- `runIndexing()` hedef logical collection ve physical build collection almalı.
- Destructive reset ana akış olmaktan çıkarılmalı.
- Rebuild akışı şu şekilde olmalı:
  1. Logical collection için writer lock al.
  2. Yeni fiziksel collection adı üret: örn. `rag_<tenantKey>_<collectionId>_v<jobId>`.
  3. Dokümanları bu yeni collection'a yaz.
  4. Count/smoke check yap.
  5. Registry transaction içinde `activePhysicalCollectionName` değerini yeni collection'a çevir.
  6. Eski physical collection'ı hemen değil, background cleanup ile sil.
  7. Lock'u bırak.
- İlk build sırasında aktif sürüm yoksa query `503 COLLECTION_INDEXING` veya `404 COLLECTION_NOT_READY` dönebilir.
- Rebuild sırasında aktif sürüm varsa query eski aktif sürümden cevap vermeye devam etmeli; bu durumda 503 gerekmez.
- `runIndexing` destructive reset davranışından ayrılmalı ve doğrudan `buildPhysicalCollection` semantiğine geçirilmelidir. CLI da HTTP admin job path ile aynı güvenli registry/lock kurallarını kullanmalıdır.
- `addDocuments` ID üretimi şu an `${documentId}:${chunkIndex}`. Versioned physical collection modelinde bu yeterli; incremental/upsert modele geçilecekse collection sürümü, source hash veya document revision stratejisi ayrıca tasarlanmalı.
- Chroma docs'a göre `.add` aynı ID tekrar geldiğinde kaydı ignore eder; `.upsert` ise varsa update eder, yoksa ekler. LangChain Chroma `addDocuments` implementation'ı altta `collection.upsert` çağırıyor. Fresh physical collection modelinde bu sorun değil; incremental model tasarlanırsa duplicate ID ve update davranışı açıkça ele alınmalı.
- Embedding dimensionality collection içinde sabit kalır. Embedding modeli değişirse aynı physical collection'a yazmaya çalışmak hata veya tutarsızlık üretir; yeni physical collection + registry pointer swap zorunlu kabul edilmeli.

### `src/ingestion/pipeline.ts`

Mevcut durum:

- `sourcePath` dosya ise tek dosya, directory ise sadece o directory altındaki ilk seviye dosyalar toplanıyor.
- Desteklenen dosya türleri `.txt`, `.md`, `.pdf`, `.doc`, `.docx` ve özel configured ozelge JSON.
- Metadata içinde `documentId`, `sourcePath`, `sourceType`, `chunkIndex` üretimi var; collection kimliği metadata'ya eklenmiyor.

Gereken değişiklik:

- Collection-specific indexing sırasında her chunk metadata'sına `collectionId`, `collectionVersion`, `sourceRevision` veya benzer izlenebilir alanlar eklenmeli.
- Directory source için recursive davranış isteniyorsa bu ayrıca tasarlanmalı; aksi halde collection onboarding UI/CLI "sadece ilk seviye dosyalar" davranışını açıkça göstermeli.
- Aynı physical collection içine birden fazla source set yazılmayacaksa bile metadata'da collection/version bilgisi debug ve audit için faydalı.

### `src/server.ts`

Mevcut durum:

- Sadece tek collection için:
  - `POST /rag/retrieve`
  - `POST /rag/query`
- `GET /rag/collections` yok.
- Collection bazlı readiness yok.
- Path, log ve response içinde collection kimliği yok.
- Auth, tenant/user ayrımı ve collection access control yok.

Gereken değişiklik:

- Yeni public endpoint yüzeyi:
  - `GET /v1/rag/collections`
  - `GET /v1/rag/collections/:collectionId`
  - `GET /v1/rag/collections/:collectionId/ready`
  - `POST /v1/rag/collections/:collectionId/retrieve`
  - `POST /v1/rag/collections/:collectionId/query`
- Admin/job endpoint yüzeyi:
  - `POST /v1/admin/collections`
  - `PATCH /v1/admin/collections/:collectionId`
  - `POST /v1/admin/collections/:collectionId/reindex`
  - `GET /v1/admin/jobs/:jobId`
  - `POST /v1/admin/jobs/:jobId/cancel` (opsiyonel)
- Eski `/rag/query` ve `/rag/retrieve` endpoint'leri kaldırılmalı. Dış kullanıcı olmadığı için default delegate veya redirect eklenmemelidir.
- Her request log'u `requestId`, `collectionId`, `physicalCollectionName`, `userId/tenantId`, latency ve error code içermeli.
- Public API baştan versioned olmalı. Sağlık endpointleri (`/health`, `/ready`) versiyonsuz kalabilir; ürün endpointleri `/v1/...` altında toplanmalıdır.
- Collection resolve işlemi controller'da tekrar tekrar kopyalanmamalı; `resolveReadableCollection(req)` gibi tek bir middleware/helper ile registry, auth ve active physical collection kontrolü yapılmalı.

### `src/admin/onboard.ts`

Mevcut durum:

- Global config dosyasını düzenliyor.
- Tek collection için destructive index onayı alıyor.
- Multi-collection oluşturma, güncelleme veya job takip mekanizması yok.

Gereken değişiklik:

- CLI iki moda ayrılmalı:
  - servis config onboarding
  - collection onboarding/indexing
- Collection onboarding örneği:
  - `npm run onboard -- collection create --display-name "İK Belgeleri" --source-path data/ik`
  - `npm run index -- --collection-id ik-belgeleri-7f3a2c`
- CLI de registry ve job/lock katmanını kullanmalı. Aksi halde HTTP API'nin koruduğu concurrency kurallarını CLI bypass eder.
- Mevcut onboarding CLI config odaklı kalabilir; collection onboarding ayrı subcommand olarak eklenmeli. Böylece servis config düzenleme ile collection lifecycle birbirine karışmaz.

### `package.json` ve Test Altyapısı

Mevcut durum:

- `test` script'i yok.
- Endpoint veya registry davranışını kilitleyen otomatik test yok.
- Yeni registry için DB bağımlılığı seçilmemiş.

Gereken değişiklik:

- Multi-collection refactor başlamadan önce en azından `npm test` script'i eklenmeli.
- Düşük bağımlılıklı başlangıç için Node'un built-in `node:test` altyapısı utility testleri için yeterli olabilir.
- Endpoint testleri için ayrıca bir HTTP test stratejisi belirlenmeli. Yeni dependency istenirse `supertest` benzeri bir araç eklenebilir; dependency eklenmeyecekse server bootstrap fonksiyonu export edilip `fetch` ile ephemeral port testleri yazılabilir.
- Registry storage bu implementasyonda SQLite olmalı. Geliştirme aşamasında bile gerçek collection lifecycle'ı modelleyen kalıcı bir registry kullanılmalı; config-backed default registry veya compatibility katmanı eklenmemeli.
- Daha sonra Postgres/Redis'e taşınacaksa interface sınırı baştan temiz tutulmalıdır.

### `test_frontend/index.html`

Mevcut durum:

- Kullanıcı collection seçemiyor.
- Endpointler tek collection'a sabit.
- Mevcut collection'ları keşfetme UI'ı yok.

Gereken değişiklik:

- Açılır collection listesi `GET /v1/rag/collections` ile dolmalı.
- Seçili collection'ın status/readiness bilgisi gösterilmeli.
- Query/retrieve butonları yeni path'e gitmeli.
- Collection `indexing`, `empty`, `failed`, `ready` durumlarında UI net davranmalı.

## Son Kullanıcı Collection'ları Kolayca Bulabiliyor mu?

Mevcut repoda hayır.

Kullanıcı yalnızca `/ready` cevabındaki tek `chromaCollection` alanını görebilir. Bu da collection keşfi değildir; sadece mevcut config'teki tek collection bilgisidir.

Planın bu ihtiyacı karşılaması için `GET /v1/rag/collections` endpoint'i registry tabanlı ve kullanıcı/tenant yetkisine göre filtreli olmalıdır. Chroma `listCollections()` tek başına yeterli değildir, çünkü:

- Display name, açıklama, owner, tenant, kaynak path'i ve status bilgisi Chroma listesinde güvenilir ürün bilgisi olarak yoktur.
- Versioned rebuild sonrası Chroma'da bir logical collection için birden çok physical collection bulunabilir.
- Orphan veya cleanup bekleyen collection'lar kullanıcıya gösterilmemelidir.
- Yetkilendirme Chroma collection adına göre değil, backend registry ve auth katmanına göre yapılmalıdır.

Önerilen `GET /v1/rag/collections` response örneği:

```json
{
  "collections": [
    {
      "id": "insan-kaynaklari-2024-7f3a2c",
      "displayName": "İnsan Kaynakları 2024",
      "description": "İK politika ve prosedür belgeleri",
      "status": "ready",
      "capabilities": {
        "query": true,
        "retrieve": true,
        "reindex": false
      },
      "chunkCount": 12840,
      "activeVersion": "20260531T191200Z",
      "updatedAt": "2026-05-31T19:12:00.000Z"
    }
  ]
}
```

## Endpoint Path'ine Collection Hash Ekleyelim mi?

Evet, collection kimliği path'te olmalı. Ama sadece hash kullanmak iyi bir API tasarımı değildir.

İyi seçenek:

```text
/v1/rag/collections/insan-kaynaklari-2024-7f3a2c/query
```

Kötü veya eksik seçenek:

```text
/v1/rag/collections/7f3a2c9d0a/query
```

Neden:

- Sadece hash kullanıcı ve loglar için anlamsızdır.
- Hash güvenlik sağlamaz; authorization yerine geçmez.
- Display name değişirse hash'in değişmemesi gerekir. Bu yüzden ID bir kez üretilip registry'de saklanmalıdır.
- Aynı display name farklı tenant'larda olabilir. ID üretimi tenant kapsamını ve collision riskini hesaba katmalıdır.

Önerilen ID stratejisi:

- `displayName` değerinden URL-safe slug üret.
- Collision veya tahmin edilebilirlik riskine karşı kısa random/ULID/UUID suffix ekle.
- Örnek: `insan-kaynaklari-2024-01jz8q2m4f` veya `insan-kaynaklari-2024-7f3a2c`.
- Bu public ID registry'de stabil kalır; display name sonradan değişse bile endpoint ID değişmez.

Chroma physical collection adı ayrı tutulmalı:

```text
rag_tenant42_insan-kaynaklari-2024-7f3a2c_20260531t191200z
```

Bu ayrım backend mimarisi açısından kritiktir: public API kimliği ile storage implementation detail birbirine bağlanmamalıdır.

Physical collection adı Chroma collection name kurallarına göre ayrıca normalize edilmelidir. Örneğin timestamp suffix'i küçük harf kullanmalı (`t`, `z`), ad küçük harf/rakamla başlayıp bitmeli ve nokta kullanılıyorsa ardışık nokta üretilmemelidir.

## Chroma Dokümanlarıyla Uyum Notları

Bu plan Chroma'nın resmi collection modeline şu şekilde hizalanmalıdır:

- Collection Chroma'da storage/query primitive'idir; fakat ürün seviyesinde kullanıcıya gösterilen logical collection registry'de tutulmalıdır.
- Chroma collection adları URL-safe kısıtlara sahiptir. Public `collectionId` path-safe olmalı, physical Chroma collection adı ayrıca Chroma-safe olmalıdır.
- `getOrCreateCollection` collection yoksa oluşturur. Read path'te bu kullanılmamalı; önce `getCollection`/`count` guard çalışmalıdır.
- Build path'te yeni physical collection doğrudan `createCollection` ile oluşturulmalı. Aynı physical name çakışırsa job fail etmeli; sessizce mevcut collection'a yazmamalıdır.
- Bu repo embeddings'i dışarıda ürettiği için Chroma collection `embeddingFunction: null` ile oluşturulmalı ve yazma/query sırasında embeddings backend tarafından sağlanmalıdır.
- HNSW metric (`l2`, `cosine`, `ip`) collection creation configuration'ıdır. Registry'de `distanceMetric` tutulmalı ve physical collection creation sırasında `configuration.hnsw.space` olarak uygulanmalıdır.
- `ef_search`, `num_threads`, `batch_size`, `sync_threshold`, `resize_factor` gibi bazı HNSW query/runtime ayarları sonradan değiştirilebilir; `space`, `ef_construction`, `max_neighbors` gibi index construction kararları için yeni physical collection build etmek daha güvenli kabul edilmelidir.
- `.add` duplicate ID'yi overwrite etmez; `.upsert` mevcut ID'yi update eder veya yoksa ekler. LangChain wrapper'ın `addDocuments` metodu altta `upsert` kullandığı için idempotency ve duplicate davranışı Chroma `.add` dokümanındaki davranışla bire bir aynı değildir.
- `.update` missing ID için hata loglayıp kaydı ignore edebilir; `.delete` id veya `where` filter ile kayıt siler. Versioned full rebuild modelinde bu operasyonlar ana indexing yolu değildir; incremental indexing fazı açılırsa ayrı sözleşme yazılmalıdır.
- Collection delete tüm embeddings/documents/metadata'yı siler. Eski physical collection cleanup background job olarak, registry pointer swap tamamlandıktan ve retention süresi dolduktan sonra yapılmalıdır.

## Önerilen Registry Modeli

Başlangıç için tablo/record alanları:

```text
collections
- id                         public collectionId
- tenantId                   auth/tenant kapsamı
- displayName
- description
- status                     creating | ready | indexing | failed | archived
- activePhysicalCollection   Chroma'daki aktif physical collection adı
- activeVersion
- sourcePath
- ozelgeDataPath
- embeddingModel
- chatModel
- distanceMetric
- chromaCollectionConfiguration
- chunkSize
- chunkOverlap
- retrievalK
- retrievalDistanceThreshold
- documentCount
- chunkCount
- createdBy
- createdAt
- updatedAt
- lastIndexedAt

index_jobs
- id
- collectionId
- status                     queued | running | succeeded | failed | cancelled
- targetPhysicalCollection
- targetChromaConfiguration
- startedAt
- finishedAt
- error
- documentCount
- chunkCount
- lockToken
```

Bu registry Chroma'nın yerine geçmez; Chroma vector storage, registry ise backend control plane olur.

## Doğrudan Hedef Mimariyi Uygulama Stratejisi

Geriye dönük uyumluluk gerekmiyor. Bu yüzden uygulama sırası eski davranışı korumaya değil, yeni mimari sınırları doğru kurmaya göre belirlenmelidir.

### Adım A: Registry Interface ve Kalıcı Registry Eklenir

Önce interface sınırı oluşturulur:

```text
CollectionRegistry
- listVisibleCollections(context)
- getVisibleCollection(context, collectionId)
- createCollection(context, input)
- updateCollection(context, collectionId, patch)
- beginIndexJob(collectionId)
- completeIndexJob(jobId, result)
- failIndexJob(jobId, error)
```

İlk implementasyon bile gerçek logical collection kayıtları üretmeli. `config.chroma.collection` üzerinden default collection emülasyonu yapılmamalı.

### Adım B: Lock ve Job State Eklenir

Gerçek çok kullanıcılı backend için bu adım şarttır:

- Registry transaction desteklemeli.
- Index job state kalıcı olmalı.
- Writer lock TTL/fencing token desteklemeli.
- Backend restart olduğunda running job'lar recoverable veya failed olarak işaretlenebilir olmalı.

### Adım C: RAG Core ve Indexing Versioned Physical Collection Modeline Geçirilir

Bu adımda destructive reset tamamen çıkarılır:

- Yeni physical Chroma collection'a build.
- Smoke/count doğrulama.
- Registry active pointer swap.
- Eski collection cleanup.

`npm run index` kalacaksa aynı güvenli job runner'ı çağırmalı; destructive maintenance komutu olarak kalmamalıdır.

### Adım D: Yeni API ve Test Frontend Eski Endpointleri Silerek Eklenir

- `POST /rag/query` ve `POST /rag/retrieve` kaldırılır.
- `GET /v1/rag/collections` ve collection scoped query/retrieve endpointleri eklenir.
- Test frontend sadece yeni endpointleri kullanır.
- README ve mimari dokümanlar eski endpointleri anlatmayacak şekilde güncellenir.

## Coding Agent İçin Uygulama Blueprint'i

Bu bölüm, planı implement edecek coding agent için doğrudan dosya ve sorumluluk haritasıdır. Amaç eski endpointleri korumadan, repo içinde net bir multi-collection backend sınırı kurmaktır.

### Uygulama İlkeleri

- Eski public endpointleri kaldır: `GET/POST /rag/query` ve `GET/POST /rag/retrieve` kalmamalı.
- Sağlık endpointleri kalsın: `GET /health`, `GET /ready`.
- Ürün endpointleri baştan `/v1/...` altında olsun.
- Chroma collection lifecycle doğrudan LangChain wrapper'a bırakılmamalı.
- Query/retrieve path hiçbir durumda Chroma'da yeni collection yaratmamalı.
- Index/rebuild path yeni physical collection oluşturmalı, başarılı build sonrası registry active pointer'ı değiştirmeli.
- İlk implementation gerçek logical collection kayıtları üreten kalıcı registry kullanmalı. Config-backed fake/default registry eklenmemeli.
- Auth henüz yoksa `tenantId = "default"` ve `userId = "local-dev"` gibi merkezi bir development context helper kullanılabilir; registry API yine tenant scoped tasarlanmalı.

### Önerilen Yeni Dosya Yapısı

```text
src/app.ts
src/server.ts
src/http/errors.ts
src/http/requestContext.ts
src/collections/types.ts
src/collections/ids.ts
src/collections/registry.ts
src/collections/sqliteRegistry.ts
src/collections/service.ts
src/collections/chromaCollections.ts
src/indexing/jobs.ts
src/indexing/buildPhysicalCollection.ts
src/rag.ts
src/index.ts
src/admin/onboard.ts
test/collections.ids.test.ts
test/collections.registry.test.ts
test/app.collections.test.ts
```

Mevcut repo küçük olduğu için bu dosyaların bazıları birleştirilebilir, ancak sorumluluklar karıştırılmamalıdır. Özellikle HTTP controller, registry, Chroma low-level helper ve RAG orchestration aynı dosyaya yığılmamalıdır.

### `src/app.ts` ve `src/server.ts`

Şu an `src/server.ts` hem Express app'i kuruyor hem `listen` çağırıyor. Test yazabilmek için ayrıştırılmalı:

```ts
export type AppDependencies = {
  registry: CollectionRegistry;
};

export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  // middleware, routes, static frontend
  return app;
}
```

`src/server.ts` sadece production/dev bootstrap yapmalı:

```ts
const registry = createSqliteCollectionRegistry(...);
const app = createApp({ registry });
app.listen(config.port, ...);
```

Endpoint testleri `createApp()` ile `listen` side effect'i olmadan yazılmalı.

### Registry Storage Kararı

Bu planı implement eden agent registry için SQLite kullanmalıdır. Önerilen başlangıç:

- Dependency: `better-sqlite3`
- Dev type dependency gerekiyorsa: `@types/better-sqlite3`
- Varsayılan DB path: `data/registry.sqlite`
- Test script'i: `node --import tsx --test "test/**/*.test.ts"`
- `src/config.ts` içindeki `configSchema`, `resolveConfig` ve `ResolvedConfig` çıktısına registry path eklenmeli:

```yaml
registry:
  path: data/registry.sqlite
```

Native dependency eklemek istenmezse agent kullanıcıya sormadan JSON registry'ye düşmemeli; JSON eşzamanlı backend planına uygun değildir. Böyle bir blocker varsa registry interface'i ve test fake'i eklenip kalıcı implementation ayrı bir açık görev olarak bırakılmalıdır.

### Registry Şeması

SQLite tabloları minimum şu alanlarla oluşturulmalı:

```sql
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  active_physical_collection TEXT,
  active_version TEXT,
  source_path TEXT NOT NULL,
  ozelge_data_path TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  chat_model TEXT NOT NULL,
  distance_metric TEXT NOT NULL,
  chroma_collection_configuration_json TEXT NOT NULL,
  chunk_size INTEGER NOT NULL,
  chunk_overlap INTEGER NOT NULL,
  retrieval_k INTEGER NOT NULL,
  retrieval_distance_threshold REAL NOT NULL,
  document_count INTEGER,
  chunk_count INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS index_jobs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  target_physical_collection TEXT NOT NULL,
  target_chroma_configuration_json TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  document_count INTEGER,
  chunk_count INTEGER,
  lock_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(collection_id) REFERENCES collections(id)
);
```

Status değerleri:

```text
collections.status = creating | indexing | ready | failed | archived
index_jobs.status = queued | running | succeeded | failed | cancelled
```

SQLite transaction kullanılmalı. Aynı logical collection için aynı anda ikinci running/queued job oluşturulmamalı.

### `src/collections/types.ts`

Önerilen TypeScript tipleri:

```ts
export type CollectionStatus = "creating" | "indexing" | "ready" | "failed" | "archived";
export type IndexJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type RequestContext = {
  tenantId: string;
  userId: string;
  requestId: string;
};

export type RagCollection = {
  id: string;
  tenantId: string;
  displayName: string;
  description?: string;
  status: CollectionStatus;
  activePhysicalCollection?: string;
  activeVersion?: string;
  sourcePath: string;
  ozelgeDataPath: string;
  embeddingModel: string;
  chatModel: string;
  distanceMetric: "l2" | "cosine" | "ip";
  chromaCollectionConfiguration: Record<string, unknown>;
  chunkSize: number;
  chunkOverlap: number;
  retrievalK: number;
  retrievalDistanceThreshold: number;
  documentCount?: number;
  chunkCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastIndexedAt?: string;
};
```

### `src/collections/ids.ts`

Bu dosya ID ve Chroma-safe name üretiminden sorumlu olmalı.

Gerekli fonksiyonlar:

```ts
export function slugifyCollectionName(displayName: string): string;
export function generateCollectionId(displayName: string): string;
export function createPhysicalCollectionName(input: {
  tenantId: string;
  collectionId: string;
  version: string;
}): string;
export function isValidChromaCollectionName(name: string): boolean;
export function assertValidChromaCollectionName(name: string): void;
```

Kurallar:

- Public `collectionId`: okunabilir `slug-shortid`.
- Physical name: `rag_<tenant>_<collectionId>_<version>`.
- Version string lowercase olmalı: örn. `20260531t191200z`.
- Physical name Chroma kurallarını geçmezse build başlamadan hata verilmeli.

### `src/collections/chromaCollections.ts`

Chroma low-level collection helper'ları burada olmalı:

```ts
export async function createPhysicalChromaCollection(input: {
  name: string;
  distanceMetric: "l2" | "cosine" | "ip";
  runtimeConfig: ResolvedConfig;
}): Promise<void>;

export async function assertChromaCollectionReadable(input: {
  name: string;
  runtimeConfig: ResolvedConfig;
}): Promise<{ count: number }>;

export async function deletePhysicalChromaCollection(input: {
  name: string;
  runtimeConfig: ResolvedConfig;
}): Promise<void>;
```

`createPhysicalChromaCollection` direct `ChromaClient.createCollection` kullanmalı:

```ts
await client.createCollection({
  name,
  embeddingFunction: null,
  configuration: {
    hnsw: {
      space: distanceMetric,
    },
  },
});
```

`getOrCreateCollection` read path'te de build path'te de kullanılmamalı. Name çakışması gerçek hata olarak görülmeli.

### `src/rag.ts` Refactor Hedefi

Mevcut fonksiyonlar options object'e geçirilmeli:

```ts
export function createVectorStore(options: {
  runtimeConfig?: ResolvedConfig;
  collectionName: string;
}): Chroma;

export async function retrieveSources(question: string, options: {
  collectionName: string;
  k?: number;
  runtimeConfig?: ResolvedConfig;
}): Promise<RetrievalResult>;

export async function answerQuestion(question: string, options: {
  collectionName: string;
  runtimeConfig?: ResolvedConfig;
  retrievalK?: number;
}): Promise<{
  answer: string;
  distanceScoreThreshold: number;
  sources: RagSource[];
}>;
```

`createVectorStore` artık collection yaratma sorumluluğu taşımamalı. Query route çağırmadan önce `assertChromaCollectionReadable` çalışmış olmalı.

`RagQueryErrorCode` içine şunlar eklenmeli:

```text
COLLECTION_NOT_FOUND
COLLECTION_NOT_READY
COLLECTION_INDEXING
COLLECTION_STORAGE_INCONSISTENT
MODEL_BACKPRESSURE
```

### `src/indexing/buildPhysicalCollection.ts`

Index build işi `src/index.ts` içindeki destructive `runIndexing` yerine bu modüle taşınmalı:

```ts
export async function buildPhysicalCollection(input: {
  collection: RagCollection;
  targetPhysicalCollection: string;
  targetVersion: string;
  runtimeConfig: ResolvedConfig;
  log?: (message: string) => void;
}): Promise<{
  sourceDocumentCount: number;
  parsedSourceDocumentCount: number;
  chunkCount: number;
}>;
```

Akış:

1. `createPhysicalChromaCollection(...)`
2. `analyzeIndexingSource` collection source ayarları ile çalıştırılır.
3. Chunk metadata'sına en az şunlar eklenir:
   - `collectionId`
   - `collectionVersion`
   - `physicalCollection`
4. `createVectorStore({ collectionName: targetPhysicalCollection })`
5. `addDocuments(indexedChunks, { ids })`
6. `assertChromaCollectionReadable` ile count doğrulanır.
7. Hata olursa target physical collection best-effort silinir.

`resetChromaCollection` ana akıştan çıkarılmalı. Gerekirse sadece test/maintenance helper olarak kalabilir, public job path kullanmamalı.

### `src/indexing/jobs.ts`

Job service registry transaction'larını yönetmeli:

```ts
export async function startReindexJob(input: {
  registry: CollectionRegistry;
  collectionId: string;
  context: RequestContext;
  runtimeConfig: ResolvedConfig;
}): Promise<IndexJob>;

export async function runIndexJob(input: {
  registry: CollectionRegistry;
  jobId: string;
  runtimeConfig: ResolvedConfig;
}): Promise<void>;
```

İlk implementation synchronous çalışabilir ama HTTP contract yine `202 Accepted` dönmeli. Basit başlangıç için route job'ı fire-and-forget başlatabilir; daha sonra queue/worker eklenebilir. Ancak job state registry'de kalıcı olmalı.

### Yeni Endpoint Kontratları

`POST /v1/admin/collections`

Request:

```json
{
  "displayName": "İK Belgeleri",
  "description": "İK politika dokümanları",
  "sourcePath": "data/ik",
  "ozelgeDataPath": "data/ozelge_veri.json",
  "distanceMetric": "cosine",
  "chunkSize": 500,
  "chunkOverlap": 200,
  "retrievalK": 5,
  "retrievalDistanceThreshold": 1
}
```

Response `201`:

```json
{
  "collection": {
    "id": "ik-belgeleri-7f3a2c",
    "displayName": "İK Belgeleri",
    "status": "creating"
  }
}
```

`POST /v1/admin/collections/:collectionId/reindex`

Response `202`:

```json
{
  "job": {
    "id": "20260531t191200z_7f3a2c",
    "collectionId": "ik-belgeleri-7f3a2c",
    "status": "queued",
    "targetPhysicalCollection": "rag_default_ik-belgeleri-7f3a2c_20260531t191200z"
  }
}
```

`GET /v1/rag/collections`

Response `200`:

```json
{
  "collections": [
    {
      "id": "ik-belgeleri-7f3a2c",
      "displayName": "İK Belgeleri",
      "status": "ready",
      "chunkCount": 12840,
      "activeVersion": "20260531t191200z",
      "capabilities": {
        "query": true,
        "retrieve": true,
        "reindex": false
      }
    }
  ]
}
```

`POST /v1/rag/collections/:collectionId/retrieve`

Request:

```json
{
  "question": "Soru metni",
  "k": 5
}
```

Response başarılıysa mevcut `/rag/retrieve` cevabına `collectionId`, `collectionDisplayName`, `activeVersion` eklenmeli.

`POST /v1/rag/collections/:collectionId/query`

Request:

```json
{
  "question": "Soru metni"
}
```

Response başarılıysa mevcut `/rag/query` cevabına `collectionId`, `collectionDisplayName`, `activeVersion` eklenmeli.

### HTTP Hata Kodları

```text
400 INVALID_REQUEST_BODY
403 COLLECTION_FORBIDDEN
404 COLLECTION_NOT_FOUND
404 COLLECTION_NOT_READY
409 COLLECTION_INDEX_ALREADY_RUNNING
422 NO_RELEVANT_CONTEXT
503 COLLECTION_INDEXING
503 COLLECTION_STORAGE_INCONSISTENT
503 MODEL_BACKPRESSURE
502 EMPTY_MODEL_RESPONSE
```

Hata response formatı tutarlı olmalı:

```json
{
  "error": "RAG query failed",
  "code": "COLLECTION_NOT_READY",
  "message": "Collection has no active indexed version yet.",
  "details": {
    "collectionId": "ik-belgeleri-7f3a2c"
  }
}
```

### Coding Agent Çalışma Sırası

Agent implementation sırasında şu sırayı izlemelidir:

1. `package.json` test script'i ve SQLite dependency ekle.
2. `src/app.ts` / `src/server.ts` ayrımını yap, mevcut route davranışını geçici olarak taşırken eski `/rag/*` endpointlerini kaldır.
3. `src/collections/ids.ts` ve unit testlerini ekle.
4. `CollectionRegistry` interface'i ve SQLite implementation'ını ekle.
5. Chroma helper'larını ekle: direct create, assert readable, delete.
6. `src/rag.ts` fonksiyonlarını collection-aware options object'e geçir.
7. `buildPhysicalCollection` ve job service'i ekle.
8. `/v1/admin/collections`, `/v1/admin/collections/:id/reindex`, `/v1/admin/jobs/:id` endpointlerini ekle.
9. `/v1/rag/collections`, `/v1/rag/collections/:id/ready`, `/retrieve`, `/query` endpointlerini ekle.
10. Test frontend'i yeni collection listesi ve scoped query endpointleriyle güncelle.
11. README ve mimari dokümanlardaki eski endpoint anlatımlarını kaldır.
12. `npm run build` ve `npm test` çalıştır.

Her faz sonunda TypeScript build kırık bırakılmamalı. Eğer SQLite native dependency kurulumu ortamda bloklanırsa agent JSON fallback yazmamalı; kullanıcıya dependency blocker'ı raporlamalıdır.

### Doğrulama Komutları

```powershell
npm.cmd install better-sqlite3
npm.cmd install -D @types/better-sqlite3
npm.cmd run build
npm.cmd test
```

Manuel smoke test örnekleri:

```powershell
$collection = @{
  displayName = "Test Belgeleri"
  sourcePath = "data"
  ozelgeDataPath = "data/ozelge_veri.json"
  distanceMetric = "l2"
  chunkSize = 500
  chunkOverlap = 200
  retrievalK = 5
  retrievalDistanceThreshold = 1
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3010/v1/admin/collections -Method Post -ContentType "application/json; charset=utf-8" -Body $collection
Invoke-RestMethod -Uri http://localhost:3010/v1/rag/collections
```

## Concurrency Stratejisi

### Query/Retrieve Path

Her request şu sırayı izlemeli:

1. `collectionId` path parametresini validate et.
2. Auth/tenant bağlamına göre registry'de collection'ı bul.
3. Collection yoksa `404 COLLECTION_NOT_FOUND`.
4. Collection kullanıcının yetkisinde değilse `403 COLLECTION_FORBIDDEN`.
5. `activePhysicalCollection` yoksa:
   - ilk indexing sürüyorsa `503 COLLECTION_INDEXING`
   - hiç index yoksa `404 COLLECTION_NOT_READY` veya `409 COLLECTION_EMPTY`
6. Aktif physical collection adına karşı `retrieveSources` veya `answerQuestion` çağır.
7. Chroma missing hatası registry ile çelişirse `503 COLLECTION_STORAGE_INCONSISTENT` ve alarm/log üret.

Rebuild sırasında aktif sürüm varsa query önceki aktif sürümden devam eder. Bu, "indexing sırasında tüm query'leri 503 dön" yaklaşımından daha etkili bir backend davranışıdır.

Ek guard:

- Registry collection yok diyorsa Chroma'ya hiç gidilmemeli.
- Registry active physical collection gösteriyorsa Chroma `getCollection` doğrulanmalı.
- Doğrulama başarısızsa LangChain vector store oluşturulmamalı; aksi halde Chroma tarafında boş collection yaratma riski vardır.
- Collection resolve sonucu request başında alınmalı ve request boyunca aynı physical collection'a bağlı kalmalı. Registry pointer request ortasında değişse bile o request tutarlı şekilde başladığı physical collection ile tamamlanmalı.
- Resolve edilen physical collection'ın registry'deki embedding model, distance metric ve active version değerleri response debug/log alanlarına eklenmeli. Bu, Chroma collection configuration ile registry pointer'ın ayrıştığı durumları tespit etmeyi kolaylaştırır.

### Index/Rebuild Path

Her logical collection için aynı anda tek writer olmalı.

Minimum doğru akış:

1. Lock al: `collection:<id>:writer`.
2. Lock alınamazsa `409 COLLECTION_INDEX_ALREADY_RUNNING`.
3. Yeni physical collection'a build et.
4. Başarı sonrası registry active pointer'ını transaction ile değiştir.
5. Lock'u release et.
6. Eski physical collection'ı retention süresi sonunda temizle.

Lock state:

- Bu implementasyonda lock/job state SQLite registry transaction'ları üzerinden yönetilmeli.
- In-memory `Map<string, ActiveJob>` sadece unit test fake'i için kullanılabilir; uygulama runtime'ında kullanılmamalıdır.
- Production-benzeri dağıtımda SQLite yerine Postgres advisory lock veya Redis lock tercih edilebilir, ancak interface bu değişime açık kalmalıdır.
- Lock TTL ve fencing token olmalı; worker ölürse stale lock sistemi kalıcı kilitlememeli.

### Ollama ve Chroma Backpressure

Çok kullanıcı aynı anda query attığında darboğaz yalnızca Chroma değildir:

- Her query embedding üretir.
- `/v1/rag/collections/:collectionId/query` ayrıca chat generation çalıştırır.
- Lokal Ollama sınırlı paralellikte çalışabilir.

Bu yüzden plan şunları da içermeli:

- `maxConcurrentEmbeddings`
- `maxConcurrentGenerations`
- queue timeout
- overload durumunda `429 TOO_MANY_REQUESTS` veya `503 MODEL_BACKPRESSURE`
- request timeout ve abort propagation
- Chroma retrieval timeout
- generation başlamadan önce client disconnect/abort kontrolü

Bu sınırlar collection bazlı değil, servis/model bazlı düşünülmelidir.

## Readiness ve Healthcheck

`GET /health` aynı kalmalı: sadece process liveness.

`GET /ready` servis altyapısını kontrol etmeli:

- Chroma reachable
- Ollama reachable
- embedding model available
- chat model available
- registry reachable

Default collection yok diye servis tamamen fail olmamalı. Multi-collection backend boş başlayabilir.

Collection readiness ayrı olmalı:

```text
GET /v1/rag/collections/:collectionId/ready
```

Bu endpoint şunları döndürmeli:

- collection registry'de var mı
- kullanıcı erişebilir mi
- active physical collection var mı
- Chroma collection count okunabiliyor mu
- collection indexing/rebuild job altında mı
- query/retrieve capability açık mı

## Fazlara Bölünmüş Uygulama Planı

### Faz 0: Davranış Sözleşmesini Netleştir

- [ ] Eski `/rag/query` ve `/rag/retrieve` endpointlerini kaldırma kararını uygulama kapsamına al.
- [ ] İlk uygulamada `tenantId = "default"` ve `userId = "local-dev"` kullan; data model tenant'a hazır kalmalı.
- [ ] Collection ID formatını belirle: `slug-shortid`.
- [ ] Physical Chroma collection name formatını Chroma ad kurallarına göre belirle.
- [ ] Registry storage olarak SQLite + `better-sqlite3` ekle; JSON registry kullanma.
- [ ] Public path'i baştan `/v1/...` olarak sabitle.
- [ ] `npm run index` komutunu güvenli registry/job runner akışını çağıracak şekilde yeniden tasarla.
- [ ] `config/rag.config.yaml` ve `src/config.ts` hedef config şekline göre güncellensin; `chroma.collection` kaldırılıp `registry.path` ve `collectionDefaults` eklensin.

### Faz 0.5: Test ve Bootstrap Hazırlığı

- [ ] `npm test` script'i ekle.
- [ ] `package.json` içine `"test": "node --import tsx --test \"test/**/*.test.ts\""` ekle.
- [ ] Collection ID slug/short-id üretimi için unit test ekle.
- [ ] Physical Chroma collection name üretimi için Chroma-safe unit test ekle.
- [ ] Registry interface için in-memory/static fake ile test yaz.
- [ ] Express app creation ile `listen` ayrıştırılsın; endpoint testleri server process'i başlatmadan yapılabilsin.
- [ ] Eski `/rag/query` ve `/rag/retrieve` endpointlerinin artık public API yüzeyinde olmadığını test et.
- [ ] `GET /v1/rag/collections` registry-backed listeleme davranışı test edilsin.

### Faz 1: RAG Core'u Collection-Aware Yap

- [ ] `RagQueryErrorCode` içine `COLLECTION_NOT_FOUND`, `COLLECTION_NOT_READY`, `COLLECTION_STORAGE_INCONSISTENT` ekle.
- [ ] `createVectorStore` imzasına explicit `collectionName` ekle.
- [ ] `retrieveSources` ve `answerQuestion` imzalarını options object'e geçir.
- [ ] `checkChromaHealth` collection parametresi alabilir hale getir.
- [ ] Chroma `listCollections`, `countCollection`, `collectionExists` helper'larını ekle.
- [ ] Missing collection hatalarını `404` olarak map et.
- [ ] Read path'te Chroma collection yoksa LangChain `getOrCreateCollection` çağrılmadan hata dönüldüğünü testle.
- [ ] Physical collection creation için direct ChromaClient helper ekle ve `configuration.hnsw.space` uygulandığını testle.

### Faz 2: Collection Registry Ekle

- [ ] `src/collections/registry.ts` oluştur.
- [ ] `CollectionRegistry` interface'i oluştur.
- [ ] İlk implementation bile gerçek logical collection kayıtları üreten kalıcı registry olsun; config-backed default registry ekleme.
- [ ] Collection create/list/get/update işlemlerini registry üzerinden yap.
- [ ] Public `collectionId` ile physical Chroma collection adını ayır.
- [ ] Slug + short ID üretimi için test ekle.
- [ ] Registry'de `status`, `activePhysicalCollection`, `activeVersion`, `chunkCount` alanlarını tut.
- [ ] Registry'de `distanceMetric`, `embeddingModel`, `chromaCollectionConfiguration` alanlarını tut.
- [ ] SQLite schema/versioning formatını netleştir.

### Faz 3: API Endpointlerini Yeniden Tasarla

- [ ] `GET /v1/rag/collections` ekle.
- [ ] `GET /v1/rag/collections/:collectionId` ekle.
- [ ] `GET /v1/rag/collections/:collectionId/ready` ekle.
- [ ] `POST /v1/rag/collections/:collectionId/retrieve` ekle.
- [ ] `POST /v1/rag/collections/:collectionId/query` ekle.
- [ ] Eski `/rag/query` ve `/rag/retrieve` endpointlerini kaldır; delegate veya redirect ekleme.
- [ ] Response payload'larına `collectionId` ve `collectionDisplayName` ekle.
- [ ] Collection resolve middleware/helper ekle; registry/auth/active physical kontrollerini tek yerde yap.
- [ ] Tüm ürün endpointlerini `/v1` altında topla.

### Faz 4: Zero-Downtime Index/Rebuild

- [ ] `runIndexing` physical target collection alacak şekilde refactor et.
- [ ] `resetChromaCollection` ana rebuild akışından çıkar.
- [ ] `index_jobs` state'i ekle.
- [ ] Collection-level writer lock ekle.
- [ ] Rebuild API'sini async job olarak tasarla: `202 Accepted`.
- [ ] Başarılı build sonrası registry active pointer'ını atomik değiştir.
- [ ] Eski physical collection cleanup akışı ekle.
- [ ] İlk build sırasında query davranışını netleştir: `503 COLLECTION_INDEXING`.
- [ ] Worker restart/stale lock davranışı tanımla.
- [ ] Failed rebuild'in önceki aktif sürümü değiştirmediğini testle.
- [ ] Embedding modeli veya immutable HNSW construction ayarları değiştiğinde yeni physical collection build edildiğini testle.

### Faz 5: Backend Operasyonel Olgunluk

- [ ] Request ID middleware ekle.
- [ ] Structured log alanları ekle: collectionId, physicalCollection, jobId, latency.
- [ ] Model backpressure için semaphore/queue ekle.
- [ ] Rate limit ve body limit collection/user bazında düşün.
- [ ] Auth/tenant middleware için yer ayır; en azından registry sorgularını tenant scoped tasarla.
- [ ] `/ready` endpointini registry-aware hale getir.
- [ ] Retrieval ve generation latency alanlarını response/debug log seviyesinde ölç.
- [ ] Chroma ve Ollama timeout'larını query path'in tamamına yay.

### Faz 6: Test Frontend ve Dokümantasyon

- [ ] Test UI collection dropdown ile başlasın.
- [ ] Collection status ve readiness UI'da görünsün.
- [ ] Query/retrieve yeni endpointleri kullansın.
- [ ] README multi-collection API örnekleriyle güncellensin.
- [ ] Rebuild sırasında önceki aktif physical collection'dan query dönme davranışı dokümante edilsin.
- [ ] README eski `/rag/query` ve `/rag/retrieve` endpointlerini anlatmayacak şekilde güncellensin.

## Test Kabul Kriterleri

- [ ] `GET /v1/rag/collections` sadece kullanıcının erişebildiği logical collection'ları listeler.
- [ ] Registry'de olmayan collection için Chroma'da yeni boş collection oluşmaz.
- [ ] Üretilen physical Chroma collection adları Chroma ad kurallarına uyar.
- [ ] Build edilen physical collection `configuration.hnsw.space` değerini registry `distanceMetric` değerinden alır.
- [ ] Bilinmeyen `collectionId` için query/retrieve `404 COLLECTION_NOT_FOUND` döner.
- [ ] Yetkisiz collection için `403 COLLECTION_FORBIDDEN` döner.
- [ ] Aktif sürümü olmayan ve indexing süren collection için `503 COLLECTION_INDEXING` döner.
- [ ] Rebuild sırasında önceki aktif sürüm varsa query/retrieve başarılı çalışmaya devam eder.
- [ ] Aynı collection için iki rebuild isteğinden ikincisi `409 COLLECTION_INDEX_ALREADY_RUNNING` döner.
- [ ] Farklı collection'lar aynı anda rebuild edilebilir.
- [ ] Rebuild başarısız olursa önceki aktif sürüm değişmeden kalır.
- [ ] `GET /v1/rag/collections/:collectionId/ready` collection bazlı doğru readiness verir.
- [ ] Test frontend collection listesi boşsa kullanıcıya query formunu pasif gösterir.

## Mimari Etkinlik Değerlendirmesi

İlk planın yönü doğruydu: collection'ı API sözleşmesine taşımak, RAG core'u parametreli hale getirmek ve readiness'i collection-aware yapmak gerekli.

Ancak ilk plan şu noktalarda eksikti:

- In-memory lock production backend için yetersiz.
- Re-index sırasında query'ye doğrudan 503 dönmek gereksiz kesinti yaratır.
- Collection discovery için Chroma listesi source of truth olamaz.
- Hash path'e koymak tek başına kimlik, erişim ve lifecycle problemini çözmez.
- Admin indexing işinin async job olarak modellenmesi gerekir.
- Ollama concurrency/backpressure hesaba katılmamıştı.

Revize planla mimari daha etkin hale gelir:

- Kullanıcı collection'ları açıkça keşfeder.
- API path'leri loglama, yetkilendirme ve observability için netleşir.
- Storage detayı public API'den ayrılır.
- Rebuild işlemi mümkün olduğunca kesintisiz hale gelir.
- Aynı anda çok kullanıcı ve çok collection senaryosu servis seviyesinde yönetilebilir olur.
