# Vanilla RAG Backend

Minimal TypeScript Express backend for a traditional LangChain RAG flow over documents in `data/`.

Bu repo, agentic bir akış yerine sağlam, operasyonel olarak güvenli ve çoklu koleksiyon (multi-collection) destekleyen basit bir Vanilla RAG backend uygular. Temel odak noktası **sıfır kesinti (zero-downtime) ile endeksleme**, **backpressure yönetimi** ve **güvenli durum (state) yönetimidir**.

Detaylı mimari ve endpoint sözleşmeleri için [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md) dosyasına bakabilirsiniz.

## Öne Çıkan Özellikler

- **Çoklu Koleksiyon (Multi-Collection) Desteği:** Tek bir backend üzerinden farklı yapılandırmalara (farklı embedding modeli, distance metric, chunk size vb.) sahip birden fazla mantıksal (logical) RAG koleksiyonu yönetebilirsiniz.
- **Sıfır Kesinti ile Endeksleme (Zero-Downtime Rebuild):** Endeksleme işlemleri arka planda her seferinde yeni bir "versiyonlu fiziksel Chroma koleksiyonuna" yazılır. İşlem başarıyla bittiğinde aktif yönlendirici (pointer) atomik olarak değiştirilir. Böylece sorgu (query) işlemleri endeksleme süresince eski veriden kesintisiz hizmet almaya devam eder.
- **Model Backpressure & Concurrency Koruması:** Eşzamanlı istek yığılmalarına karşı Ollama ve Chroma etkileşimlerinde asenkron kilitler (semaphore) kullanılır (`maxConcurrentEmbeddings`, `maxConcurrentGenerations`). Sistem kapasitesi aşıldığında veya client bağlantıyı kestiğinde (abort), istekler `503 MODEL_BACKPRESSURE` ile güvenli şekilde sonlandırılır.
- **Gelişmiş Hata Yönetimi ve Payload Koruması:** Tüm JSON gövdeleri 1MB limit ile korunur (Aşımında `413 Payload Too Large` döner). Hatalar standart bir JSON şeması ile, Request ID izlenebilirliği (traceability) eşliğinde loglanır ve iletilir.
- **Stale Job Recovery & Otomatik Temizlik:** Sunucu yeniden başladığında asılı kalan (stale) index kilitleri otomatik temizlenir. Yeni bir re-index başarıyla tamamlandığında, Chroma üzerinde yer kaplayan eski fiziksel koleksiyonlar arka planda (garbage collection) silinir.

## Nerede Ne Var?

- [README.md](README.md): hızlı kurulum, çalıştırma ve kısa kullanım özeti
- [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md): mimari kararlar, endpoint kontratları ve akışlar
- [config/rag.config.yaml](config/rag.config.yaml): aktif runtime ayarları (limitler, default değerler vb.)
- [data/registry.sqlite](data/registry.sqlite): logical collection ve job durumu registry'si
- [test_frontend/index.html](test_frontend/index.html): browser tabanlı manuel test arayüzü
- [src/server.ts](src/server.ts): HTTP API katmanı
- [src/rag.ts](src/rag.ts): retrieval + generation orkestrasyonu ve backpressure yönetimi
- [src/indexing/jobs.ts](src/indexing/jobs.ts): Arka plan re-index job yönetimi

## Hızlı Başlangıç

Windows PowerShell:

```powershell
cd "C:\Codes\Vanilla Rag Backend"
docker compose up -d chroma
npm.cmd install
ollama pull gemma3:4b-cloud
ollama pull bge-m3
npm.cmd run dev
```

Test arayüzünü açmak için tarayıcınızda şu adrese gidin:
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

### 1. Collection Yaratma (Admin API)
Koleksiyonun mantıksal (logical) konfigürasyonunu tanımlayın. Burada belirlediğiniz mesafe metriği (distanceMetric), parçalama boyutları (chunkSize) vb. o koleksiyon için sabittir:

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
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri http://localhost:3010/v1/admin/collections -Method Post -ContentType "application/json; charset=utf-8" -Body $collection
$collectionId = $response.collection.id
Write-Host "Created collection: $collectionId"
```

### 2. Re-Index / Job Başlatma
Tanımladığınız koleksiyon için verileri Chroma'ya aktaracak (ve versiyonlu physical collection üretecek) arka plan index görevini HTTP API ile başlatın:

```powershell
$jobRes = Invoke-RestMethod -Uri "http://localhost:3010/v1/admin/collections/$collectionId/reindex" -Method Post -ContentType "application/json; charset=utf-8"
$jobId = $jobRes.job.id
Write-Host "Started Job: $jobId"
```

Aynı anda aynı koleksiyon için ikinci bir index görevi başlatmaya çalışırsanız sistem `409 COLLECTION_INDEX_ALREADY_RUNNING` hatası ile bunu güvenli bir şekilde engeller.

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

Spesifik bir koleksiyonun Chroma üzerindeki fiziksel karşılığının erişilebilir (readable) olup olmadığını, doküman sayısını ve hazırlık durumunu doğrulamak için:
```powershell
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/ready"
```

### RAG Sorguları: Retrieve ve Query

```powershell
$body = @{ question = "Turizm amacli kiralama izin belgesi alinmis konutun kiraya verilmesi nasil vergilendirilir?" } | ConvertTo-Json

# Yalnızca ilgili dokümanları (kaynakları) getirme
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/retrieve" -Method Post -ContentType "application/json; charset=utf-8" -Body $body

# Retrieve edilen kaynaklar üzerinden Ollama LLM'i ile nihai cevabı üretme
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/query" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
```

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

Veri tabanı indeksleme örneklemini kısıtlamak için `config/rag.config.yaml` içinde yer alan `data.indexSampleSize` değeri kullanılabilir. Değer `0` ise hedef dizindeki tüm veriler endekslenir.

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
- `COLLECTION_NOT_FOUND` (`404`): Koleksiyon ID'si registry'de bulunamadı.
- `COLLECTION_NOT_READY` (`404`): Koleksiyon var ama henüz başarılı bir endekse (aktif fiziksel pointer'a) sahip değil.
- `COLLECTION_INDEXING` (`503`): Koleksiyon şu anda sıfırdan ilk kez endeksleniyor. (Daha önce başarıyla bitmiş bir index olsaydı, `zero-downtime` prensibi gereği sorgular eski indeksten dönmeye devam ederdi).
- `COLLECTION_INDEX_ALREADY_RUNNING` (`409`): Aynı koleksiyon için eşzamanlı çalıştırılmaya çalışılan çakışan job uyarısı.
- `NO_RELEVANT_CONTEXT` (`422`): `retrievalDistanceThreshold` altinda ilgili (yakın) hiçbir kaynak doküman bulunamadı.
- `ANSWER_NOT_IN_RETRIEVED_CONTEXT` (`422`): Retrieval ile kaynaklar bulundu ama LLM, bu kaynaklardan (grounded) kesin bir cevap uretemedi.
- `MODEL_BACKPRESSURE` (`503`): Sistem eşzamanlı limitleri (`maxConcurrentEmbeddings` / `maxConcurrentGenerations`) aştı, istek zaman aşımına uğradı veya client tarafından iptal (abort) edildi.
- `EMPTY_MODEL_RESPONSE` (`502`): Chat modeli boş cevap döndü.
- `DISALLOWED_FALLBACK_ANSWER` (`502`): Model yasakli fallback (ezbere) metni döndü; backend bunu bir RAG ihlali/hatası sayar.
