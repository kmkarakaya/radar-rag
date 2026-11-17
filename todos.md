# Repo Eksikleri ve TODO Listesi

Son guncelleme: 2026-11-17. Oncelikler urun hedefine gore duzenlendi: repo, baskalarinin GitHub'dan indirip kendi verisiyle kullanacagi bir urun.

Bu dosya, mevcut multi-collection RAG backend'in ustune hangi eksiklerin kaldigini ve bunlarin hangi oncelikle ele alinmasi gerektigini toplar. Tamamlanan maddeler asagida ayri bir bolumde kisaca listelenir; ayrintilari git gecmisinde ve `docs/` altinda.

## Kaldigimiz yer (2026-11-17)

Durum:

- **Proje adi: Radar RAG** ("an LLM-agnostic retrieval server that finds the evidence in your documents"). Repo `kmkarakaya/radar-rag` (eski adi `vanilla_rag_backend`; GitHub eski adresleri yonlendiriyor), imaj `ghcr.io/kmkarakaya/radar-rag`, npm paket adi `radar-rag`, mimari dokumani `radar_rag_mimarisi.md`. `notes/` altindaki eski kayitlar eski adla kaldi.
- **Repo ve ghcr paketi public.** Eski `vanilla_rag_backend` paketi silindi.
- **Kolay ilk calistirma** main'de:
  - Config dosyasi istege bagli: her ayarin semada varsayilani var; dosya yoksa varsayilanlar kullaniliyor.
  - Ilk acilista "Sample documents" koleksiyonu (`data/sample`, Ingilizce: Radar RAG ve RAG kavramlari) olusturulup indeksleniyor; bir kez, silinirse geri gelmez; `RAG_SAMPLE_COLLECTION=false` ile kapanir.
  - Onboarding varsayilan olarak sadece embedding, chat LLM ve admin auth soruyor; `--advanced` her seyi.
  - GitHub Actions: test (her push/PR) + main'de imaj yayini (amd64 + arm64). Compose bu imaji cekiyor; tek basina (clone'suz) calisiyor, `./config` istege bagli klasor.
  - README seviyeli (Level 1-7). Referans icerik `docs/configuration.md`, `docs/admin_auth.md`, `docs/operations.md`'de.
- **Dogrulama (2026-11-17):** 231/231 test; CI (test + publish) yesil; README Level 1 dis kullanici gibi bos bir klasorde birebir denendi: `curl` ile compose indi, imaj girissiz cekildi, config'siz acildi, ornek koleksiyon indekslendi (3 dokuman, 15 parca), "What is Radar RAG?" dogru dokumani ilk sirada getirdi.
- Yerel `config/rag.config.yaml` (+ `.bak`) kisisel ayarlarla degisik; commit'lenmemeli.

Devam edilecekler (sirayla):

