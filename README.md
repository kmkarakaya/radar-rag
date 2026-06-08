# Vanilla RAG Backend

Minimal TypeScript Express backend for a traditional LangChain RAG flow over documents in `data/`.

Bu repo, agentic bir akış yerine sağlam, operasyonel olarak güvenli ve çoklu koleksiyon (multi-collection) destekleyen basit bir Vanilla RAG backend uygular. Temel odak noktası **sıfır kesinti (zero-downtime) ile endeksleme**, **backpressure yönetimi** ve **güvenli durum (state) yönetimidir**.

Detaylı mimari ve endpoint sözleşmeleri için [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md) dosyasına bakabilirsiniz.

## Öne Çıkan Özellikler

- **Çoklu Koleksiyon (Multi-Collection) Desteği:** Tek bir backend üzerinden farklı yapılandırmalara (farklı embedding modeli, distance metric, chunk size vb.) sahip birden fazla mantıksal (logical) RAG koleksiyonu yönetebilirsiniz.
- **Sıfır Kesinti ile Endeksleme (Zero-Downtime Rebuild):** Endeksleme işlemleri arka planda her seferinde yeni bir "versiyonlu fiziksel Chroma koleksiyonuna" yazılır. İşlem başarıyla bittiğinde aktif yönlendirici (pointer) ve aktif embedding modeli snapshot'ı (`activeEmbeddingModel`) atomik olarak değiştirilir. Böylece sorgu (query) işlemleri endeksleme süresince eski veriden ve eski embedding modelinden kesintisiz hizmet almaya devam eder; admin tarafından istenen model değişikliği ancak re-index bittiğinde devreye girer.
- **Model Backpressure & Concurrency Koruması:** Eşzamanlı istek yığılmalarına karşı Ollama ve Chroma etkileşimlerinde asenkron kilitler (semaphore) kullanılır (`maxConcurrentEmbeddings`, `maxConcurrentGenerations`). Sistem kapasitesi aşıldığında veya client bağlantıyı kestiğinde (abort), istekler `503 MODEL_BACKPRESSURE` ile güvenli şekilde sonlandırılır.
- **Gelişmiş Hata Yönetimi ve Payload Koruması:** Tüm JSON gövdeleri 1MB limit ile korunur (Aşımında `413 Payload Too Large` döner). Hatalar standart bir JSON şeması ile, Request ID izlenebilirliği (traceability) eşliğinde loglanır ve iletilir.
- **Stale Job Recovery & Otomatik Temizlik:** Sunucu yeniden başladığında asılı kalan (stale) index kilitleri otomatik temizlenir. Yeni bir re-index başarıyla tamamlandığında, Chroma üzerinde yer kaplayan eski fiziksel koleksiyonlar `cleanup.retentionMs` süresi dolunca arka planda temizlenir.
- **Dürüst Operasyonel Limitler:** Request rate limiter [src/http/rateLimit.ts](src/http/rateLimit.ts) içinde merkezi middleware olarak çalışır ve anahtarı `tenantId`, `userId`, `collectionId` ve operation (`query`, `retrieve`, `reindex`) alanlarından üretir. Model backpressure limitleri (`maxConcurrentEmbeddings`, `maxConcurrentGenerations`) ve 1MB JSON body limiti ayrı koruma katmanlarıdır.

## Nerede Ne Var?

- [README.md](README.md): hızlı kurulum, çalıştırma ve kısa kullanım özeti
- [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md): mimari kararlar, endpoint kontratları ve akışlar
- [config/rag.config.yaml](config/rag.config.yaml): aktif runtime ayarları (limitler, default değerler vb.)
- [data/registry.sqlite](data/registry.sqlite): logical collection ve job durumu registry'si
- [test_frontend/index.html](test_frontend/index.html): browser tabanlı manuel test arayüzü
- [src/app.ts](src/app.ts): HTTP API kompozisyonu, readiness ve router bağlama katmanı
- [src/server.ts](src/server.ts): runtime bootstrap, registry/job runner wiring ve startup cleanup
- [src/rag.ts](src/rag.ts): retrieval + generation orkestrasyonu ve backpressure yönetimi
- [src/indexing/jobs.ts](src/indexing/jobs.ts): Arka plan re-index job yönetimi

