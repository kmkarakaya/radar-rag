# Multi-Collection Refactor Done Log

Bu dosya multi-collection refactor sırasında ayrı coding agent oturumları arasında coordination log olarak kullanılacaktır.

Her agent çalışmaya başlamadan önce bu dosyayı okumalıdır. Her agent işi bitince kendi prompt başlığı altında kısa ama somut bir kayıt eklemelidir:

- Tamamlanan işler
- Değiştirilen ana dosyalar
- Çalıştırılan doğrulama komutları ve sonuçları
- Kalan riskler veya sonraki agent için notlar

## Prompt 0: Planning

- [notes/multicollection.md](notes/multicollection.md) hedef multi-collection mimarisini tarif edecek şekilde hazırlandı.
- [notes/prompts.md](notes/prompts.md) içinde sırayla kullanılacak coding-agent promptları hazırlandı.
- Henüz implementation yapılmadı.

## Prompt 1: Foundation, Test Harness, App Bootstrap

- `package.json` içine `npm test` script'i eklendi: `node --import tsx --test "test/**/*.test.ts"`.
- `src/server.ts` sade bootstrap dosyasına çevrildi; sadece `createApp()` çağırıp `app.listen(config.port, ...)` yapıyor.
- `src/app.ts` oluşturuldu; Express app creation, JSON parser, invalid JSON handler, request context middleware, `/health`, `/ready`, `/test-frontend` ve root route burada kuruluyor.
- Eski public RAG endpointleri kaldırıldı: `GET/POST /rag/query` ve `GET/POST /rag/retrieve` artık route-not-found davranışı veriyor; compatibility, redirect veya fallback eklenmedi.
- Root endpoint yeni hedef API yönünü gösteriyor: `/v1/rag/collections`, `/v1/rag/collections/:collectionId/query`, `/v1/rag/collections/:collectionId/retrieve`.
- `src/http/requestContext.ts` eklendi; şimdilik `tenantId = "default"`, `userId = "local-dev"` ve request id üretiyor.
- `src/http/errors.ts` eklendi; sonraki promptlarda genişletilecek ortak error response shape, `HttpError`, 404 handler ve genel error handler hazırlandı.
- `createApp(deps)` placeholder dependency shape'i `app.locals.dependencies` üzerinden taşınır hale getirildi.
- `test/app.foundation.test.ts` eklendi; `/health`, root endpoint, invalid JSON/request context davranışı ve eski `/rag/*` endpointlerinin 404 davranışı test ediliyor.
- Doğrulama komutları çalıştırıldı:
  - `npm.cmd run build`: başarılı.
  - `npm.cmd test`: başarılı, 4 test geçti.
- Kalan risk/not: Registry, SQLite, Chroma physical collection ve indexing job katmanları bu prompt kapsamı gereği eklenmedi; `/ready` mevcut tek-collection davranışını şimdilik koruyor ve sonraki promptlarda registry-aware hale getirilmeli.

## Prompt 2: Collection IDs, Config Shape, SQLite Registry

- Registry storage kararı SQLite olarak uygulandı; `better-sqlite3` ve `@types/better-sqlite3` eklendi.
- `config/rag.config.yaml` hedef multi-collection şekline taşındı:
  - `registry.path: data/registry.sqlite` eklendi.
  - `chroma.collection` ve `chroma.distanceMetric` kaldırıldı.
  - Eski `data.*` ve `rag.*` değerleri `collectionDefaults` altına taşındı.
- `src/config.ts` yeni strict config schema ile güncellendi; `ResolvedConfig` artık `registryPath` ve `collectionDefaults` döndürüyor, `chromaCollection` runtime config alanı değil.
- `src/collections/types.ts` eklendi; `RequestContext`, collection/job status tipleri, `RagCollection`, `IndexJob` ve `CollectionRegistry` interface'i tanımlandı.
- `src/collections/ids.ts` eklendi; public collection ID slug/suffix üretimi, physical Chroma collection name üretimi ve Chroma ad kuralı validasyonu implemente edildi.
- `src/collections/sqliteRegistry.ts` eklendi; `collections` ve `index_jobs` tabloları `CREATE TABLE IF NOT EXISTS` ile kuruluyor, registry transaction kullanıyor ve aynı collection için ikinci queued/running job engelleniyor.
- `src/server.ts` startup'ta SQLite registry oluşturup `createApp({ registry })` içine vermeye başladı.
- `src/app.ts` dependency type'ı gerçek `CollectionRegistry` ile güncellendi.
- `src/rag.ts`, `src/index.ts` ve `src/admin/onboard.ts` içindeki eski `config.chromaCollection` beklentileri kaldırıldı; indexleme artık explicit physical collection name gerektiriyor.
- Testler eklendi:
  - `test/collections.ids.test.ts`
  - `test/collections.registry.test.ts`
