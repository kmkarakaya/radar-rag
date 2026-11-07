# Repo Eksikleri ve TODO Listesi

Son guncelleme: 2026-11-08. Oncelikler urun hedefine gore duzenlendi: repo, baskalarinin GitHub'dan indirip kendi verisiyle kullanacagi bir urun.

Bu dosya, mevcut multi-collection RAG backend'in ustune hangi eksiklerin kaldigini ve bunlarin hangi oncelikle ele alinmasi gerektigini toplar. Tamamlanan maddeler asagida ayri bir bolumde kisaca listelenir; ayrintilari git gecmisinde ve `docs/` altinda.

## Mevcut durum (ozet)

- TypeScript + Express 5 (ESM) backend; LangChain + Chroma (vector store) + Ollama (chat + embedding); SQLite registry (`data/registry.sqlite`).
- Multi-collection ve multi-tenant: public `/v1/rag/collections/:id/{ready,retrieve,query}`, admin `/v1/admin/**`. Legacy route'lar bilerek 404.
- Indexing: async job runner, koleksiyon basina tek aktif job, blue/green fiziksel koleksiyon build + swap, retention TTL ile eski fiziksel koleksiyon temizligi.
- Admin auth: scrypt parola hash, HMAC imzali session cookie, `viewer` / `operator` / `admin` RBAC, tek kullanimlik CSRF action token.
- Dayaniklilik: in-memory rate limit (`429` + `Retry-After`), embedding/generation semaphore'lari, timeout/abort, Ollama model preflight (`422 UNAVAILABLE_MODEL`, `503 OLLAMA_UNREACHABLE`).
- Gozlemlenebilirlik: request id, `latencyMs`, `errorCode`, `retrievalMs` iceren yapisal operational log (+ `operational_logs` tablosu), audit log, opsiyonel `debug.latency` response alani.
- `/health`, `/ready` (`?strict=true`, `?details=true`), koleksiyon bazli `/ready`.
- Ingestion: `txt`, `md`, `pdf`, `doc`, `docx` (alt klasorler dahil, recursive; registry SQLite dosyasi atlanir); SHA-256 source hash; dosya bazli hata toleransi.
- Testler: `node:test` ile 164 unit + acceptance testi, ayrica Ollama + Chroma isteyen integration testi; dokuman/statik contract testleri.
- Dokumanlar: README, `docs/` (API, workflow, `openapi.yaml`), mimari dokumani; admin panel (`/admin`) ve ornek istemci (`/test-frontend`).

## Tamamlananlar (eski listeden kapatilanlar)