## Hızlı Kullanım Kılavuzu
0. **Kurulum** (sadece ilk kez): 'docker + install + run dev' -> backend kur
1. **Onboarding** (sadece ilk kez): `npm run onboard` → config oluşturur
2. **Collection oluştur**: `POST /v1/admin/collections` → collection ID al
3. **İndekslemeyi başlat**: `POST /v1/admin/collections/{id}/reindex` → job ID al
4. **Job durumunu takip et**: `GET /v1/admin/jobs/{id}` → `succeeded` olana kadar bekle
5. **Frontend'i aç**: `http://localhost:3010/test-frontend/` → collection artık görünür


## Kurulum

Windows PowerShell:

```powershell
cd "C:\Codes\Vanilla Rag Backend"
docker compose up -d chroma
npm.cmd install
ollama pull gemma3:4b-cloud
ollama pull bge-m3
npm.cmd run dev
```
## On boarding

```powershell
# **Onboarding** (sadece ilk kez):
npm.cmd run onboard
```

## Kolleksiyon oluşturma
```powershell
# 1. Collection oluştur
$collection = @{
  displayName = "Veri Klasörü"
  sourcePath = "C:\Codes\Vanilla Rag Backend\data"
  ozelgeDataPath = "data/ozelge_veri.json"
  distanceMetric = "l2"
  chunkSize = 500
  chunkOverlap = 200
  retrievalK = 5
  retrievalDistanceThreshold = 1.2
  embeddingModel = "bge-m3"
  chatModel = "gemma3:4b-cloud"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri http://localhost:3010/v1/admin/collections -Method Post -ContentType "application/json; charset=utf-8" -Body $collection
$collectionId = $response.collection.id
Write-Host "✅ Collection oluşturuldu: $collectionId" -ForegroundColor Green

# 2. İndeksleme job'ını başlat
$jobRes = Invoke-RestMethod -Uri "http://localhost:3010/v1/admin/collections/$collectionId/reindex" -Method Post -ContentType "application/json; charset=utf-8"
$jobId = $jobRes.job.id
Write-Host "✅ İndeksleme job'ı başlatıldı: $jobId" -ForegroundColor Green

# 3. Job bitene kadar bekle ve durumu göster
Write-Host "`n⏳ İndeksleme bekleniyor..." -ForegroundColor Yellow
do {
  Start-Sleep -Seconds 5
  $jobStatus = Invoke-RestMethod -Uri "http://localhost:3010/v1/admin/jobs/$jobId"
  $status = $jobStatus.job.status
  Write-Host "   Durum: $status" -ForegroundColor Cyan
} while ($status -ne "succeeded" -and $status -ne "failed")