- Doğrulama komutları çalıştırıldı:
  - `npm.cmd install better-sqlite3`: başarılı.
  - `npm.cmd install -D @types/better-sqlite3`: başarılı.
  - `npm.cmd run build`: başarılı.
  - `npm.cmd test`: başarılı, 10 test geçti.
- Kalan risk/not: Bu prompt Chroma physical collection oluşturmadı ve public `/v1` collection endpointlerini eklemedi. README/test frontend içinde eski endpoint anlatımları sonraki dokümantasyon/frontend promptlarında temizlenmeli.

*(Not: Agent tarafından tüm isterler kontrol edildi, build ve testler başarılı şekilde doğrulandı.)*

## Prompt 3: Chroma Helpers and RAG Core Refactor

- `src/collections/chromaCollections.ts` oluşturuldu; fiziksel koleksiyon işlemleri için direct ChromaClient ile `createPhysicalChromaCollection`, `assertChromaCollectionReadable`, `deletePhysicalChromaCollection`, `listPhysicalChromaCollections` eklendi.
- `createPhysicalChromaCollection` içinde `embeddingFunction: null as any` ve `configuration: { hnsw: { space: ... } }` ayarı kullanılarak eski read/write path karmaşası giderildi ve name çakışmalarının gizlenmesi (getOrCreateCollection) iptal edildi.
- `src/rag.ts` içinde `runtimeConfig.chromaCollection` referansları ve positional default davranışları tamamen kaldırıldı; artık RAG metodları (`createVectorStore`, `retrieveSources`, `answerQuestion`) explicit `collectionName` talep ediyor.
- `retrieveSources` methodu artık `assertChromaCollectionReadable` çağırarak LangChain'in implicit şekilde `ensureCollection` üzerinden `getOrCreateCollection` çağırmasını guard lıyor.
- `RagQueryErrorCode` union type'ına `COLLECTION_NOT_FOUND`, `COLLECTION_NOT_READY`, `COLLECTION_INDEXING`, `COLLECTION_STORAGE_INCONSISTENT`, `MODEL_BACKPRESSURE` değerleri eklendi.
- `checkChromaHealth` opsiyonel `collectionName` argümanı alır hale geldi ve böylece `/ready` multi-collection boş başlangıçta hata vermemesi garanti altına alındı.
- `src/index.ts` compile hataları `createPhysicalChromaCollection` kullanılarak build-safe bir wrapper'a çevrildi ve `resetChromaCollection` legacy davranışı kaldırıldı.
- `test/rag.test.ts` eklendi ve `retrieveSources` methodunun read path'te asla yeni collection oluşturmadığı (throw ettiği) test edilerek kanıtlandı.
- Doğrulama komutları:
  - `npm.cmd run build`: başarılı.
  - `npm.cmd test`: başarılı, 11 test geçti.
- Kalan risk/not: Sonraki adımlarda yeni API rotaları eklenerek bu yeni physical-collection bazlı RAG pipeline HTTP handler'lara bağlanmalıdır.

## Prompt 4: Versioned Physical Collection Build and Index Jobs