- **Ollama model preflight (eski P0 #0)** - 2026-11-08. `POST /v1/admin/collections` embedding + chat modelini, reindex embedding modelini kontrol ediyor; eksikse `422 UNAVAILABLE_MODEL` (eksik/mevcut modeller + `ollama pull` onerisi), Ollama yoksa `503 OLLAMA_UNREACHABLE`. Aktif job varsa reindex once `409` doner. Admin panel `job.error`'u zaten gosteriyordu. Karar: reindex chat modeli istemez (retrieve-only kullanim bozulmasin).
- **Otomatik test altyapisi (eski #2)** - `vitest` yerine `node:test` + `tsx`; `npm test`, `npm run test:integration`, `npm run typecheck:test`. 2026-11-07'de admin auth acildiktan sonra kirilan 46 test duzeltildi; testler artik gercek YAML'a ve `.local/` secret'ina bagli degil. Kalan bosluklar asagida P1 #6'da.
- **Yikici re-index (eski #7)** - Her reindex yeni bir fiziksel Chroma koleksiyonuna yaziliyor, basarili olunca swap ediliyor; okuma build sirasinda kesilmiyor. Eski fiziksel koleksiyonlar retention TTL ile temizleniyor. Kalan: incremental/upsert (P1 #5).
- **Admin indexing endpoint (eski #9.3)** - `POST /v1/admin/collections/:id/reindex`, `GET /v1/admin/jobs[/:jobId[/events]]`, cancel, delete, bulk-delete. Ikinci istek `409`; auth Bearer token yerine session + RBAC + CSRF ile cozuldu; job durumu `/ready` ve koleksiyon readiness'ine yansiyor.
- **Multi-collection destegi (eski #16)** - Koleksiyon registry'si, tenant scoping, `GET /v1/rag/collections`, koleksiyon bazli query/retrieve/ready.
- **API yuzeyi urunlesmesi (eski #9, buyuk kismi)** - `/v1` versioning, admin API, auth, rate limit, request id, `docs/openapi.yaml`. Kalanlar P1 #8'de.
- **Log yapisi (eski #8, buyuk kismi)** - Her request icin request id (header yoksa uretiliyor), `latencyMs`, `errorCode`, retrieval suresi ve kaynak sayisi loglaniyor; typed `HttpError` / `RagQueryError` ve merkezi error handler var.
- **Recursive directory ingestion (eski #6'dan)** - `sourcePath` alt klasorleriyle taraniyor (gizli dosyalar ve `node_modules` atlaniyor); `test/recursive.ingestion.test.ts`.
- **Ozelge JSON desteginin kaldirilmasi** - 2026-11-08. `ozelgeDataPath` / `indexSampleSize` config ve API alanlari, ozelge loader'i, `ozelgeId`/`sayi`/`tarih`/`konu` kaynak metadata'si, admin panel alanlari ve `data/dataset2/ozelge_veri.json` kaldirildi. Eski config dosyalarindaki bu anahtarlar sessizce yok sayiliyor; eski registry'lerdeki `ozelge_data_path` kolonu startup migration'i ile siliniyor. API'ye `ozelgeDataPath` gonderen istemciler artik `400 INVALID_REQUEST_BODY` aliyor.
- **Tasinabilir config ve registry** - 2026-11-08. Proje icindeki yollar goreli saklaniyor (`src/paths.ts`): config'te `collectionDefaults.sourcePath: data`, onboarding goreli yaziyor, registry koleksiyon `sourcePath`'lerini goreli kaydediyor ve eski mutlak kayitlari (index snapshot'lari dahil) acilista bir defalik donusturuyor. `RAG_PORT`, `RAG_REGISTRY_PATH`, `RAG_CHROMA_URL`, `RAG_OLLAMA_BASE_URL`, `RAG_OLLAMA_CHAT_MODEL`, `RAG_OLLAMA_EMBEDDING_MODEL`, `RAG_SOURCE_PATH`, `RAG_CONFIG_PATH` YAML'i calisma aninda eziyor. Kalan: Chroma chunk metadata'sindaki `sourcePath` hala mutlak (sadece gosterim; reindex'te yeniden yazilir).
- **All-in-one Docker** - 2026-11-08. `Dockerfile` (multi-stage, node:22-bookworm-slim) + `docker-compose.yml`: backend + Chroma `1.5.9` + Ollama `0.40.12` (host'a acilmiyor, yerel Ollama ile cakismaz) + `ollama-init` (modelleri cekip cikar; backend onu bekler). `./data` mount, modeller `.env` ile degistirilebilir, host Ollama icin `RAG_OLLAMA_BASE_URL=http://host.docker.internal:11434`, GPU blogu yorumda. Imaj host Chroma/Ollama'ya karsi denendi (`/ready` ok, admin 200); bundled Ollama + model indirme ile tam yigin henuz uctan uca kosulmadi. `NODE_ENV=production` bilerek set edilmiyor (Secure cookie HTTP'de admin login'i bozar).
- **Onboarding hata akisi** - 2026-11-08. Bagimlilik/kaynak eksiklerinde durmuyor; "Config saved; fix these before indexing" altinda her eksik icin tek satir cozum yaziyor, "Next steps"i her zaman gosteriyor, exit code 0. `--skip-index` deprecated.

## P0 - Urun hedefi icin kritik eksikler

Hedef: baskalarinin repoyu GitHub'dan indirip kendi verisiyle kolayca kullanabilmesi. Olcut: yeni bir kullanicinin ilk cevabini almasi ne kadar zahmetsiz?

### 1. Dosya formati destegi dar

Sorun:

- Sadece `txt`, `md`, `pdf`, `doc`, `docx` destekleniyor. Ozelge adapter'i kalkinca JSON destegi tamamen gitti.
- Son kullanici verisinde yaygin olan CSV, JSON/JSONL ve HTML desteklenmiyor; bu dosyalar "unsupported" olarak atlaniyor.

Yapilacaklar:

- HTML loader (metni cikar, script/style at).
- CSV ve JSONL loader'lari; satir/kayit basina belge.
- Generic JSON mapping: `contentField`, `idField`, `metadataFields` benzeri koleksiyon ayarlari; nested alanlar icin JSON pointer/path; yanlis mapping'de anlasilir hata.
- Desteklenen formatlari README'de ve admin panelde net goster.

### 2. CI pipeline yok

Sorun:

- Repo degisikliklerinde otomatik dogrulama kosmuyor.
- Somut kanit: 2026-07-02'deki Auth/RBAC + onboarding commit'lerinden sonra 46 test ve `typecheck:test` aylarca kirik kaldi ve fark edilmedi (2026-11-07'de duzeltildi).
- `npm test` tip kontrolu yapmiyor (`tsx` tipleri atliyor); `typecheck:test` ayrica calistirilmazsa test dosyalarindaki tip hatalari gorunmuyor.

Yapilacaklar:

- GitHub Actions (veya benzeri) tanimla. Asgari zincir:
  - `npm ci`
  - `npm run typecheck` + `npm run typecheck:test`
  - `npm run build`
  - `npm test`
- Integration testleri (Ollama + Chroma) ayri, opsiyonel/manuel bir job olarak dusun.
- Lint eklenince (P2 #1) zincire ekle.
- Docker imajinin build'ini de zincire ekle.
- Urun baskalarinin elindeyken kirik bir surum yayinlamamak icin gerekli.

## P1 - Kalite ve dayaniklilik eksikleri

### 1. Retrieval akisi minimal

Sorun:

- Temel dense retrieval + distance threshold calisiyor; reranking, MMR, metadata filtering veya query expansion yok.
- Benzer ama baglam disi chunk'lar kolayca ust siralara cikabilir.

Yapilacaklar:

- Metadata ile filtreleme (tarih, konu, belge id) dusun.
- Ikinci adim reranker icin yapiyi hazirla.
- Degisiklikleri olcerek yap (bkz. P2 #2 opsiyonel degerlendirme araci).

### 2. `retrieve` response'u retrieval metadata acisindan sinirli

Sorun:

- `POST /v1/rag/collections/:id/retrieve` kaynaklari `documentId`, `sourcePath`, `sourceType`, `chunkIndex`, `distanceScore` donduruyor; `ANSWER_NOT_IN_RETRIEVED_CONTEXT` hatasi kompakt `retrievedSources` ozeti iceriyor.
- Filtre bilgisi ve "bu chunk neden ust sirada" sorusuna cevap veren daha zengin debug metadata'si yok.

Yapilacaklar:

- Her kaynak icin anlamli metadata alanlarini netlestir.
- Degerlendirme araci (P2 #2) ile `retrieve` response seklinin uyumlu kalmasini sagla.

### 3. Ingestion genisletme ve kalite isleri

Yapildi (ozet): `txt`/`md`/`pdf`/`doc`/`docx` loader'lari, ortak metadata contract'i (`documentId`, `sourcePath`, `sourceType`, `chunkIndex`), `normalizeText()`, unsupported dosyalarin raporlanmasi, recursive klasor tarama, SHA-256 hash, hata toleransi ve bunlarin testleri.

Kalanlar:

- Yeni formatlar (HTML, CSV, JSONL, generic JSON) P0 #1'de.
- Recursive tarama her zaman acik; config ile kapatma/derinlik siniri yok.
- Loader options config yuzeyi yok.
- OCR artigi, header/footer ayiklama, tekrarli metin ve asiri kisa chunk filtreleme temel seviyede.
- Sayfa numarasi, belge bolumu gibi ek metadata alanlari yok.

### 4. Ingestion dokumani: custom mapping ve ornekler eksik

Kalanlar:

- Generic JSON mapping gelince README / mimari dokumana "custom JSON mapping" bolumu ekle.
- Ornek veri klasoru yapilari ver: tek JSON dosyasi, birden fazla PDF/TXT/DOCX, mixed-source.
- Backlog formatlarini (CSV, JSONL) ayri listele; recursive taramanin artik varsayilan oldugunu yaz.

### 5. Incremental / upsert indexing yok

Sorun:

- Blue/green rebuild guvenli ama her reindex tum kaynagi bastan embed ediyor.
- Kaynaklar icin SHA-256 hash zaten hesaplanip metadata'ya yaziliyor, ama degismeyen dosyalari atlamak icin kullanilmiyor.

Yapilacaklar:

- Full rebuild ve incremental mod ayrimi tasarla (hash karsilastirmasi ile degisen/silinen belgeleri bul).
- Belge bazli upsert/silme icin admin yuzeyi dusun (ornek: `POST /v1/admin/collections/:id/upsert`).
- Blue/green modeliyle nasil birlesecegine karar ver (aktif fiziksel koleksiyona yerinde upsert mi, yeni build'e kopyalama mi).

### 6. Test coverage bosluklari

Sorun (mevcut 164 teste ragmen):

- `src/config.ts` icin ayri schema testi yok (hatali kombinasyonlar, `chunkOverlap >= chunkSize`, default cozumleme).
- Onboarding CLI (`npm run onboard`) icin davranis testi yok; `runtime.static.test.ts` sadece kaynak kodda string ariyor.
- Statik string testleri (README / config / onboarding metni) kirilgan: dokuman yeniden yazilinca veya operator config degistirince kiriliyor (2026-11-07'deki kirilmalarin bir kismi buydu).

Yapilacaklar:

- `config.ts` icin schema/default testleri ekle.
- Onboarding icin `--dry-run --yes --no-write` gibi non-interactive modlari kapsayan davranis testi ekle.
- Statik string testlerini davranis testlerine veya daha toleransli kontrollere donustur.

### 7. Onboarding CLI kalanlari

Yapildi (ozet): `npm run onboard` (`--dry-run`, `--yes`, `--skip-index`, `--no-write`, `--config <path>`), config/source/dependency kontrolleri, opsiyonel admin auth kurulumu (secret `.local/` altina, ilk admin parolasi hash'lenerek).

Kalanlar:

- Interactive modda validation hatasi olursa wizard tekrar prompt'a donmuyor; non-zero exit ediyor.
- `src/rag.ts` ve `src/index.ts` import aninda default `config/rag.config.yaml`'i eager-load ediyor; default config bozuksa `--config <path>` verilse bile import asamasinda kirilabilir.
- Config comment-preserving yazilmiyor; CLI canonical YAML yaziyor.
- Davranis testi yok (bkz. P1 #6).

### 8. API yuzeyi kalanlari

Kalanlar:

- `GET /metrics` (Prometheus vb.) yok.
- CORS stratejisi tanimli degil (admin panel ve test frontend ayni origin'den sunuluyor; harici frontend'ler icin karar gerekli).
- `docs/openapi.yaml` HTTP uzerinden sunulmuyor (ornek: `GET /openapi.json`) ve route'larla otomatik karsilastirilmiyor.
- Reindex: "basarisiz (`failed`) job'un `error` mesajini reindex response'una ekle" maddesi netlestirilmeli. `failed` job aktif sayilmadigi icin yeni reindex ile cakismiyor; `409` artik `details.jobId` / `details.status` donuyor. Asil ihtiyac "son basarisiz job'un hatasini koleksiyon detayinda gostermek" olabilir.

### 9. Readiness gercek RAG akisini temsil etmiyor

Sorun:

- `/ready`; Chroma, Ollama model varligi, embedding smoke, chat smoke ve veri kaynagi okunabilirligini raporluyor. Koleksiyon bazli `/v1/rag/collections/:id/ready` de var.
- Retrieved context iceren gercek bir query probe'u yok. Bazi modeller kisa chat smoke'unda saglikli gorunup gercek RAG akisinda bos/kirik cevap verebiliyor (ozellikle model degisiminden sonra).
- Startup fail-fast / warmup modu yok; sunucu bagimliliklar hazir olmasa da ayaga kalkiyor.

Yapilacaklar:

- Retrieved context kullanan gercekci, opsiyonel bir smoke query tanimla (readiness akisinda).
- Modeller icin kisa bir compatibility notu/matrisi tut.
- Startup fail-fast veya warmup modu eklenip eklenmeyecegine karar ver; readiness ile startup davranisi arasindaki sozlesmeyi yaz.

## P2 - Gelistirici deneyimi ve repo bakimi

### 1. Lint ve format adimi yok

- ESLint ekle; Prettier veya mevcut stili standardize et.
- CI zincirine ekle (P0 #1).

### 2. Opsiyonel degerlendirme (benchmark) araci

Karar (2026-11-08): soru seti ve "dogru cevap" tanimi son kullanicinin isi; backend en fazla bunu kosacak opsiyonel bir arac sunabilir. Eski ozelge benchmark'i silindi.

Yapilacaklar (istenirse):

- Basit bir soru dosyasi formati (soru, beklenen kaynak dosya, opsiyonel beklenen cevap, "cevap yok" beklentisi).
- `npm run eval -- --collection-id <id> --questions <file>`: her soru icin query + retrieve; hit@k, no-answer dogrulugu ve cevap/kaynak tablosu (JSON + markdown).

### 3. Konfigurasyon dogrulamasi

- `retrievalK` ve `numPredict` icin operasyonel ust sinirlar yok.
- Model degisikliginin restart / re-index etkisini config contract'ina bagla.

### 4. README: bilinen sinirlar bolumu yok

- "Known limitations" bolumu ekle:
  - retrieval kalitesi baseline (rerank / filtre yok)
  - incremental indexing yok
  - gerekli Ollama modelleri zorunlu (create/reindex artik eksik modelde `422` donuyor)
  - rate limit ve session store in-memory (tek instance varsayimi)
- Gelistirme ve demo modunu ayir.

### 5. Dokuman ve UI drift riski

Yapildi (ozet): `docs/openapi.yaml`, `test/docs.contract.test.ts`, `test/frontend.static.test.ts`, `test/admin.static.test.ts`, `test/frontend.example.docs.test.ts`.

Kalanlar:

- OpenAPI tanimini gercek route'larla otomatik karsilastiran bir kontrol yok.
- Release checklist'ine README + mimari dokuman + `docs/` + `test_frontend` + admin panel parity kontrolu ekle.
- `test_frontend`'de aktif model / `retrievalK` gibi config ozeti gosterilip gosterilmeyecegine karar ver.

### 6. TODO hijyeni

- Her anlamli ozellik degisikliginden sonra bu dosyayi guncelle; tamamlananlari "Tamamlananlar"a tasi.
- `notes/to_dos.md` de eski (admin indexing endpoint'i hala "yapilacak" diyor); ya guncellenmeli ya da kaldirilip bu dosyaya yonlendirilmeli.

## Sonraki oncelikli uygulama sirasi

1. Yeni dosya formatlari: HTML, CSV, JSONL, generic JSON mapping.
2. CI pipeline (typecheck + typecheck:test + build + test + Docker build).
3. Docker yiginini temiz bir makinede uctan uca dene (bundled Ollama + model indirme).
4. README bilinen sinirlar + ilk kurulum deneyimi cilasi.
5. Readiness icin gercek RAG smoke probe.
6. Incremental / upsert indexing.
7. Test coverage bosluklari, lint, opsiyonel degerlendirme araci.

## Kapanis notu

Repo artik "calisan bir baseline vanilla RAG backend" seviyesini gecti: multi-collection, multi-tenant, auth'lu admin API, guvenli blue/green reindex ve genis test kapsami var.
Tek komutla kurulum (Docker) artik var; baskalarinin kendi verisiyle kullanabilmesi icin siradaki oncelik daha genis dosya formati destegi ve CI.