# 4. Sonucu göster
if ($status -eq "succeeded") {
  Write-Host "`n✅ İndeksleme tamamlandı! Frontend'de collection görünür." -ForegroundColor Green
  Write-Host "   Collection ID: $collectionId" -ForegroundColor Cyan
  Write-Host "   Frontend: http://localhost:3010/test-frontend/" -ForegroundColor Cyan
} else {
  Write-Host "`n❌ İndeksleme başarısız: $($jobStatus.job.error)" -ForegroundColor Red
}
```

## Test arayüzünü açmak için tarayıcınızda şu adrese gidin:
```text
http://localhost:3010/test-frontend/
```

Bu test arayüzü üzerinden sistemdeki koleksiyonların listesini görebilir, durumlarını anlık denetleyebilir (Readiness) ve seçtiğiniz koleksiyona soru sorabilirsiniz. Eğer henüz hiç koleksiyon yaratmadıysanız liste boş gelecektir. Sistem, veritabanı (SQLite) tabanlı bir yaşam döngüsü sunar.

## Backend Yönetimi ve Admin Workflow

Sistemin RAG sorgularına yanıt verebilmesi için önce bir koleksiyonun yaratılması ve arka planda endekslenmesi gerekir. Tüm bu adımlar Admin API üzerinden yürütülür.

### Sistem Onboarding (İlk Kurulum)

Sistemi ilk kez ayağa kaldırırken `config/rag.config.yaml` dosyasını terminal üzerinden interaktif bir şekilde oluşturup doğrulamak için onboarding CLI aracı mevcuttur:

```powershell
npm.cmd run onboard
```

Bu komut:
1. İhtiyacınız olan Ollama/Chroma bağlantılarını, model isimlerini (örn. `gemma3:4b-cloud`) ve varsayılan limitleri sorar.
2. Servis sağlık kontrollerini (Health Check) ve veri yolu kontrollerini yapar.
3. Sonuçları `config/rag.config.yaml` dosyasına yazar.

Hızlı bir şekilde mevcut config ile devam etmek için (etkileşimli soruları atlayarak):
```powershell
npm.cmd run onboard -- --yes
```

> **Not:** Eski sürümde onboarding aracı direkt olarak Chroma indekslemeyi de başlatıyordu. Multi-collection yapısına geçilmesiyle birlikte, onboarding aracı **yalnızca sistem konfigürasyonunu (config) hazırlar**. Endeksleme adımı ayrı bir komuta (`npm run index`) veya API çağrısına devredilmiştir.

### Operasyonel Config Yüzeyi

`config/rag.config.yaml` içinde aşağıdaki operasyonel alanlar görünür ve onboarding CLI tarafından korunur:

```yaml
cleanup:
  retentionMs: 3600000
limits:
  maxConcurrentEmbeddings: 5
  maxConcurrentGenerations: 2
rateLimit:
  enabled: true
  windowMs: 60000
  maxRequestsPerWindow: 60
observability:
  includeDebugTimings: false
