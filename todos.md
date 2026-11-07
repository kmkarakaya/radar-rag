# Repo Eksikleri ve TODO Listesi

Bu dosya, mevcut repoda halihazirda bulunan vanilla RAG backend'in ustune hangi eksiklerin kaldigini ve bunlarin hangi oncelikle ele alinmasi gerektigini toplar.

Mevcut durumda olanlar:
- TypeScript + Express tabanli bir backend var.
- LangChain kullanilarak Chroma uzerinde retrieval yapiliyor.
- Ollama ile generation calisiyor.
- Ayrik bir indexing akisi mevcut.
- `GET /health` ve `GET /ready` ile liveness / readiness yuzeyi mevcut.
- `POST /rag/retrieve` ile retrieval-only debug yuzeyi mevcut.
- `POST /rag/query` uzerinden retrieval + generation akisi calisiyor.

Bu nedenle ana gorevin cekirdegi tamamlanmis sayilabilir; ancak repo urunlesme, olcumleme ve dayaniklilik acisindan halen eksik.

## P0 - Dogrudan kapanmamis kritik eksikler

### 0. Ollama modelleri saglikli yakalanmiyor, isleme giriyor

Sorun:
- Collection olusturma (`POST /v1/admin/collections`) ve re-index tetikleme (`POST /v1/admin/collections/:id/reindex`) endpoint'leri Ollama'da gerekli modellerin (embedding ve chat) mevcut olup olmadigini kontrol etmiyor.
- Kullanici bir collection olusturup re-index tetiklediginde, backend modeli bulamazsa job'i `failed` olarak isaretle ve job ID dondurur.
- Kullaniciya model eksik oldugu konusunda **hemen** bir hata mesajı gosterilmiyor. Job'un fail olmasini beklemek ve `GET /v1/admin/jobs/:jobId` ile durumu kontrol etmek gerekiyor.
- Gercek senaryoda (21 Haz 2026): `bge-m3` embedding modeli ve `gemma3:4b-cloud` chat modeli Ollama'da yoktu. Collection basariyla olusturuldu, re-index job 'queued' → 'running' → 'failed' olarak tamamlandi. Hata mesaji: `model "bge-m3" not found, try pulling it first`. Bu bilgi job response'da `error` field'inda var ama endpoint response'unda acikca gosterilmiyor.
- `GET /ready` endpoint'i modellerin eksikligini raporu ediyor (blocker codes: `CHAT_MODEL_MISSING`, `EMBED_MODEL_MISSING`), ama bu bilgi collection olusturma veya re-index tetikleme sirasinda **call-site bazinda** kontrol edilmiyor.

Neden onemli:
- Kullanici deneyimi: Collection olusturma ve indexing basarili gibi gorunuyor ama arka planda sessizce fail oluyor.
- Operating cost: Basarisiz job'lar gereksiz kaynak harcamasi (Chroma islemleri, embedding calculation denemeleri).
- Debug maliyeti: Kullanici "neden collection calismiyor?" sorusunun cevabini bulmak icin `GET /v1/admin/jobs/:jobId` cagirip `error` field'ina bakmak zorunda.
- Production senaryosu: Docker deployment veya CI'da modeller otomatik pull edilmezse tum indexing pipelini basarisiz olur.

Kokenler:
- **Koken**: `POST /v1/admin/collections/:id/reindex` endpoint'i (`src/http/adminRouter.ts`) job baslatmadan once Ollama'da gerekli modelleri kontrol etmiyor.
- **Koken**: `startReindexJob()` fonksiyonu (`src/indexing/jobs.ts`) Chroma indexing sirasinda model bulunamazsa exception throw ediyor ama bu exception job'a `failed` olarak kaydediliyor ve kullaniciya acikca geri donduruilmiyor.
- **Koken**: `POST /v1/admin/collections` endpoint'i (`src/http/adminRouter.ts`) config'deki model isimlerini okuyor ama Ollama'ya bagli olarak kontrol etmiyor.
- **Koken**: `GET /ready` endpoint'i (`src/app.ts`) modellari kontrol ediyor ama bu bilgi collection job'lari tarafindan kullanilmiyor.

Cozumler:
1. **Collection olusturma sirasinda model kontrolu** (On-create validation):
   - `POST /v1/admin/collections` endpoint'inde config'deki `embeddingModel` ve `chatModel` degerleri alinir.
   - Basit bir health check callback'i (`/api/tags` via Ollama) ile modelin mevcut oldugu dogrulanir.
   - Eger model yoksa:
     - `422 UNAVAILABLE_MODEL` hatasi dondur.
     - Response'ta acikca yaz: `"message": "Embedding model 'bge-m3' not found in Ollama. Please run 'ollama pull bge-m3'."`
     - Response'ta hangi modellerin Ollama'da mevcut oldugunu da goster (`"availableModels": ["gemma3:4b-cloud", ...]`) ki kullanici dogru ismi girebilsin.
   - Bu kontrol config-level validation seviyesinde olmalidir: `ollama_embedding_model` ve `ollama_chat_model` config alanlari varsa (yani non-null), o anda cekilir ve dogrulanir.

