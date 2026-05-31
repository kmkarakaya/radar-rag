# Vanilla RAG Backend

Minimal TypeScript Express backend for a traditional LangChain RAG flow over documents in `data/`.

Bu repo agentic akış değil, basit bir Vanilla RAG backend uygular. Multi-collection destekler, versiyonlu physical Chroma collection kullanır ve sorgu esnasında sıfır kesinti sağlamaya odaklanır.

Detaylı mimari ve endpoint sözleşmeleri için [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md) dosyasına bak.

## Nerede Ne Var?

- [README.md](README.md): hızlı kurulum, çalıştırma ve kısa kullanım özeti
- [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md): mimari kararlar, endpoint kontratları ve akışlar
- [config/rag.config.yaml](config/rag.config.yaml): aktif runtime ayarları
- [data/registry.sqlite](data/registry.sqlite): logical collection ve job durumu registry'si
- [test_frontend/index.html](test_frontend/index.html): browser tabanlı manuel test arayüzü
- [src/server.ts](src/server.ts): HTTP API katmanı
- [src/rag.ts](src/rag.ts): retrieval + generation orkestrasyonu
- [src/index.ts](src/index.ts): indexing CLI noktası

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

Test arayüzünü açmak için:
```text
http://localhost:3010/test-frontend/
```

Bu test arayüzü üzerinden collection listesini görebilir ve seçtiğin collection'a soru sorabilirsin. Eğer henüz hiç collection yaratmadıysan liste boş gelecektir. Backend `/v1` endpointleri registry-backed collection lifecycle sunar.

## Backend Yönetimi ve Admin Workflow

Uygulamanın çalışması için önce bir koleksiyonun yaratılması ve endekslenmesi gerekir. Bu komutların tümünü CLI veya test arayüzü olmadan PowerShell'den HTTP istekleri atarak yönetebilirsin.

### 1. Collection Yaratma (Admin API)
Koleksiyonun mantıksal (logical) konfigürasyonunu tanımla:

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

$response = Invoke-RestMethod -Uri http://localhost:3010/v1/admin/collections -Method Post -ContentType "application/json; charset=utf-8" -Body $collection
$collectionId = $response.collection.id
Write-Host "Created collection: $collectionId"
```

### 2. Re-Index / Job Başlatma
Tanımladığın koleksiyon için Chroma'ya verileri aktaracak arka plan index görevini başlat:

```powershell
$jobRes = Invoke-RestMethod -Uri "http://localhost:3010/v1/admin/collections/$collectionId/reindex" -Method Post -ContentType "application/json; charset=utf-8"
$jobId = $jobRes.job.id
Write-Host "Started Job: $jobId"
```

Alternatif olarak, komut satırı üzerinden index çalıştırmak için `collection-id` parametresi kullanabilirsin:
```powershell
npm.cmd run index -- --collection-id $collectionId
```

### 3. Job Durumunu Görüntüleme
Başlatılan görevin başarılı olup olmadığını API üzerinden takip edebilirsin:

```powershell
Invoke-RestMethod -Uri "http://localhost:3010/v1/admin/jobs/$jobId"
```

## RAG Kullanımı (Frontend / API)

Koleksiyon durumu `ready` olduğunda artık query ve retrieve istekleri atabilirsin.

Koleksiyonları listelemek için:
```powershell
Invoke-RestMethod -Uri http://localhost:3010/v1/rag/collections
```

Koleksiyonun aktif hedeflerinin hazır olup olmadığını doğrulamak için:
```powershell
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/ready"
```

### RAG Sorguları: Retrieve ve Query

```powershell
$body = @{ question = "Turizm amacli kiralama izin belgesi alinmis konutun kiraya verilmesi nasil vergilendirilir?" } | ConvertTo-Json

# Yalnızca dokümanları (kaynakları) getirme
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/retrieve" -Method Post -ContentType "application/json; charset=utf-8" -Body $body

# Retrieve edilen kaynaklar üzerinden Ollama LLM'i ile cevap üretme
Invoke-RestMethod -Uri "http://localhost:3010/v1/rag/collections/$collectionId/query" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
```

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

Bu backend bilincli olarak kullaniciya placeholder veya fallback answer dondurmez. Query/retrieve akislarinda baglam yetersizse veya model kontrati bozulursa JSON hata dondurulur.

Baslica hata kodlari:

- `COLLECTION_NOT_FOUND` (`404`): Koleksiyon ID'si bulunamadı.
- `COLLECTION_NOT_READY` (`404`): Koleksiyon var ama henüz başarılı bir endekse sahip değil.
- `COLLECTION_INDEXING` (`503`): Koleksiyon şu anda sıfırdan ilk kez endeksleniyor. (Daha önce başarıyla bitmiş bir index olsaydı, sorgular eski indeksten dönmeye devam ederdi).
- `COLLECTION_INDEX_ALREADY_RUNNING` (`409`): Aynı koleksiyon için eşzamanlı çalıştırılmaya çalışılan ikinci job uyarısı.
- `NO_RELEVANT_CONTEXT` (`422`): `retrievalDistanceThreshold` altinda hic chunk kalmadi.
- `ANSWER_NOT_IN_RETRIEVED_CONTEXT` (`422`): Retrieval kaynaklari bulundu ama model, bu kaynaklardan grounded cevap uretemedi.
- `EMPTY_MODEL_RESPONSE` (`502`): Chat model bos cevap dondu.
- `DISALLOWED_FALLBACK_ANSWER` (`502`): Model yasakli fallback metni dondu; backend bunu hata sayar.