```

- `cleanup.retentionMs`: Eski fiziksel Chroma koleksiyonlarının emekliye ayrıldıktan sonra ne kadar süre tutulacağını belirler.
- `limits.maxConcurrentEmbeddings`: Embedding istekleri için model backpressure sınırı.
- `limits.maxConcurrentGenerations`: Chat generation istekleri için model backpressure sınırı.
- `rateLimit.enabled`: Query, retrieve ve reindex istekleri için merkezi request rate limiter'ı açar/kapatır.
- `rateLimit.windowMs` ve `rateLimit.maxRequestsPerWindow`: Her `tenantId:userId:collectionId:operation` anahtarı için fixed-window request limitini belirler. Limit aşılırsa API `429 RATE_LIMIT_EXCEEDED` döndürür.
- `observability.includeDebugTimings`: `false` iken query/retrieve response shape'i sade kalır. `true` iken response'a `debug.latency` eklenir; retrieve için `retrievalMs,totalMs`, query için `retrievalMs,generationMs,totalMs` döner.
- Rebuild başarıyla bittiğinde eski aktif fiziksel koleksiyon hemen silinmez; önce registry içinde `delete_pending` durumuna alınır ve `delete_after = now + cleanup.retentionMs` olarak işaretlenir.
- Sunucu açılışında bir kez stale job recovery ve due cleanup çalışır. Bu tarama `delete_pending` ve `cleanup_failed` kayıtları arasından süresi dolmuş fiziksel koleksiyonları yeniden denemeye uygundur.

Retention cleanup state contract:

- `delete_pending`: A previously active physical collection was replaced by a successful pointer swap and can be deleted after `delete_after`.
- `cleanup_failed`: A due delete failed. The record keeps `cleanup_error` and is retried when still due.
- `deleted`: The physical collection delete succeeded, or storage reported an idempotent not-found delete. `deleted_at` is set and `cleanup_error` is cleared.
- `failed_build`: A build target failed before pointer swap. It is not treated as an old active collection and is not selected by retention cleanup.
- Startup maintenance is scheduled after `listen`; it is fire-and-forget, logs failures, and does not block server startup. `startServer()` returns `startupMaintenancePromise`, which tests or embedded callers can await before closing the registry during controlled shutdown.

Structured operational logs share the same event shape across HTTP, RAG, indexing build/job runner and cleanup flows: `requestId`, `tenantId`, `userId`, `collectionId`, `physicalCollection`, `jobId`, `operation`, `status`, `latencyMs` and `errorCode`. Tests inject a fake log sink; production defaults to JSON lines on stdout.

### 1. Collection Yaratma (Admin API)
Koleksiyonun mantıksal (logical) konfigürasyonunu tanımlayın. Burada belirlediğiniz mesafe metriği (distanceMetric), embedding modeli, chat modeli, retrieval eşiği ve parçalama boyutları o koleksiyonun build/query akışında gerçekten kullanılır:

```powershell
$collection = @{
  displayName = "IK Belgeleri"
  sourcePath = "data"
  ozelgeDataPath = "data/ozelge_veri.json"
  distanceMetric = "cosine"
  chunkSize = 500
  chunkOverlap = 200
  retrievalK = 5
  retrievalDistanceThreshold = 1
  embeddingModel = "bge-m3"
  chatModel = "gemma3:4b-cloud"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri http://localhost:3010/v1/admin/collections -Method Post -ContentType "application/json; charset=utf-8" -Body $collection
$collectionId = $response.collection.id
Write-Host "Created collection: $collectionId"
```

Bu `collectionId`, kullanıcıya açık ve tenant-scoped bir public kimliktir; Chroma içindeki gerçek fiziksel collection adı değildir. Lokal geliştirmede farklı tenant görünürlüğünü denemek için `x-tenant-id` header'ı kullanılabilir.

### 2. Re-Index / Job Başlatma
Tanımladığınız koleksiyon için verileri Chroma'ya aktaracak (ve versiyonlu physical collection üretecek) arka plan index görevini HTTP API ile başlatın:

```powershell
$jobRes = Invoke-RestMethod -Uri "http://localhost:3010/v1/admin/collections/$collectionId/reindex" -Method Post -ContentType "application/json; charset=utf-8"
$jobId = $jobRes.job.id
Write-Host "Started Job: $jobId"
```

Aynı anda aynı koleksiyon için ikinci bir index görevi başlatmaya çalışırsanız sistem `409 COLLECTION_INDEX_ALREADY_RUNNING` hatası ile bunu güvenli bir şekilde engeller.

Başarılı bir rebuild sonrasında registry aktif pointer'ı atomik olarak yeni fiziksel collection'a çevrilir. Önceki aktif fiziksel collection ise hemen silinmez; `delete_pending` durumuna alınır ve due cleanup aşamasına bırakılır.

**Alternatif (CLI ile İndeksleme):**
HTTP API yerine doğrudan komut satırı üzerinden (sunucu çalışırken veya çalışmazken) indeksleme tetiklemek için `npm run index` aracını kullanabilirsiniz. Mantıksal koleksiyonun ID'sini vermeniz zorunludur:

```powershell
npm.cmd run index -- --collection-id $collectionId
```

### 3. Job Durumunu Görüntüleme
Başlatılan görevin durumunu (`queued`, `running`, `succeeded`, `failed`) API üzerinden takip edebilirsiniz:

```powershell
Invoke-RestMethod -Uri "http://localhost:3010/v1/admin/jobs/$jobId"
```

## RAG Kullanımı (Frontend / API)

Koleksiyon durumu `ready` (yani endeksleme başarılı) olduğunda artık RAG sorguları atabilirsiniz.

Sistemdeki tüm görünür koleksiyonları listelemek için:
```powershell
Invoke-RestMethod -Uri http://localhost:3010/v1/rag/collections
```

Not: Collection list item shape sabittir; henuz aktif index yoksa `activeVersion` ve `chunkCount` alanlari `null` doner.

Bu endpoint yalnızca request tenant'ının görebildiği logical collection kayıtlarını döndürür. Geliştirme ortamında tenant kapsamını denemek isterseniz `x-tenant-id` header'ı gönderebilirsiniz.

Collection listesi bilinçli olarak sadece ucuz registry discovery kontratıdır; Chroma veya Ollama readiness probe çalıştırmaz ve `capabilities.query/retrieve` iddiası taşımaz. Her item en az `status`, `activeVersion`, `chunkCount`, `updatedAt`, `readyUrl`, `queryUrl` ve `retrieveUrl` alanlarıyla gelir. Gerçek query/retrieve uygunluğu için listedeki `readyUrl` (`GET /v1/rag/collections/:collectionId/ready`) çağrılmalıdır.

Spesifik bir koleksiyonun Chroma üzerindeki fiziksel karşılığının erişilebilir (readable) olup olmadığını, doküman sayısını ve hazırlık durumunu doğrulamak için:
```powershell
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/ready"
```

Bu readiness cevabı artık yalnızca `hasActivePhysicalCollection` ve `chromaCount` bilgilerini değil, seçili koleksiyonun `embeddingModel` ve `chatModel` değerlerinin Ollama tarafında gerçekten bulunup bulunmadığını da `modelAvailability` alanı altında raporlar. `capabilities.query` ancak aktif fiziksel collection okunabiliyor ve koleksiyonun chat+embedding modelleri mevcutsa `true` olur.

## Health ve Readiness

- `GET /v1/rag/collections`: Cheap registry-only collection discovery. It does not run Chroma/Ollama readiness probes and does not return query/retrieve capability flags. Use each item's `readyUrl` for collection-level capability checks before enabling query/retrieve.
- `GET /health`: Sadece proses liveness durumunu döndürür.
- `GET /ready`: Varsayılan summary contract döndürür. En az `status`, `ready`, `systemReadyFor`, `queryReady`, `indexReady`, `blockerCodes`, `warningCodes`, `dependencies.{registry,chroma,ollama}.ok` ve `diagnostics` alanlarını içerir.
- `GET /ready?details=true`: Ayrıntılı readiness payload'unu (`checks`, `blockers`, `warnings`, `dependencies`, `dataSource`) döndürür.
- `GET /ready?strict=true`: Sistem hazır değilse HTTP `503` döndürür.

Bu endpoint collection'dan bağımsızdır; boş bir registry veya henüz default collection olmaması tek başına `/ready` başarısızlığı sayılmaz. Collection bazlı erişilebilirlik için `GET /v1/rag/collections/:collectionId/ready` kullanılmalıdır.

### RAG Sorguları: Retrieve ve Query

```powershell
$body = @{ question = "Turizm amacli kiralama izin belgesi alinmis konutun kiraya verilmesi nasil vergilendirilir?" } | ConvertTo-Json

# Yalnızca ilgili dokümanları (kaynakları) getirme
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/retrieve" -Method Post -ContentType "application/json; charset=utf-8" -Body $body

# Retrieve edilen kaynaklar üzerinden Ollama LLM'i ile nihai cevabı üretme
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/query" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
```

`retrieve` akışında koleksiyonun kendi `embeddingModel` ve `retrievalDistanceThreshold` ayarları, `query` akışında ise bunlara ek olarak koleksiyonun `chatModel` ayarı kullanılır. Global config bu alanlar için fallback/default görevi görür; logical collection kaydı varsa asıl source of truth registry'dir.

## Veri Kaynakları ve Ingestion (İndeksleme Altyapısı)

Koleksiyon yaratırken belirttiğiniz `sourcePath` (veya `ozelgeDataPath`) değerleri üzerinden indeksleme yapılır. Bu yollar yerel diskteki dosya veya klasörlere işaret edebilir.

İndeksleme sırasında desteklenen dosya tipleri:
- `.txt` ve `.md`: LangChain `TextLoader`
- `.pdf`: LangChain `PDFLoader`
- `.doc` / `.docx`: LangChain `DocxLoader`
- Özel JSON Modeli: Sadece `ozelgeDataPath` ile işaretlenen ve projeye özgü özel formatlanmış (özelge) JSON dosyası desteklenir.

İndekslenen her veri parçası (chunk) şu standart metadataları taşır:
- `documentId`, `sourcePath`, `sourceType`, `chunkIndex`
- Çoklu koleksiyon yapısı gereği eklenen: `collectionId`, `collectionVersion`, `physicalCollection`

Veri tabanı indeksleme örneklemini kısıtlamak için `config/rag.config.yaml` içinde yer alan `collectionDefaults.indexSampleSize` değeri kullanılabilir. Değer `0` ise hedef dizindeki tüm veriler endekslenir.

## Response ve Hata Semantigi

`POST /v1/rag/collections/:id/retrieve` basarili oldugunda su alanlari dondurur:

- `question`
- `k`
- `distanceScoreThreshold`
- `sourceCount`
- `sources[]` (`documentId`, `sourcePath`, `sourceType`, `chunkIndex`, `distanceScore` dahil)
- `collectionId`
- `collectionDisplayName`
- `activeVersion`

`POST /v1/rag/collections/:id/query` basarili oldugunda su alanlari dondurur:

- `answer`
- `distanceScoreThreshold`
- `sources[]` (`documentId`, `sourcePath`, `sourceType`, `chunkIndex`, `distanceScore` dahil)
- `collectionId`
- `collectionDisplayName`
- `activeVersion`

Bu backend bilincli olarak kullaniciya placeholder veya fallback answer dondurmez. Query/retrieve akislarinda baglam yetersizse, boyut limitleri aşılırsa veya model backpressure yaşanırsa standartlaştırılmış JSON hatası döndürülür.

### Başlıca Hata Kodları:

- `INVALID_REQUEST_BODY` (`400` / `413`): Gönderilen JSON geçersiz veya 1MB payload limitini aşıyor.
- `COLLECTION_FORBIDDEN` (`403`): Koleksiyon ID'si var ama başka tenant kapsamına ait olduğu için erişim reddedildi.
- `COLLECTION_NOT_FOUND` (`404`): Koleksiyon ID'si registry'de bulunamadı.
- `COLLECTION_NOT_READY` (`404`): Koleksiyon var ama henüz başarılı bir endekse (aktif fiziksel pointer'a) sahip değil.
- `COLLECTION_INDEXING` (`503`): Koleksiyon şu anda sıfırdan ilk kez endeksleniyor. (Daha önce başarıyla bitmiş bir index olsaydı, `zero-downtime` prensibi gereği sorgular eski indeksten dönmeye devam ederdi).
- `COLLECTION_INDEX_ALREADY_RUNNING` (`409`): Aynı koleksiyon için eşzamanlı çalıştırılmaya çalışılan çakışan job uyarısı.
- `RATE_LIMIT_EXCEEDED` (`429`): Aynı tenant/user/collection/operation anahtarı için `rateLimit.maxRequestsPerWindow` aşıldı.
- `NO_RELEVANT_CONTEXT` (`422`): `retrievalDistanceThreshold` altinda ilgili (yakın) hiçbir kaynak doküman bulunamadı.
- `ANSWER_NOT_IN_RETRIEVED_CONTEXT` (`422`): Retrieval ile kaynaklar bulundu ama LLM, bu kaynaklardan (grounded) kesin bir cevap uretemedi.
- `MODEL_BACKPRESSURE` (`503`): Sistem eşzamanlı limitleri (`maxConcurrentEmbeddings` / `maxConcurrentGenerations`) aştı, vector search/generation zaman aşımına uğradı veya client tarafından iptal (abort) edildi.
- `EMPTY_MODEL_RESPONSE` (`502`): Chat modeli boş cevap döndü.
- `DISALLOWED_FALLBACK_ANSWER` (`502`): Model yasakli fallback (ezbere) metni döndü; backend bunu bir RAG ihlali/hatası sayar.
