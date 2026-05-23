# Vanilla RAG Backend

Minimal TypeScript Express backend for a traditional LangChain RAG flow over documents in `data/`.

Bu repo agentic akış değil, basit bir Vanilla RAG backend uygular.

Detaylı mimari ve endpoint sözleşmeleri için [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md) dosyasına bak.

## Nerede Ne Var?

- [README.md](README.md): hızlı kurulum, çalıştırma ve kısa kullanım özeti
- [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md): mimari kararlar, endpoint kontratları ve akışlar
- [config/rag.config.yaml](config/rag.config.yaml): aktif runtime ayarları
- [test_frontend/index.html](test_frontend/index.html): browser tabanlı manuel test arayüzü
- [src/server.ts](src/server.ts): HTTP API katmanı
- [src/rag.ts](src/rag.ts): retrieval + generation orkestrasyonu
- [src/index.ts](src/index.ts): indexing akışı

## Hızlı Başlangıç

Windows PowerShell:

```powershell
cd "C:\Codes\Vanilla Rag Backend"
docker compose up -d chroma
npm.cmd install
ollama pull gemma3:4b-cloud
ollama pull bge-m3
npm.cmd run index
npm.cmd run dev
```

Backend ayağa kalkınca şu adresi aç:

```text
http://localhost:3010/test-frontend/
```

Bu test arayüzü, endpointleri elle denemek için önerilen yoldur.

`GET /ready` için kısa, detaylı ve strict varyant butonları da bu arayüzde hazırdır.

## Veri Kaynakları ve Ingestion

Indexleme varsayılan olarak [config/rag.config.yaml](config/rag.config.yaml) içindeki `data.sourcePath`
değerinden yapılır. Bu değer tek bir dosyaya veya bir klasöre işaret edebilir.

Varsayılan config:

```yaml
data:
  sourcePath: data
  ozelgeDataPath: data/ozelge_veri.json
  indexSampleSize: 0
```

`sourcePath` klasörse, ilk sürümde sadece o klasörün içindeki dosyalar okunur; alt klasörler recursive taranmaz.
Desteklenmeyen dosya uzantıları indexlemeyi durdurmaz, atlanır.

Desteklenen kaynaklar:

- `.txt` ve `.md`: LangChain `TextLoader`
- `.pdf`: LangChain `PDFLoader`
- `.doc`: LangChain `DocxLoader` (`type: "doc"`)
- `.docx`: LangChain `DocxLoader` (`type: "docx"`)
- `data.ozelgeDataPath` ile işaretlenen JSON: mevcut özelge adapter'ı

Not: v1'de `.json` desteği genel JSON mapping anlamına gelmez. Sadece `data.ozelgeDataPath`
olarak tanımlanan özelge JSON dosyası desteklenir.

`data.indexSampleSize`, özelge JSON adapter'ı için kayıt örnekleme limitidir. `0` değeri limit yok
anlamına gelir ve parse edilen tüm kayıtlar indexlenir. Dosya tabanlı `.txt`, `.md`, `.pdf`, `.doc`
ve `.docx` kaynaklar bu limit yüzünden düşürülmez.

Indexlenen her chunk şu ortak metadata alanlarını taşır:

- `documentId`
- `sourcePath`
- `sourceType`
- `chunkIndex`

Özelge JSON kaynakları ayrıca `ozelgeId`, `sayi`, `tarih` ve `konu` alanlarını da korur.

## Test Etme

`test_frontend`, backend endpointlerini browser üzerinden hızlıca denemek için hazırlanmış izole bir test arayüzüdür.

Buradan şunları test edebilirsin:

- `GET /`
- `GET /health`
- `GET /ready`
- `GET /ready?details=true`
- `GET /ready?strict=true`
- `GET /ready?details=true&strict=true`
- `POST /rag/retrieve`
- `POST /rag/query`

Adres:

```text
http://localhost:3010/test-frontend/
```

CLI ile test etmek istersen kısa örnekler:

```powershell
Invoke-RestMethod -Uri http://localhost:3010/health
Invoke-RestMethod -Uri http://localhost:3010/ready
```

```powershell
$body = @{ question = "Turizm amacli kiralama izin belgesi alinmis konutun kiraya verilmesi nasil vergilendirilir?" } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:3010/rag/retrieve -Method Post -ContentType "application/json; charset=utf-8" -Body $body
Invoke-RestMethod -Uri http://localhost:3010/rag/query -Method Post -ContentType "application/json; charset=utf-8" -Body $body
```

## Endpoint Özeti