2. **Re-index tetikleme sirasinda model kontrolu** (On-reindex validation):
   - `POST /v1/admin/collections/:id/reindex` endpoint'inde collection'daki `embeddingModel` ve `chatModel` degerleri alinir.
   - Ayni model kontrolu yapilir. Eger model yoksa `422 UNAVAILABLE_MODEL` dondur ve job baslatma.
   - Hata mesaji acik olmalidir: `"message": "Re-index cannot start. Embedding model 'bge-m3' is not available in Ollama."`

3. **Job fail mesajini gorsellestirme** (API response improving):
   - `GET /v1/admin/jobs/:jobId` response'unda `job.error` field'i zaten var ama UI (admin panel) bunu gostermiyor.
   - Admin panel `loadJobs()` ve `renderJobs()` fonksiyonlarinda `job.error` field'ini goster.
   - Ayrca `POST /v1/admin/collections/:id/reindex` response'unda eger job fail olmusta (overlapped jobs), o job'un `error` mesajini da response'a ekle.
   - Bir callback ile daha iyi hata mesaji vermek mumkun olurdu.

4. **Otomatik model pull veya async job** (Progressive improvement):
   - **Secenek A**: Eger model yoksa, job'u `queued` yerine `pending_model_pull` statuye koy ve Ollama'ya bagli olarak otomatik model pull denemesi baslat (bir future tasks'da).
   - **Secenek B**: Job'u async olarak baslat ama `embeddingModel` veya `chatModel` eksikse job baslamadan `cancelled` olarak isaretle ve acik bir hata mesaji goster.

5. **Readiness endpoint'ini daha guclu hale getir** (Detect the missing model early):
   - `GET /ready` response'unda `blockers` array'inde su model eksik oldugunu acikca yaz: `"blockers": [{ "code": "CHAT_MODEL_MISSING", "message": "Chat model 'gemma3:4b-cloud' is missing in Ollama..." }, ...]`
   - Zaten bu yapiliyor ama admin panelde gosterilmiyor.

Veri akisi:
- `config/rag.config.yaml`: `embeddingModel: "bge-m3"`, `chatModel: "gemma3:4b-cloud"`
- `POST /v1/admin/collections`: Kullanici collection olusturur, config'deki model isimleri kullanilir.
- `POST /v1/admin/collections/:id/reindex`: Re-index tetiklenir, collection'daki model isimleri kullanilir.
- `GET /v1/admin/jobs/:jobId`: Job durumu kontrol edilir, eger fail ise `error` field'inda hata mesaji olur.
- `GET /ready`: System readiness kontrol edilir, model eksikligi `blockers` array'inde gosterilir.

Kabul kriterleri:
- [x] `POST /v1/admin/collections` endpoint'inde config'deki `embeddingModel` ve `chatModel` degerleri alinir ve Ollama'ya bagli olarak kontrol edilir. Eger model yoksa `422 UNAVAILABLE_MODEL` hatasi dondur ve response'ta acikca yaz. (`src/http/modelAvailability.ts`; Ollama'ya ulasilamazsa `503 OLLAMA_UNREACHABLE`.)
- [x] `POST /v1/admin/collections/:id/reindex` endpoint'inde collection'daki `embeddingModel` Ollama'ya bagli olarak kontrol edilir. Eger model yoksa `422 UNAVAILABLE_MODEL` hatasi dondur ve job baslatma. Karar: reindex `chatModel` istemez (indexing sadece embedding kullanir, `/retrieve` chat modelsiz calisir); aktif job varsa once `409` doner.
- [x] `GET /v1/admin/jobs/:jobId` response'unda `job.error` field'i UI tarafindan gosterilir. (Zaten yapiliyordu.)
- [x] Admin panel `loadJobs()` ve `renderJobs()` fonksiyonlarinda `job.error` field'ini goster. (Zaten yapiliyordu: `admin/admin.js` `renderJobs()` Error kolonu.)
- [x] `GET /ready` response'unda model eksikligi `blockers` array'inde gosterilir. (Zaten bu yapiliyor.)
- [ ] `POST /v1/admin/collections/:id/reindex` response'unda eger job fail olmusta (overlapped jobs), o job'un `error` mesajini da response'a ekle. (Belirsiz: `failed` job aktif sayilmadigi icin overlap olusturmaz. `409` artik `details.jobId` / `details.status` donuyor. Netlestirilmeli.)

### 1. Benchmark verisi var, benchmark kosusu yok

Sorun:
- `benchmark/benchmark.json` ve `benchmark/benchmark.schema.json` repoda duruyor.
- Buna ragmen `src/` altinda bu benchmark verisini kullanan herhangi bir evaluation script'i yok.
- Yani sistemin "dogru cevap veriyor mu", "retrieval dogru chunk'i getiriyor mu" veya "degisiklikten sonra kalite dustu mu" gibi sorulara otomatik cevap verilemiyor.

Neden onemli:
- RAG sistemlerinde sadece endpoint'in cevap donmesi yeterli degildir.
- Degisikliklerden sonra kalite regressions'i kolayca kacirilir.
- Bu repo icin dogru hedef, en azindan elinizdeki benchmark sorularini kosup sonuc raporu ureten basit bir script'tir.

Yapilacaklar:
- `npm run benchmark` benzeri bir script ekle.
- Benchmark dosyasini oku ve her soru icin `/rag/query` veya dogrudan `answerQuestion()` cagir.
- Her cevap icin su alanlari raporla:
  - beklenen cevap
  - uretilen cevap
  - retrieved source id'leri
  - beklenen ozelge id'si ilk `k` sonuc icinde var mi
  - basit bir pass/fail veya manual review etiketi
- Sonucu JSON ve okunabilir markdown/console tablosu olarak kaydet.

### 2. Otomatik test coverage yok

Sorun:
- Repo icinde unit test veya integration test yok.
- `config`, `index`, `rag`, `server` yuzeyleri icin davranis kilitlenmemis durumda.

Neden onemli:
- Bugun calisan bir endpoint yarin kucuk bir refactor ile bozulabilir.
- Ozellikle validation, timeout, error handling ve retrieval akisinin test edilmesi gerekir.

Yapilacaklar:
- Test runner ekle (`vitest` mantikli bir secim olur).
- Asgari testler:
  - `config.ts`: JSON config parse, schema validation ve hatali kombinasyonlar
  - `server.ts`: bos body, invalid json, bos question, basarili query
  - `rag.ts`: `retrieveSources`, source formatting, timeout handling, model cevabi stringlestirme
  - `index.ts`: bozuk kaynak dosyasi, bos indexable content ve multidoc loader senaryolari
- Endpoint contract testlerini acikca ekle:
  - `POST /rag/retrieve`: basarili body
  - `POST /rag/retrieve`: invalid body
  - `GET /rag/retrieve`: `405`
  - `GET /rag/query`: `405`
  - `GET /ready` ile `GET /ready?strict=true` semantik farki
- Chroma ve Ollama bagimliliklari icin gerekirse mock katmani kur.

### 3. Index sample semantigi netlesti, test coverage eksik

Yapildi:
- `data.indexSampleSize` varsayilani `0` yapildi.
- `0`, ozelge JSON adapter'i icin tum parse edilen kayitlari indexle anlamina geliyor.
- Pozitif degerler sadece ozelge JSON adapter'inda ornek kayit sayisini sinirliyor.
- Dosya tabanli `txt`, `md`, `pdf`, `doc`, `docx` kaynaklar sample limiti yuzunden index disi kalmiyor.
- README ve `config/rag.config.yaml` bu semantigi acikliyor.

Kalanlar:
- `indexSampleSize = 0` ve pozitif limit davranisini unit/integration testlerle kilitle.
- Readiness warning'lerinin sample limit aktifken ve kapaliyken dogru dondugunu test et.

### 4. Readiness endpoint'i var, ama operasyonel probe kapsami halen gelistirilmeli

Sorun:
- Repoda artik `/health` ve `/ready` endpoint'leri var.
- `/ready`, Chroma ulasilabilirligi, collection durumu, Ollama model varligi, embedding smoke test'i, chat smoke test'i ve veri kaynagi okunabilirligini raporluyor.
- Buna ragmen gercek `POST /rag/query` akisini bire bir temsil eden, retrieved context iceren bir probe yok.
- Ayri bir startup fail-fast modu yok; sunucu yine de ayaga kalkabiliyor.

Neden onemli:
- Readiness endpoint'i guclu olsa da "bu backend gercek RAG sorgusuna tam hazir mi" sorusunun generation tarafinda halen bosluk vardir.
- Orkestrasyon katmani ile runtime readiness arasindaki son bosluklar kapanmadan operasyonda yalanci pozitifler kalabilir.

Yapilacaklar:
- Retrieved context'e daha yakin bir readiness / smoke test dusun.
- Startup sirasinda fail-fast veya warmup modu eklenip eklenmeyecegine karar ver.
- Readiness sonucu ile server startup davranisi arasindaki sozlesmeyi netlestir.
- `/ready` icindeki blocker / warning / recommended action contract'ini testlerle kilitle.

### 4.1. Model uyumlulugu gercek RAG akisinda ayrica dogrulanmiyor

Sorun:
- Bazi modeller kisa chat smoke testlerinde saglikli gorunebilir.
- Buna ragmen retrieved context iceren gercek `POST /rag/query` akisinda bos, kirik veya dusuk kaliteli cevap verebilir.
- Bu fark ozellikle model degistirildiginde gec fark edilir.

Neden onemli:
- Sadece chat smoke test'ine bakmak yalanci pozitif readiness uretebilir.
- Model degisimi sonrasinda "endpoint ayakta" ile "RAG gercekten calisiyor" ayni sey degildir.

Yapilacaklar:
- Modeller icin kisa bir compatibility matrisi veya notu tut.
- Retrieved context kullanan gercekci bir smoke query tanimla.
- Readiness veya benchmark akisinda bu query'yi opsiyonel bir probe olarak kullanmayi degerlendir.

## P1 - Kalite ve dayaniklilik eksikleri

### 5. Retrieval akisi cok minimal

Sorun:
- Su an temel dense retrieval akisi calisiyor.
- Distance threshold var; buna ragmen reranking, MMR, metadata filtering veya query expansion yok.

Neden onemli:
- Vanilla RAG icin bu normaldir, ama kalite siniri da burada baslar.
- Benzer ama baglam disi chunk'lar kolayca ust siralara cikabilir.

Yapilacaklar:
- Metadata ile filtreleme imkanini dusun (tarih, konu, belge id).
- Gerekirse ikinci adim reranker eklemek icin yapiyi hazirla.

### 5.1. `POST /rag/retrieve` response'u retrieval metadata acisindan halen zayif

Sorun:
- Retrieval-only endpoint artik var.
- Response artik `distanceScore` gosteriyor; query tarafindaki `ANSWER_NOT_IN_RETRIEVED_CONTEXT` hatalari da kompakt `retrievedSources` ozeti iceriyor. Buna ragmen chunk index, filtre bilgisi veya daha zengin retrieval metadata'si halen sinirli.

Neden onemli:
- Retrieval endpoint'in asil degeri, generation'dan bagimsiz kalite gozlemi saglamasidir.
- Hangi chunk neden ust siraya cikti sorusu cevapsiz kalirsa endpoint'in debug degeri duser.

Yapilacaklar:
- Her kaynak icin anlamli metadata alanlarini netlestir.
- Gerekliyse chunk index veya source path gibi ek retrieval debug alanlarini dusun.
- Benchmark raporu ile `POST /rag/retrieve` response seklinin uyumlu kalmasini sagla.

### 6. Multidoc ingestion calisiyor, kalite ve genisletme isleri kaliyor

Yapildi:
- Ingestion akisi `data.sourcePath` uzerinden tek dosya veya klasor okuyabiliyor.
- Klasor ingestion ilk surumde recursive degil; sadece dogrudan klasor icindeki dosyalari okuyor.
- LangChain loader/adaptor akisiyle `txt`, `md`, `pdf`, `doc`, `docx` ve mevcut ozelge JSON adapter'i indexlenebiliyor.
- Ozelge JSON mapping'i genel file loader akisi yerine ayri adapter olarak korundu.
- Ortak document metadata contract'i eklendi: `documentId`, `sourcePath`, `sourceType`, `chunkIndex`.
- Ozelge metadata'si korunuyor: `ozelgeId`, `sayi`, `tarih`, `konu`.
- Indexleme oncesinde `normalizeText()` tum loader ciktilarina uygulanıyor; bos content indexlenmiyor.
- Unsupported extension indexlemeyi durdurmuyor; analysis sonucunda `unsupportedFiles` olarak raporlaniyor.
- Chroma id uretimi artik `documentId:chunkIndex`; ozelge disi dosyalarda `ozelgeId` beklenmiyor.
- Readiness ve operator mesajlari `pdfText` / tek JSON dosyasi dilinden genel indexing source diline tasindi.
- `POST /rag/retrieve` ve query kaynaklari `documentId`, `sourcePath`, `sourceType`, `chunkIndex` donduruyor.
- `data.indexSampleSize = 0` tum parse edilen ozelge kayitlarini indexliyor; pozitif deger sadece ozelge JSON sample limitidir.

Kalan sorunlar:
- Generic JSON mapping yok; v1'de `.json` destegi sadece `data.ozelgeDataPath` ile isaretlenen mevcut ozelge adapter'i anlamina geliyor.
- JSONL ve CSV henuz desteklenmiyor.
- Recursive directory ingestion henuz yok.
- Loader options config yuzeyi yok.
- OCR artigi, header/footer ayiklama, tekrarli metin temizleme ve asiri kisa chunk filtreleme halen temel seviyede.
- Multidoc ingestion icin otomatik unit/integration test coverage yok.

Neden onemli:
- Multidoc ingestion calissa da kalite ve genisletilebilirlik testlerle kilitlenmezse kolayca regress olabilir.
- Generic JSON/CSV/JSONL destegi olmadan her kullanicinin kendi veri semasini kod degistirmeden eslemesi mumkun degil.
- Ozelge gibi yapisal belgelerde girdi kalitesi retrieval kalitesini dogrudan etkiler.
- Kirik veya gereksiz metinler embedding kalitesini dusurur.

Kalan yapilacaklar:
- JSON ingestion icin sema bagimliligini config'e tasi:
  - `contentField`, `idField` ve `metadataFields` benzeri ayarlar dusun.
  - Mumkunse nested alanlar icin JSON pointer/path semantigi belirle.
  - Boylece kullanici kendi JSON dosyasini kod degistirmeden esleyebilsin.
- JSONL ve CSV loader destegi ekle.
- Recursive directory opsiyonunu config ile ac/kapat.
- Loader options config yuzeyini tasarla.
- Sayfa numarasi, belge bolumu, paragraf tipi gibi ek metadata alanlarini dusun.
- Ayni belge icindeki tekrar eden veya asiri kisa chunk'lari filtrele.
- Testleri bu yeni capability etrafinda ekle:
  - Farkli dosya tiplerinden `Document` uretimi
  - Yanlis JSON field mapping durumunda anlasilir hata
  - Bos klasor / unsupported extension / bozuk dosya senaryolari
  - `indexSampleSize = 0` ve pozitif sample semantigi
  - Readiness mesajlarinin source-specific alan adlarina bagli olmamasi

### 6.1. Ingestion dokumani guncellendi, custom mapping dokumani eksik

Yapildi:
- README supported loaders ve mixed `data/` ingestion davranisini listeliyor.
- Ilk resmi destek kapsami net: `txt`, `md`, `pdf`, `doc`, `docx`, ve mevcut ozelge JSON adapter'i.
- `indexSampleSize = 0` semantigi README ve config yorumlarinda aciklandi.

Kalan sorunlar:
- Generic JSON mapping olmadigi icin "custom JSON mapping" bolumu henuz gercek bir ozelligi anlatamaz.
- CSV/JSONL ve recursive directory davranislari dokumanda backlog olarak kalmali.
- Mimari dokumanda multidoc ingestion akisi ve metadata contract'i ayrica guncellenmeli.

Neden onemli:
- Vanilla RAG'in pratikte tekrar kullanilabilir olmasi icin en kritik unsur, veri kaynagini modele degil `Document` katmanina standartlastirmasidir.
- Desteklenen formatlar ve kisitlar net kalmazsa kullanici kendi data klasorunu koydugunda yanlis beklentiye girer.

Kalan yapilacaklar:
- Mimari dokumanda desteklenen ingestion kaynaklarini acik listele.
- Generic JSON mapping gelince "custom JSON mapping" bolumu ekle.
- Ornek veri klasoru yapilari ver:
  - tek JSON dosyasi
  - klasorde birden fazla PDF/TXT/DOCX dosyasi
  - mixed-source ingestion
- Backlog formatlarini ayri listele: CSV, JSONL, recursive directory.

### 7. Re-index akisinin tamamini resetlemesi yikici bir davranis

Sorun:
- Her index kosusunda Chroma collection tamamen siliniyor ve bastan yaziliyor.
- Bu davranis gelistirme icin basit ama operasyonel olarak riskli.

Neden onemli:
- Kucuk veri guncellemelerinde tam reset gereksiz maliyet yaratir.
- Yanlislikla prod benzeri bir ortamda kullanilirsa veri kaybi mantigi olusur.

Yapilacaklar:
- Full reset ve incremental index modlarini ayir.
- `--reset` gibi explicit bir flag dusun.
- Upsert mantigi veya belge bazli yeniden indexleme opsiyonu ekle.

### 8. Hata siniflandirmasi ve log yapisi yetersiz

Sorun:
- Loglar ve hata siniflandirmasi onceye gore daha iyi; query path'inde typed `422/502` hatalari ve retrieval ozeti var. Buna ragmen log yapisi halen temel seviyede.
- Request id, latency breakdown, retrieval source ids, source count ve hata tipi gibi alanlar standardize edilmis degil.

Neden onemli:
- RAG debug ederken "retrieval mi kotu", "LLM mi sapitti", "timeout mi oldu" ayrimini hizli gormek gerekir.

Yapilacaklar:
- Her request icin bir request id uret.
- Loglara su alanlari ekle:
  - request id
  - toplam sure
  - retrieval suresi
  - generation suresi
  - source id listesi
  - hata tipi
- 4xx ve 5xx hata siniflarini daha acik ayir.

### 9. API yuzeyi temel, ama urunlesme acisindan ince kalmis

Sorun:
- Mevcut endpoint yuzeyi su anda `GET /`, `GET /health`, `GET /ready`, `GET /rag/query`, `GET /rag/retrieve`, `POST /rag/retrieve`, `POST /rag/query` seviyesine gelmis durumda.
- Query ve retrieval debug akislari var; ancak ingestion, admin ve gozlemlenebilirlik endpoint'leri halen yok.
- Rate limiting, auth, request tracing, CORS stratejisi, versioning yok.

Neden onemli:
- Lokal demo ve temel RAG servisleme icin bu yuzey yeterli.
- Ancak paylasilan servis, yonetilen backend veya urunlesmis API beklentisi icin ince kaliyor.

Yapilacaklar:
- En azindan API contract'ini netlestir.
- Varsa frontend/consumer ihtiyacina gore response sekline su alanlari eklenebilir:
  - `model`
  - `retrievalK`
  - `latencyMs`
  - `sourceCount`
- Gerekirse `/v1/rag/query` gibi versioning dusun.
- Mevcut endpointler icin acik contract yaz:
  - `GET /`: bootstrap metadata
  - `GET /health`: liveness
  - `GET /ready`: dependency ve capability readiness
  - `POST /rag/retrieve`: retrieval-only debug/evaluation yuzeyi
  - `POST /rag/query`: query execution
- Eklenmesi dusunulmesi gereken yeni endpointler:
  - `POST /v1/rag/query`: versioned public query endpoint
  - `POST /admin/index/rebuild`: auth korumali explicit re-index endpoint
  - `POST /admin/index/upsert`: incremental indexing veya belge bazli guncelleme yuzeyi
  - `GET /admin/index/status`: collection count, last indexed time, sample/full mode durumu
  - `GET /metrics`: Prometheus veya benzeri monitoring entegrasyonu icin metrik yuzeyi
  - `GET /openapi.json` veya benzeri schema endpoint'i: API contract'ini makina-okunur hale getirmek icin

### 9.2. Admin onboarding CLI eklendi, test coverage eksik

Yapildi:
- `npm run onboard` script'i eklendi.
- CLI mevcut config'i okuyup admin'e kritik ayarlari gostererek guncellettirebiliyor.
- Config validation, source analysis ve Chroma/Ollama dependency kontrolleri calisiyor.
- Admin onayi veya `--yes` ile index pipeline calisiyor.
- `--dry-run`, `--yes`, `--skip-index`, `--no-write`, `--config <path>` modlari eklendi.
- Index reset davranisi interactive modda acik onay gerektiriyor.
- `src/config.ts`, `src/rag.ts` ve `src/index.ts` runtime `ResolvedConfig` alabilecek sekilde refactor edildi; onboarding health/source/index adimlari ayni config degerleriyle calisiyor.
- README'de onboarding kullanimi ve Chroma persisted state reset akisi dokumante edildi.
- `no such table: collections` gibi bozuk/uyumsuz `chroma_data/` durumunda uygulanacak reset komutlari README'ye eklendi.
- README'de `ollama.chatModel` degisikliginin `--skip-index` ile index calistirmadan yapilabilecegi, `ollama.embeddingModel` degisikliginde ise re-index gerektigi aciklandi.
- `npm.cmd run build` ve `npm.cmd run onboard -- --dry-run --yes` ile onboarding dry-run akisi dogrulandi.

Kalanlar:
- Onboarding CLI icin otomatik test coverage yok.
- Interactive modda validation hatasi olursa wizard ayni proses icinde tekrar prompt akisine donmuyor; hata verip non-zero exit ediyor. Plan bunu tekrar deneme akisi olarak tarif ediyordu.
- `--config <path>` health/source/index asamalarinda dogru runtime config'i kullaniyor; ancak `src/rag.ts` ve `src/index.ts` import edilirken default `config/rag.config.yaml` halen eager-load ediliyor. Default config bozuksa alternatif config verilse bile CLI import asamasinda kirilabilir.
- Config comment-preserving yazim yok; CLI canonical YAML yazar.
- Incremental/upsert indexing onboarding kapsaminda degil.
- Full onboarding/index reset akisi manuel olarak her calismada kosulmadi; dry-run ve skip-index modlari dogrulandi, gercek rebuild icin Chroma/Ollama hazirligi gerekir.

### 9.1. Dokumantasyon ile gercek endpoint yuzeyi arasinda tekrar drift olusabilir

Sorun:
- README, mimari dokuman ve endpoint gercegi daha once hizasini kaybetti.
- Repo hizli evrildigi icin ayni problem tekrar edebilir.

Neden onemli:
- Kullaniciya veya gelecekteki gelistiriciye yanlis API resmi cizilir.
- Test UI, README ve backend birbirinden koparsa debug maliyeti artar.

Yapilacaklar:
- API contract'ini tek bir kaynakta toplama yaklasimi belirle.
- Mumkunse OpenAPI veya benzeri makina-okunur bir tanim dusun.
- En azindan release checklist'ine README + mimari dokuman + endpoint parity kontrolu ekle.

### 9.3. Admin indexing endpoint

Sorun:
- Indexleme su anda bilerek HTTP endpoint degil; `npm run index` (veya `npm run onboard`) ile operasyonel komut olarak calisiyor.
- Mevcut akis Chroma collection'i silip bastan yazdigi icin yetkisiz veya public bir endpoint olarak acilmamasi gerekiyor.

Neden onemli:
- Sistem canliya alindiginda (production), operasyon ekiplerinin veya webhook'larin yeni veri geldiginde guvenli bir sekilde indexlemeyi tetikleyebilmesi gerekir.
- Sadece CLI uzerinden calisan bir yapi, container icinde veya remote ortamda data guncellemeyi zorlastirir.

Yapilacaklar:
- V1 icin hedef yuzeyi tanimla ve uygula:
  - `POST /admin/index/rebuild`: auth/admin korumali, tek seferde bir job calistiran rebuild tetikleyici.
  - `GET /admin/index/status`: running/succeeded/failed, startedAt/finishedAt, indexed chunk count ve last error bilgisi donduren endpoint.
- Uygulama notu: `src/index.ts` icerisinde halihazirda `runIndexing()` adinda reusable bir fonksiyonumuz bulunuyor. Bu fonksiyonun etrafina "job status" (state tracking: isRunning, startedAt, error) sarmalayan ve ayni anda coklu calismayi kilitleyen (lock) bir state yoneticisi/servisi eklenmeli.
- Kabul kriterlerini sagla:
  - Ayni anda gelen ikinci bir rebuild istegi (zaten bir islem suruyorsa) `409 Conflict` veya `429 Too Many Requests` ile reddedilmeli.
  - Job sonuclari bellek uzerinde (`GET /admin/index/status`) raporlanabilmeli.
  - Indexleme durumundaki degisiklik veya hata sonuclari `/ready` endpoint'ini etkilemeli (ornek: `indexing_in_progress` statulerini eklemek).
  - Admin endpoint'leri icin basit bir Bearer token veya API key auth mekanizmasi kurulmali.

## P2 - Gelistirici deneyimi ve repo bakimi eksikleri

### 10. Lint ve format adimi yok

Sorun:
- `build` script'i var ama lint veya format check yok.
- Kod kalite standardi tamamen manuel korunuyor.

Yapilacaklar:
- ESLint ekle.
- Istenirse Prettier veya mevcut stil neyse onu standardize et.
- CI'da `build + lint + test` zinciri kur.

### 11. CI pipeline yok

Sorun:
- Repo degisikliklerinde otomatik dogrulama kosmuyor.
- Build kiran veya test bozan degisiklikler manuel fark ediliyor.

Yapilacaklar:
- GitHub Actions veya benzeri CI tanimla.
- Asgari pipeline:
  - dependency install
  - typecheck/build
  - test
  - opsiyonel benchmark smoke check

### 13. README teknik olarak yeterli ama kalite sinirlari daha acik yazilmali

Sorun:
- README artik daha sade ve `test_frontend` merkezli.
- Ancak sistemin sinirlari daha net anlatilmali:
  - sample indexing kullanimi
  - benchmark automation'in olmamasi
  - retrieval kalitesinin baseline oldugu
  - gerekli Ollama modellerinin zorunlu oldugu

Yapilacaklar:
- "Known limitations" bolumu ekle.
- "Production-ready degildir" gibi bir not gerekiyorsa acik yaz.
- Gelistirme ve demo modunu ayir.

### 13.1. `test_frontend` artik ayri bir bakim yuzeyi

Sorun:
- `test_frontend` artik repoda kalici bir manuel test araci haline geldi.
- Yeni endpoint veya response alani eklendiginde UI'nin geri kalma riski var.

Neden onemli:
- README artik buyuk olcude bu UI'ye dayaniyor.
- Backend ile UI arasinda parity bozulursa manuel test akisi guvenilmez hale gelir.

Yapilacaklar:
- Yeni endpoint eklendiginde `test_frontend` parity kontrolunu checklist'e bagla.
- UI'de aktif model, retrievalK veya temel config ozeti gosterilip gosterilmeyecegine karar ver.
- Error response'lari ve readiness varyantlari icin UI kapsam sinirlarini netlestir.

### 13.2. TODO'nun kendisi hizla stale olabilir

Sorun:
- Repo ve dokumanlar hizli degistigi icin TODO listesi de kolayca eskir.

Neden onemli:
- Yanlis veya tamamlanmis maddelerin listede kalmasi planlama kalitesini dusurur.

Yapilacaklar:
- Her anlamli ozellik degisikliginden sonra TODO temizligi yap.
- Tamamlanan maddeleri kapat, kismen tamamlanan maddeleri yeniden yaz.

### 14. Konfigurasyon dogrulamasi kisitli

Sorun:
- Repoda artik `zod` tabanli merkezi config schema var.
- URL formatlari, bos string'ler ve `chunkOverlap >= chunkSize` gibi temel hatalar startup sirasinda yakalaniyor.
- Buna ragmen model bazli veya operasyonel acidan mantiksiz bazi deger kombinasyonlari icin validation halen sinirli.

Yapilacaklar:
- Mevcut schema'yi genislet.
- Su hatalari daha net yakala:
  - `retrievalK` ve `numPredict` icin operasyonel ust sinir beklentileri
  - model degisikliginde gerekli restart / re-index etkilerini acik contract'a baglama
  - `indexSampleSize` icin `0 = tum veri` semantiginin ek validation/test kapsami

### 15. All-in-One Deployment Paketi (Dockerization) Eksikligi

Sorun:
- Su anda `docker-compose.yml` sadece Chroma veritabanini calistiriyor.
- Sistemin tamamini (Node.js API, Chroma ve Ollama LLM motoru) bir butun olarak dagitacak (deploy) ve calistiracak "hepsi bir arada" bir containerizasyon stratejisi yok.
- Kullanici bu backend'i kendi sunucusunda calistirmak isterse Node.js kurmasi, Ollama'yi ayrica kurup manuel model indirmesi ve aralarindaki ag baglantilarini manuel yapmasi gerekiyor.

Neden onemli:
- Bu projenin amaci "baskalarinin alip kendi verisiyle kolayca kullanabilecegi bir RAG backend'i" sunmaktir.
- Son kullanici icin en iyi (ve endustri standardi) deneyim, repoyu indirip tek bir `docker-compose up -d` komutuyla tum ekosistemin (veritabani, backend ve yapay zeka modeli) hazir hale gelmesidir.

Yapilacaklar:
- Proje kok dizinine Node.js uygulamasini derleyip calistiracak optimize edilmis bir `Dockerfile` ekle (multi-stage build).
- `docker-compose.yml` dosyasini 3 servisi (Chroma, Ollama, Backend) icerecek sekilde genislet.
- Servislerin birbiriyle `localhost` yerine Docker internal network uzerinden (ornek: `http://chroma:8000`, `http://ollama:11434`) konusmasini saglayacak environment variable yapilandirmalarini ekle.
- Ollama servisi ayaga kalktiginda istenen dil modelini (ornek: `gemma2:2b`) manuel mudahale olmadan otomatik indirecek (pull) baslangic (entrypoint/command) script'i ekle.
- Kullanicinin indexleyecegi verileri koymasi icin `./data:/app/data` gibi volume mapping'leri sagla ve bu "Tek tusla kurulum" adimini README dokumanina ekle.

### 16. Multi-Collection (Coklu Koleksiyon) Destegi Eksikligi

Sorun:
- Sistem su anda `rag.config.yaml` icinde tanimli tek bir "default" Chroma koleksiyonu varsayimiyla calisiyor.
- Sorgular (`POST /rag/query`) veya indexleme uclari hedef koleksiyon secmeye izin vermiyor.

Neden onemli:
- Gercek dunya RAG senaryolarinda veriler (ornek: IK belgeleri, finans raporlari, yonetmelikler) birbirine karismamalidir. Sistem farkli baglamlari (context) izole koleksiyonlarda tutabilmeli ve kullaniciya secme hakki vermelidir.

Yapilacaklar:
- `notes/multicollection.md` dosyasinda detaylandirildigi gibi RAG core metotlarini (`createVectorStore`, `answerQuestion` vb.) opsiyonel `collectionName` argumani alacak sekilde refactor et.
- `POST /rag/query`, `POST /rag/retrieve` ve eklenecek olan admin indexleme uclarina `collection` parametresi destegi ekle.
- Mevcut koleksiyonlari listelemek icin `GET /rag/collections` adinda yeni bir endpoint olustur.
- Readiness (`/ready`) kontrolunu "koleksiyon yoksa sistem cokuktur" varsayimindan kurtar.

## Sonraki oncelikli uygulama sirasi

1. Benchmark runner ekle.
2. Unit ve integration testlerini ekle.
3. Multidoc ingestion test coverage ekle.
4. Generic JSON mapping, CSV/JSONL ve recursive directory backlog'unu sirala.
5. Retrieval observability ve request/log standardizasyonunu ekle.
6. Readiness'i gercek RAG akisina daha yakin probe'larla guclendir.

## Kapanis notu

Bu repo su anda "calisan bir baseline vanilla RAG backend" seviyesinde.
"Guvenle olculebilen, bakimi kolay, genisletilebilir bir backend" seviyesine cikmak icin yukaridaki maddeler tamamlanmali.