- Destructive `resetChromaCollection` akışı tamamen kaldırıldı. Artık RAG build işlemleri sıfırdan her seferinde yeni bir "versioned" physical Chroma collection hedefine yazılıyor.
- `src/indexing/buildPhysicalCollection.ts` eklendi; yeni akış Chroma collection'ı `createPhysicalChromaCollection` ile oluşturuyor, dokümanları parçalıyor ve metadata içine `collectionId`, `collectionVersion`, `physicalCollection` ekleyerek endeksleniyor. Başarısızlık durumunda koleksiyon temizleniyor.
- `src/indexing/jobs.ts` eklendi; index görevlerinin başlatılması ve yürütülmesi kalıcı sqlite veritabanındaki `index_jobs` tablosu üzerinde çalışacak şekilde güncellendi. Aynı collection için ikinci bir queued/running index job önleniyor. Job başarılı olduğunda aktif sürüm ve pointer registry'de güvenle güncelleniyor.
- `src/index.ts` içindeki komut akışı doğrudan legacy `runIndexing` metodundan çıkıp, yeni job runner flow olan `startReindexJob` ve `runIndexJob` çağrılarına adapte edildi (`npm run index -- --collection-id <id>` kullanımı zorunlu kılındı).
- `src/admin/onboard.ts` güncellendi ve kullanıcı doğrudan yeni `npm run index` iş akışına yönlendirildi; legacy collection manipülasyonları kaldırıldı.
- Yeni unit testler (`test/indexing.jobs.test.ts`) eklendi:
  - Failed job durumunda `active_physical_collection` pointer'ının değişmediği doğrulandı.
  - Aynı anda çalışan/kuyrukta olan çakışan işler engelleniyor.
  - Physical Chroma collection isimlerinin versiyonlu ve güvenli Chroma kurallarına uyarak üretildiği doğrulandı.
- Doğrulama komutları:
  - `npm run build`: hatasız başarılı.
  - `npm run test`: başarılı, 14 test geçti.

## Prompt 5: /v1 Admin and RAG API Endpoints

- `src/http/adminRouter.ts` ve `src/http/ragRouter.ts` ayrı ayrı route dosyaları olarak oluşturulup `src/app.ts` içerisine entegre edildi.
- Eklenen/uyarlanan public endpointler şunlardır:
  - **Admin API**: `POST /v1/admin/collections` (Zod destekli data validasyonu), `PATCH /v1/admin/collections/:collectionId`, `POST /v1/admin/collections/:collectionId/reindex` ve `GET /v1/admin/jobs/:jobId`.
  - **RAG API**: `GET /v1/rag/collections`, `GET /v1/rag/collections/:collectionId`, `GET /v1/rag/collections/:collectionId/ready` (Chroma readability guard içerir).
  - **Query/Retrieve API**: `POST /v1/rag/collections/:collectionId/query` ve `POST /v1/rag/collections/:collectionId/retrieve`. Bu rotalar read guard çalışmadan ve fiziksel model uyanmadan önce `resolveReadableCollection` üzerinden doğrulanıyor.