- `GET /`: Servis bootstrap ve endpoint keşif özeti
- `GET /health`: Liveness kontrolü
- `GET /ready`: Readiness özeti
- `GET /ready?details=true`: Detaylı readiness çıktısı
- `GET /ready?strict=true`: Readiness sonucunu HTTP status koduna da yansıtır
- `GET /ready?details=true&strict=true`: Detaylı readiness + strict HTTP status
- `POST /rag/retrieve`: Sadece retrieval sonucu. `distanceScore` daha kucuk oldugunda chunk sorguya daha yakindir. Uygun chunk kalmazsa `422 NO_RELEVANT_CONTEXT` doner.
- `POST /rag/query`: Retrieval + generation. Backend fake fallback answer donmez; grounded cevap yoksa structured hata doner.

## Response ve Hata Semantigi

`POST /rag/retrieve` basarili oldugunda su alanlari dondurur:

- `question`
- `k`
- `distanceScoreThreshold`
- `sourceCount`
- `sources[]` (`documentId`, `sourcePath`, `sourceType`, `chunkIndex`, `distanceScore` dahil)

`POST /rag/query` basarili oldugunda su alanlari dondurur:

- `answer`
- `distanceScoreThreshold`
- `sources[]` (`documentId`, `sourcePath`, `sourceType`, `chunkIndex`, `distanceScore` dahil)

Bu backend bilincli olarak kullaniciya placeholder veya fallback answer dondurmez. Query/retrieve akislarinda baglam yetersizse veya model kontrati bozulursa JSON hata dondurulur.

Onemli ayrim:

- `POST /rag/retrieve` chunk bulmus olabilir.
- Buna ragmen `POST /rag/query`, sorunun istedigi somut bilgiyi bu chunk'larda grounded olarak bulamazsa `422 ANSWER_NOT_IN_RETRIEVED_CONTEXT` donebilir.
- Bu durumda sorun retrieval'in tamamen bos donmesi degil, bulunan chunk'larin soruyu kanitlamaya yetmemesidir.

Baslica hata kodlari:

- `NO_RELEVANT_CONTEXT` (`422`): `retrievalDistanceThreshold` altinda hic chunk kalmadi.
- `ANSWER_NOT_IN_RETRIEVED_CONTEXT` (`422`): Retrieval kaynaklari bulundu ama model, bu kaynaklardan grounded cevap uretemedi. Hata detayinda `retrievedSources` ozeti de bulunur.
- `EMPTY_MODEL_RESPONSE` (`502`): Chat model bos cevap dondu.
- `DISALLOWED_FALLBACK_ANSWER` (`502`): Model yasakli fallback metni dondu; backend bunu hata sayar.

## Günlük Kullanım

- Chroma kapalıysa: `docker compose up -d chroma`
- Backend geliştirme modu: `npm.cmd run dev`
- Index yeniden oluşturma: `npm.cmd run index`

Şu alanlar değişirse index'i yeniden oluştur:

- `data.sourcePath`
- `data.ozelgeDataPath`
- `data.indexSampleSize`
- `rag.chunkSize`
- `rag.chunkOverlap`
- `chroma.collection`
- `chroma.distanceMetric`
- embedding modeli

Şu alanlar değişirse backend'i yeniden başlatman yeterlidir:

- `ollama.chatModel`
- `ollama.numCtx`
- `ollama.numPredict`
- `rag.retrievalK`
- `rag.retrievalDistanceThreshold`
- `rag.timeoutMs`

Not: `chroma.distanceMetric` mevcut koleksiyona geriye donuk uygulanmaz. Bu alan degisirse koleksiyonu yeniden olusturup `npm.cmd run index` calistirmak gerekir.

## ChromaDB Verisi

Docker Compose ile calisan ChromaDB verisini repo kokundeki `chroma_data/` klasorunde tutar.
Bu klasor `.gitignore` icindedir; indexlenmis vector store Git'e eklenmez.

`docker compose stop` ve `docker compose start` veriyi korur. Container yeniden olusturulsa bile
`chroma_data/` silinmedigi surece indexlenmis veri korunur.

Index verisini tamamen sifirlamak istersen once Chroma'yi durdur, sonra `chroma_data/`
klasorunu sil ve tekrar `npm.cmd run index` calistir.

## İlk Kurulum Notları

- Config dosyası: [config/rag.config.yaml](config/rag.config.yaml)
- Chroma adresi varsayılan: `http://localhost:8000`
- Ollama adresi varsayılan: `http://localhost:11434`
- Varsayılan chat modeli: `gemma3:4b-cloud`
- Varsayılan embedding modeli: `bge-m3`
- Varsayılan indexing kaynağı: `data/`

`ollama.chatModel` değişirse backend'i yeniden başlat. Embedding modeli veya chunk/index ayarları değişirse `npm.cmd run index` tekrar çalıştır.

## Takılırsa

- Önce `GET /health` ve `GET /ready` kontrol et
- Endpoint testi için öncelikle `test_frontend` kullan
- Server loglarını backend terminalinden izle

Generation tarafında bekleme veya hata olursa önce şu alanları düşür:

- `ollama.numCtx`
- `ollama.numPredict`
- `rag.retrievalK`