1. **LICENSE yok.** Repo artik public; lisans olmadan baskalari kodu yasal olarak kullanamaz. Lisans secilmeli (ornegin MIT veya Apache-2.0); karar sizin.
2. GitHub repo sayfasi: aciklama (alt baslik), topics (rag, retrieval, langchain, chroma, self-hosted, mcp...) eklensin.
3. CI uyarilari: Node 20 tabanli action surumleri (checkout, setup-node, docker/*) eskiyor; yeni ana surumlere gecilsin.
4. Dev registry'deki eski (Ollama ile, saglayici alani olmadan indekslenmis) koleksiyonlar: `EMBEDDING_MODEL_UNSUPPORTED` gorunurlerse silip yeniden olustur ya da saglayiciyi `openai-compatible` yapip reindex et.
5. Testlerin yerel YAML'a bagimliligi: sabit bir test config'i P1 #6 kapsaminda dusunulsun.
6. Yol haritasindaki siradaki is: **P0 #3 dosya yukleme** (README Level 2 bunu "planned" diye duyuruyor) ya da **P0 #2 API anahtari + CORS** (README Level 3'teki guvenlik uyarisini kaldirir). Ileride: gelismis RAG teknikleri (reranking, hybrid search, query rewriting).

## Mevcut durum (ozet)

- TypeScript + Express 5 (ESM) backend; LangChain + Chroma (vector store) + koleksiyon bazli embedding (varsayilan: backend icinde calisan `builtin` embeddinggemma-2; istege bagli OpenAI uyumlu dis servis, ornegin Ollama) + istege bagli, OpenAI uyumlu herhangi bir chat LLM (`/query` icin; varsayilan kapali, retrieve-only); SQLite registry (`data/registry.sqlite`).
- Multi-collection ve multi-tenant: public `/v1/rag/collections/:id/{ready,retrieve,query}`, admin `/v1/admin/**`. Legacy route'lar bilerek 404.
- Indexing: async job runner, koleksiyon basina tek aktif job, blue/green fiziksel koleksiyon build + swap, retention TTL ile eski fiziksel koleksiyon temizligi.
- Admin auth: scrypt parola hash, HMAC imzali session cookie, `viewer` / `operator` / `admin` RBAC, tek kullanimlik CSRF action token.
- Dayaniklilik: in-memory rate limit (`429` + `Retry-After`), embedding/generation semaphore'lari, timeout/abort, embedding preflight (`422 UNAVAILABLE_MODEL`, `422`/`503 EMBEDDING_PROVIDER_*`), Chroma boyut uyusmazliginda `409 EMBEDDING_DIMENSION_MISMATCH`.
- Gozlemlenebilirlik: request id, `latencyMs`, `errorCode`, `retrievalMs` iceren yapisal operational log (+ `operational_logs` tablosu), audit log, opsiyonel `debug.latency` response alani.
- `/health`, `/ready` (`?strict=true`, `?details=true`), koleksiyon bazli `/ready`.
- Ingestion: `txt`, `md`, `pdf`, `doc`, `docx` (alt klasorler dahil, recursive; registry SQLite dosyasi atlanir); SHA-256 source hash; dosya bazli hata toleransi.
- Testler: `node:test` ile 231 unit + acceptance testi (CI'da her push'ta), ayrica Chroma isteyen integration testi (gercek builtin model testi `RAG_TEST_BUILTIN=1` ile istege bagli); dokuman/statik contract testleri.
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
- **All-in-one Docker** - 2026-11-08. `Dockerfile` (multi-stage, node:22-bookworm-slim) + `docker-compose.yml`: backend + Chroma `1.5.9` + Ollama `0.40.12` (host'a acilmiyor, yerel Ollama ile cakismaz) + `ollama-init` (modelleri cekip cikar; backend onu bekler). `./data` mount, modeller `.env` ile degistirilebilir, host Ollama icin `RAG_OLLAMA_BASE_URL=http://host.docker.internal:11434`, GPU blogu yorumda. Imaj host Chroma/Ollama'ya karsi denendi (`/ready` ok, admin 200); Tam yigin (bundled Ollama, `bonsai-2:2b` + `embeddinggemma-2:270m`) temiz klonda uctan uca kosuldu: ilk kurulum ~79 dk (cogu Ollama imaji + model indirme), `/ready` ok, koleksiyon olustur -> reindex (10 sn) -> query calisti; `down`/`up` sonrasi koleksiyon, vektorler ve modeller korundu (yeniden baslatma 12 sn). Bu testte bulunan iki hata duzeltildi: kucuk modellerin bozuk yazdigi `NO_ANSWER_FROM_CONTEXT` isareti cevaba sizmiyor; kaynaklardaki `sourcePath` proje kokune gore goreli donuyor (`/app/data/...` yerine `data/...`). `NODE_ENV=production` bilerek set edilmiyor (Secure cookie HTTP'de admin login'i bozar).
- **Chat LLM istege bagli ve saglayicidan bagimsiz (eski P0 #1)** - 2026-11-08. `/query` icin tek, global bir chat LLM: `chat.baseUrl` + `chat.model` (+ API anahtari), LangChain `ChatOpenAICompletions` ile OpenAI uyumlu herhangi bir API (Ollama `/v1`, LM Studio, vLLM, OpenAI, OpenRouter). Ayarlanmazsa `/query` 503 `CHAT_NOT_CONFIGURED`, `/retrieve` ve indexing tam calisir; repo ve Docker varsayilani retrieve-only. Anahtar `RAG_CHAT_API_KEY` ya da `.local/rag_chat_api_key.secret` (YAML'a hic yazilmaz, hatalardan maskelenir). Model parametreleri gonderilmez (saglayici varsayilanlari); `temperature` / `maxTokens` / `maxContextTokens` YAML'da elle verilebilir. Koleksiyon bazli `chatModel` kaldirildi (API 400, `chat_model` kolonu migration ile silindi). `/ready`: yeni `retrieve` yetenegi, retrieve-only kurulum `ready: true` (`retrieve-and-index`); chat kontrolu ucretsiz `GET /models` (30 sn onbellek), gercek uretim testi sadece onboarding'de. Saglayici hatalari `CHAT_PROVIDER_UNREACHABLE` (503) / `CHAT_PROVIDER_ERROR` (502). Onboarding sadece base URL, model ve anahtar soruyor. Docker'da chat modeli sadece gomulu Ollama'yi gosteriyorsa iniyor. Prompt alandan bagimsiz hale geldi (eski: Turkce vergi ozelgeleri). Semafor kuyruk zaman asimi artik 500 degil 503 `MODEL_BACKPRESSURE`. Eski `ollama.chatModel` / `numCtx` / `numPredict` ve `RAG_OLLAMA_CHAT_MODEL` yok sayiliyor (uyari basiliyor, chat kendiliginden acilmiyor).
- **Embedding saglayicisi: builtin + OpenAI uyumlu; Ollama'nin kaldirilmasi (eski P0 #5)** - 2026-11-09. Kararlar (2026-11-08 tartismasi): kullanici secer; varsayilan `builtin`; yerel model ilk kullanimda iner (imaja gomulmez); koleksiyon bazli model kalir; "parmak izi" yok; gomulu Ollama Docker'dan kalkar; geriye donuk uyumluluk yok. Uygulama:
  - `builtin`: `onnx-community/embeddinggemma-2-ONNX` (q8, ~346 MB) transformers.js v4 ile backend icinde CPU'da; kendi `BuiltinEmbeddings` sinifi (LangChain'in `HuggingFaceTransformersEmbeddings`'i transformers.js v3'e sabit, `batchSize`'i yok sayiyor, sorgu/dokuman oneki yok). Model ilk indekslemede `embedding.cacheDir`'a (`models/`) iner; dtype ve onekler katalogda sabit.
  - `openai-compatible`: `OpenAIEmbeddings` (float encoding), tek global `embedding.baseUrl`; anahtar `RAG_EMBEDDING_API_KEY` ya da `.local/rag_embedding_api_key.secret`.
  - Her koleksiyon `{embeddingProvider, embeddingModel}` (istenen + aktif) sakliyor; okumalar her zaman aktif cifti kullaniyor, global ayar sadece yeni koleksiyonlarin varsayilani. Saglayici degisikligi `reindex_required`.
  - Config `ollama` -> `embedding` (provider, model, baseUrl, cacheDir), `RAG_EMBEDDING_*`; eski legacy kod silindi. `/ready`, preflight ve validation ucuz kontroller (katalog + onbellek ya da ucretsiz `GET /models`); inmemis builtin model sadece uyari. Yeni hata kodlari `EMBEDDING_PROVIDER_*`, `EMBEDDING_DIMENSION_MISMATCH` (409, eskiden 500). `/v1/admin/models` saglayici bazli katalog. Onboarding acik saglayici secimi soruyor, builtin'i indirmiyor. Docker: backend + Chroma, `./models` volume, `ONNXRUNTIME_NODE_INSTALL=skip`. Chat ve embedding `src/providers/openaiCompatible.ts`'i paylasiyor.
  - Swap duzeltmesi: aktif embedding ve snapshot'taki embedding alanlari artik job'in gercekten kullandigi modelden geliyor (once snapshot koleksiyonun o anki istenen modelini yaziyordu).
- **Onboarding hata akisi** - 2026-11-08. Bagimlilik/kaynak eksiklerinde durmuyor; "Config saved; fix these before indexing" altinda her eksik icin tek satir cozum yaziyor, "Next steps"i her zaman gosteriyor, exit code 0. `--skip-index` deprecated.

## Urun yonu ve hedef kitle

Karar (2026-11-08): repo, **kendi sunucunda calisan, LLM'den bagimsiz bir dokuman retrieval servisi** olarak konumlaniyor. Cevap uretme (`/query`) opsiyonel bir eklenti.

Oncelikli kullanicilar:

- **A. Kendi uygulamasini yapan gelistirici** (chatbot, ic arac): dokumanlarini yukler, API anahtariyla ilgili chunk'lari alir, LLM'i kendisi secer.
- **C. AI asistani / ajan kullanan gelistirici** (Claude Desktop, Claude Code, Cursor): retrieve'i MCP araci olarak kullanir.
- **D. RAG'i ogrenmek isteyen**: okunabilir, framework'e gomulmemis, iyi dokumante bir referans uygulama. Kodu sade ve aciklamali tutmak bu kitleye hizmet eder.

Sonraya birakilan: **B. Dokumanlariyla sohbet etmek isteyen teknik olmayan kullanici.** Sohbet arayuzu, retrieval servisi oturduktan sonra API'nin ustune eklenecek. Bunun icin `/query` ve Ollama destegi kaldirilmayacak, sadece opsiyonel hale getirilecek.

## Elestiriler: altyapi agir, giris kapisi zayif

Yonetim tarafi kurumsal duzeyde (blue/green reindex, job kuyrugu, RBAC, CSRF, audit log, detayli readiness), ama disaridan birinin ilk ihtiyac duyacagi seyler eksik. Asagidaki maddeler P0'da kapatilacak:

- **Public API'de kimlik dogrulama yok.** `/v1/rag/**` herkese acik; tenant `x-tenant-id` header'indan okunuyor, yoksa `default` (`src/http/requestContext.ts`). Herkes header'i degistirerek baska bir tenant'in verisini sorgulayabilir; multi-tenant yapi bu haliyle guvenli degil. -> P0 #2
- **CORS yok.** Baska bir adresteki web uygulamasi API'yi tarayicidan cagiramiyor (test frontend ayni adresten sunuldugu icin calisiyor). -> P0 #2
- **Dokuman yukleme/silme yok.** Dokumanlar sunucu diskine (`./data/...`) elle konuyor; API veya panelden yukleme, silme, listeleme yok. Docker'da ve uzak sunucuda cok zahmetli. -> P0 #3
- ~~**Zorunlu chat modeli.**~~ Kapatildi (P0 #1): chat LLM istege bagli ve saglayicidan bagimsiz. ~~Embedding sadece Ollama~~ da kapatildi (P0 #5).
- **Builtin embedding indekslemesi semafor disinda.** `addDocuments` `maxConcurrentEmbeddings` semaforunun altinda degil; builtin model CPU'da calistigi icin buyuk bir indeksleme eszamanli sorgulari yavaslatabilir. Olcum yapilmadigi icin onceden cozum eklenmedi; gercek kullanimda gorulurse indeksleme batch'leri semafora alinmali. -> P1
- **Index snapshot'inda kaynak yolu ve chunk alanlari job anindan alinmiyor.** Swap'ta embedding alanlari duzeltildi, ama `sourcePath`, `chunkSize`, `chunkOverlap`, `distanceMetric` hala koleksiyonun o anki degerinden yaziliyor; job bunlari saklamiyor. Job calisirken bu ayarlar degisirse snapshot yanlis olur. Cozum: job'a bu alanlarin hedef degerlerini eklemek. -> P1
- **Indexing hep tam.** Tek dosya degisse de butun koleksiyon yeniden isleniyor; dosya formatlari dar. -> P0 #6, P1 #5

## Acik tartismalar (karar bekliyor)

Su an acik tartisma yok. Embedding saglayicisi ve gomulu Ollama konusu 2026-11-08'de karara baglandi ve uygulandi (bkz. "Tamamlananlar").

## P0 - Urun hedefi icin kritik eksikler

Hedef: baskalarinin repoyu GitHub'dan indirip kendi verisiyle kolayca kullanabilmesi (once A, C, D). Olcut: yeni bir kullanicinin kendi dokumanlarindan ilk sonucu almasi ne kadar zahmetsiz ve guvenli?

### 1. Chat modelini opsiyonel yap (tamamlandi)

2026-11-08'de tamamlandi; ayrintilar "Tamamlananlar"da. Numaralar diger maddelere referans icin korunuyor.

### 2. Public API icin API anahtari ve CORS

Yapilacaklar:

- `/v1/rag/**` icin API anahtari (`Authorization: Bearer ...` veya `x-api-key`); anahtarlar hash'lenerek saklanir, admin panelden olusturulur/iptal edilir.
- Tenant header'dan degil, anahtardan belirlenir; `x-tenant-id` ile baska tenant'a erisim kapanir.
- Koleksiyon bazli yetki (bir anahtar hangi koleksiyonlari okuyabilir) dusunulsun.
- Config ile CORS izinli origin listesi.
- Anahtarsiz kullanim sadece acikca izin verilirse (lokal gelistirme) mumkun olsun.

### 3. Dokuman yonetimi: yukleme, silme, listeleme

Yapilacaklar:

- Admin API: bir koleksiyona dosya yukleme (multipart), dosyalari listeleme, silme, degistirme.
- Admin panelde ayni islemler (surukle-birak yukleme, dosya listesi, silme).
- Boyut ve format limitleri, dosya adi guvenligi (path traversal), tenant izolasyonu.
- Yukleme/silme sonrasi reindex akisi; ileride incremental indexing ile (P1 #5) sadece degisen dosyalar islenir.
- Mevcut "sunucu klasoru" (`sourcePath`) kullanimi da desteklenmeye devam etsin.

### 4. MCP sunucusu

Yapilacaklar:

- Koleksiyonlari listeleme ve retrieve'i MCP araclari olarak acan bir MCP sunucusu (stdio ve/veya HTTP).
- Claude Desktop / Claude Code / Cursor icin kurulum ornegi README'de.
- API anahtari (P0 #2) ile kimlik dogrulama.

### 5. Degistirilebilir embedding saglayicisi (tamamlandi)

2026-11-09'da tamamlandi; ayrintilar "Tamamlananlar"da. Numaralar diger maddelere referans icin korunuyor.

### 6. Dosya formati destegi dar

Sorun:

- Sadece `txt`, `md`, `pdf`, `doc`, `docx` destekleniyor. Ozelge adapter'i kalkinca JSON destegi tamamen gitti.
- Son kullanici verisinde yaygin olan CSV, JSON/JSONL ve HTML desteklenmiyor; bu dosyalar "unsupported" olarak atlaniyor.

Yapilacaklar:

- HTML loader (metni cikar, script/style at).
- CSV ve JSONL loader'lari; satir/kayit basina belge.
- Generic JSON mapping: `contentField`, `idField`, `metadataFields` benzeri koleksiyon ayarlari; nested alanlar icin JSON pointer/path; yanlis mapping'de anlasilir hata.
- Desteklenen formatlari README'de ve admin panelde net goster.

### 7. CI pipeline (cekirdegi tamamlandi)

2026-11-14: `.github/workflows/ci.yml` her push/PR'da `npm ci` + `typecheck` + `typecheck:test` + `npm test` kosuyor; main'de ve `v*` etiketlerinde Docker imajini (amd64 + arm64) ghcr.io'ya yayinliyor. Kalanlar: `npm run build` adimi, integration testleri icin ayri job, lint (P2 #1).

Sorun (eski):

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

- Yeni formatlar (HTML, CSV, JSONL, generic JSON) P0 #6'da.
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

- `/ready`; Chroma, embedding saglayicisi (builtin: katalog + onbellek; dis servis: ucretsiz `GET /models`), chat saglayicisi ve veri kaynagi okunabilirligini raporluyor; gercek embedding/chat testi sadece onboarding'de. Koleksiyon bazli `/v1/rag/collections/:id/ready` de var.
- Retrieved context iceren gercek bir query probe'u yok. Bazi modeller kisa chat smoke'unda saglikli gorunup gercek RAG akisinda bos/kirik cevap verebiliyor (ozellikle model degisiminden sonra).
- Startup fail-fast / warmup modu yok; sunucu bagimliliklar hazir olmasa da ayaga kalkiyor.

Yapilacaklar:

- Retrieved context kullanan gercekci, opsiyonel bir smoke query tanimla (readiness akisinda).
- Modeller icin kisa bir compatibility notu/matrisi tut.
- Startup fail-fast veya warmup modu eklenip eklenmeyecegine karar ver; readiness ile startup davranisi arasindaki sozlesmeyi yaz.

## P2 - Gelistirici deneyimi ve repo bakimi

### 1. Lint ve format adimi yok

- ESLint ekle; Prettier veya mevcut stili standardize et.
- CI zincirine ekle (P0 #7).

### 2. Opsiyonel degerlendirme (benchmark) araci

Karar (2026-11-08): soru seti ve "dogru cevap" tanimi son kullanicinin isi; backend en fazla bunu kosacak opsiyonel bir arac sunabilir. Eski ozelge benchmark'i silindi.

Yapilacaklar (istenirse):

- Basit bir soru dosyasi formati (soru, beklenen kaynak dosya, opsiyonel beklenen cevap, "cevap yok" beklentisi).
- `npm run eval -- --collection-id <id> --questions <file>`: her soru icin query + retrieve; hit@k, no-answer dogrulugu ve cevap/kaynak tablosu (JSON + markdown).

### 3. Konfigurasyon dogrulamasi

- `retrievalK` ve `chat.maxTokens` icin operasyonel ust sinirlar yok.
- Model degisikliginin restart / re-index etkisini config contract'ina bagla.

### 4. README: bilinen sinirlar bolumu yok

- "Known limitations" bolumu ekle:
  - retrieval kalitesi baseline (rerank / filtre yok)
  - incremental indexing yok
  - builtin embedding CPU'da calisir; buyuk veri setlerinde dis servis (Ollama, OpenAI) daha hizli
  - saglayici veya model degisikligi reindex gerektirir
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

Urun yonune (A, C, D) gore:

1. ~~Chat modelini opsiyonel yap (P0 #1).~~ Tamamlandi (2026-11-08).
2. Public API'ye API anahtari ve CORS (P0 #2). Tenant anahtardan belirlenir; urun olarak dagitmadan once sart.
3. Dokuman yonetimi: admin API ve panelden yukleme/silme/listeleme (P0 #3).
4. MCP sunucusu: retrieve'i AI asistanlarina arac olarak ac (P0 #4).
5. ~~Degistirilebilir embedding saglayicisi (P0 #5).~~ Tamamlandi (2026-11-09).
6. Dosya formatlari (P0 #6) ve incremental / upsert indexing (P1 #5).
7. ~~CI pipeline (P0 #7)~~ cekirdegi tamamlandi (2026-11-14); kalanlar P0 #7'de.
8. ~~Ilk kurulum deneyimi~~ tamamlandi (2026-11-14: seviyeli README, ornek koleksiyon, hazir imaj, kisa onboarding). Kalan: README "bilinen sinirlar" ve LICENSE.
9. Readiness icin gercek RAG smoke probe.
10. Sohbet arayuzu (B kitlesi), API'nin ustune.
11. Test coverage bosluklari, lint, opsiyonel degerlendirme araci.

## Kapanis notu

Repo artik "calisan bir baseline vanilla RAG backend" seviyesini gecti: multi-collection, multi-tenant, auth'lu admin API, guvenli blue/green reindex ve genis test kapsami var.
Tek komutla kurulum (Docker) artik var; baskalarinin kendi verisiyle kullanabilmesi icin chat LLM artik istege bagli (retrieve-only varsayilan); siradaki oncelik urun yonune gore (A, C, D): public API guvenligi (API anahtari + CORS), dokuman yonetimi ve MCP.