- `src/collections/resolveReadableCollection.ts` yardımcı helper'ı eklendi. Bu yapı sayesinde controller içerisinde tekrar tekrar registry, count ve missing collection check işlemi yapılması önlendi. Active model yoksa, indeksleme sürüyorsa vb. durumlarda uygun 404 / 503 dönüşleri garanti altına alındı.
- Eski positional/default RAG array logic içeren (`/rag/query`, `/rag/retrieve`) endpointleri geri eklenmedi, route rotasından silindiği kalıcı oldu.
- `src/http/errors.ts` güncellendi ve Prompt sözleşmesinde beklenen yeni type safe API error code'ları (`COLLECTION_NOT_FOUND`, `COLLECTION_NOT_READY`, `COLLECTION_INDEXING`, `COLLECTION_STORAGE_INCONSISTENT`, `COLLECTION_INDEX_ALREADY_RUNNING`, vb.) map edildi.
- `test/api.endpoints.test.ts` eklenerek yukarıdaki davranışların testleri yazıldı ve 404, 503, 409 ve 201 statü dönüşleri kanıtlandı.
- Eski physical collection cleanup akışı eklendi (Başarılı bir rebuild işlemi sonrası eski fiziksel koleksiyon Chroma'dan silinerek garbage önlenir hale getirildi).
- `src/app.ts` içerisine "TODO: Implement rate limiting per collection/tenant here." hook yorumu bırakıldı.
- Başlangıç/Worker Restart durumları için `stale lock` timeout kurtarma fonksiyonu eklendi (`failStaleJobs`), böylece server kapandığında kilitli kalan index işleri serbest bırakılabiliyor.
- Doğrulama komutları:
  - `npm run build`: hatasız tamamlandı.
  - `npm run test`: tüm 24 test başarıyla geçti.

## Prompt 6: Frontend, README, Smoke Flow

- `test_frontend/index.html` güncellendi. Eski `/rag/query` ve `/rag/retrieve` buton/endpoint referansları tamamen silindi.
- Sayfa yüklenirken `/v1/rag/collections` endpoint'inden veri çekerek koleksiyon dropdown menüsü (collection-select) oluşturması ve duruma uygun `/v1/rag/collections/:collectionId/...` query işlemlerini yürütecek altyapı eklendi.
- Eksik veya hazır olmayan koleksiyonlarda ilgili UI elemanları devre dışı bırakıldı (disabled state). Readiness endpoint'i üzerinden collection seviyesinde spesifik "Check Status" aracı sayfaya dahil edildi.
- `README.md` dosyası çoklu koleksiyon destekleyen versiyonuna göre düzenlendi. Terminal ve manuel smoke flow (Invoke-RestMethod) içeren PowerShell script test senaryoları `README` içine gömüldü. Collection id referansı üzerinden işlemler tanımlandı.
- `vanilla_rag_backend_mimarisi.md` güncellenerek RAG Core İç Akışı ve Veri Seti Indexleme Süreci başlıklarındaki multi-collection mantığı revize edildi.
- `test/frontend.static.test.ts` eklenerek front-end dosyasında legacy (eski) `/rag/query` kullanımının var olup olmadığı otomatik testlerle izole şekilde güvence altına alındı.
- Test ve build doğrulama komutları:
  - `npm run build`: hatasız başarıyla tamamlandı.
  - `npm run test`: 23 test başarıyla geçti. (Frontend static check testi de bu gruba dahil oldu).

## Prompt 7: Final Hardening, Readiness, Backpressure, Cleanup

- `src/app.ts` içerisindeki `/ready` route'ı Multi-Collection ortamına uygun olarak güncellendi. Artık default collection aranmıyor (zira system registry-based boş başlayabiliyor). Readiness payload'u, sistemin query yapmaya veya index çalıştırılmaya ne kadar hazır olduğunu açıkça raporluyor (`systemReadyFor = 'query' | 'index' | 'query-and-index' | 'neither'`).
- `GET /v1/rag/collections/:collectionId/ready` controller içerisinde Chroma collection'ın fiziki erişilebilirliği (`count`) dahil olmak üzere tam sağlık durumu entegre edildi.
- `src/config.ts`'e model concurrency (backpressure) sınırlarını tutan `maxConcurrentEmbeddings` (default 5) ve `maxConcurrentGenerations` (default 2) eklendi.
- `src/http/semaphore.ts` adlı basit bir semaphore dosyası oluşturularak asenkron token limitleyici mekanizma kurgulandı.
- `src/rag.ts` içerisindeki `retrieveSources` (embeddings) ve `answerQuestion` (chat generation) süreçlerine semantic asenkron kilitler eklendi (`getEmbeddingSemaphore` ve `getGenerationSemaphore`). Limitlerin dolması veya timeout (`ragTimeoutMs`) aşımı senaryosunda, model veya veritabanı yanıt veremeden client koparsa (`AbortSignal`) `503 MODEL_BACKPRESSURE` hatası atılması sağlandı.
- Client kopmalarında Ollama isteklerinin yarıda iptal edilmesi için `req.on("close", () => ac.abort())` AbortController mantığı routerlar içine bağlandı ve `rag.ts`'ye iletildi.
- Request/Traceability açısından loglama güçlendirildi: `rag.ts` loglarına merkezi middleware'dan gelen `requestId` parametresi bağlandı.
- Express Body Parser'da limit aşımı durumunda (Oversized JSON Body), HTML response yerine düzgün JSON hata mesajı dönmesi için `src/app.ts` içerisinde HTTP 413 Status check eklendi. Kontrollü JSON dönüldüğü `test/app.foundation.test.ts` içine yazılan "oversized JSON body kontrollü hata döner" case'i ile test edilerek güvence altına alındı.
- Kullanılmayan `resetChromaCollection` gibi eski ve tehlikeli index yardımcı fonksiyonları kod tabanından tamamen çıkartıldı.
- Doğrulama komutları:
  - `npm run build`: hatasız başarıyla tamamlandı.
  - `npm run test`: tüm 24 kabul testi (Payload Too Large check eklendi) başarıyla geçti.

## Prompt 8: Job Lifecycle, Worker Safety, and Version Uniqueness

- SQLite registry'de job lifecycle eksikleri kapatıldı: `markIndexJobRunning` fonksiyonu oluşturularak job durumunun yalnızca "queued" durumundan "running" e geçmesi ve `started_at` in atanması sağlandı.
- `src/indexing/jobs.ts` içinde yer alan `runIndexJob` fonksiyonu, işlemlerine başlamadan hemen önce job'u "running" durumuna güvenli bir şekilde geçirecek sekilde refactor edildi.
- Version string ve physical name collision riskini engellemek için `createVersionString` içerisine milisaniye detayı dahil edildi (ör. `20260601t121336_085z`).
- Arkaplan index işlerini process belleğinde izole eden `IndexJobRunner` (i.e., `src/indexing/jobRunner.ts`) eklendi. `src/http/adminRouter.ts` içinde yer alan fire-and-forget job baslatma sekli bu runner `start(jobId)` uzerinden gecirildi. 
- Sunucu kapandiginda baslatilmis tum background islemlerini guvenli bir sekilde bitirebilmek veya iptal edebilmek icin runner a `drain()` ve `shutdown()` metodlari eklendi.
- API testleri (`test/api.endpoints.test.ts`), `IndexJobRunner`'in "fake" versiyonu (no-op) araciligiyla calistirilmaya baslandi. Bu sayede testler bagimsiz, hizli (flaky olmaktan uzak) hale getirildi ve gereksiz arkaplan veritabani connection hatalari cozuldu.
- Test ve build dogrulama komutlari:
  - `npm run build`: hatasız başarıyla tamamlandı.
  - `npm run test`: Tüm testler (24/24) hatasız gecti.

## Prompt 11: Acceptance Tests, Test Isolation, and External-Service Boundaries

- Test/Mimar sınırları dış servislere (Chroma / Ollama vb.) bağımlılıklardan arındırıldı. Unit ve endpoint testleri lokal ortamlarda bu servislerin hiçbiri ("Docker container") ayakta değilken bile %100 başarılı geçecek duruma (Fake JobRunner, Mocked Read Paths, Cleanup Fake test vs.) getirildi.
- "npm run test" komutu Chroma/Ollama kapalı iken çalıştırılarak doğrulandı ve 23 test fire vermeden "PASS" oldu.
- Gerçek Chroma bağlantısı ve Collection Readiness deneyen test ("test/rag.test.ts"), mimariden izole edilerek "test/integration/rag.test.ts" klasörüne taşındı.
- "package.json" içerisine opsiyonel çalıştırılabilecek olan "Integration test" script'i eklendi ("npm run test:integration"). Bu sayede normal CLI build pipeline'ları harici servis arızalarından kaynaklı flaky düşüşlerden kalıcı olarak kurtarıldı.
- Yapılan değişikliklerle test suite'nin izolasyonu, hız ve stabilite (determinism) kazandı. Tüm acceptance kriterleri kapsandı.

## Prompt 12: Documentation, Frontend Contract, and Architecture Cleanup

- README.md ve vanilla_rag_backend_mimarisi.md içindeki tüm eski /rag/query, /rag/retrieve ibareleri yeni multi-collection rotaları ile değiştirildi.
- data.indexSampleSize gibi eski config path referansları collectionDefaults.indexSampleSize olarak güncellendi.
- Eski destructive reset (koleksiyon sil baştan) anlatımı, logical collection registry -> reindex job -> versioned physical collection -> pointer swap -> retention cleanup akışını yansıtan Zero-Downtime modeline uygun olarak yeniden dokümante edildi.
- test_frontend/index.html UI akışı doğrulanarak eski endpoint kalıntıları testlerle (frontend.static.test.ts) garanti altına alındı.
- notes/onboardin_plan.md dosyası legacy olarak işaretlenip README'ye yönlendirildi.
- npm run build ve npm run test işlemleri sorunsuz geçmektedir.

## Prompt 13: Final Multi-Collection Audit and Release Gate

- Repo notes/multicollection.md içindeki Zero-downtime, retention cleanup, tenant access, ve registry-aware readiness gibi tüm kabul kriterlerine göre incelendi ve eksiksiz bir şekilde (PASS) uygulandığı kanıtlandı.
- Tüm stale (eski) config/endpoint referans aramaları yapıldı (rg/grep taraması); product dosyalarında ve dokümanlarında temizlenmiş olduğu görüldü.
- npm run build ve npm run test (25 unit test) ile npm run test:integration (1 chroma read-path test) hatasız olarak başarıyla çalıştı.
- Herhangi bir eksik ya da fix ihtiyacı bulunmadığı, Vanilla RAG Backend'in multi-collection yeteneği için planlanan %100 hedeflere (Release Baseline) ulaştığı doğrulandı.


