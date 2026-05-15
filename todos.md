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

### 1. Benchmark verisi var, benchmark kosusu yok

Sorun:
- `bencmark/benchmark.json` ve `bencmark/benchmark.schema.json` repoda duruyor.
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
  - `index.ts`: veri dosyasi array degilse hata verme, bos `pdfText` kayitlarini eleme
- Endpoint contract testlerini acikca ekle:
  - `POST /rag/retrieve`: basarili body
  - `POST /rag/retrieve`: invalid body
  - `GET /rag/retrieve`: `405`
  - `GET /rag/query`: `405`
  - `GET /ready` ile `GET /ready?strict=true` semantik farki
- Chroma ve Ollama bagimliliklari icin gerekirse mock katmani kur.

### 3. Index varsayilan olarak tum veri yerine sadece ilk 100 kaydi kullaniyor

Sorun:
- `data.indexSampleSize` varsayilan olarak `100`.
- Bu, sistemin veri setinin tamami yerine orneklem ustunde calistigi anlamina geliyor.
- Demo icin kabul edilebilir; ama "repo hazir" demek icin bu varsayim net olarak ele alinmali.

Neden onemli:
- Kullanici, veri klasorunde ne varsa indexlenecegini varsayabilir.
- Orneklem kullanimi retrieval kalitesini sessizce dusurebilir.

Yapilacaklar:
- Varsayilan davranisi acik secik belirle:
  - ya tam veri indexle
  - ya da sample mode'u sadece gelistirme modu icin kullan
- `README.md` ve `config/rag.config.json` icinde bu farki belirginlestir.
- `data.indexSampleSize` icin `0 = tum veri` gibi daha net bir semantik dusun.

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
- Su an dogrudan `similaritySearch(question, k)` calisiyor.
- Score threshold, reranking, MMR, metadata filtering veya query expansion yok.

Neden onemli:
- Vanilla RAG icin bu normaldir, ama kalite siniri da burada baslar.
- Benzer ama baglam disi chunk'lar kolayca ust siralara cikabilir.

Yapilacaklar:
- En azindan retrieval score'larini gorunur hale getir.
- Mumkunse `similaritySearchWithScore` benzeri bir akisla kaliteyi gozlemle.
- Metadata ile filtreleme imkanini dusun (tarih, konu, belge id).
- Gerekirse ikinci adim reranker eklemek icin yapiyi hazirla.

### 5.1. `POST /rag/retrieve` response'u retrieval metadata acisindan halen zayif

Sorun:
- Retrieval-only endpoint artik var.
- Ancak response yuzeyi score, rank, chunk index veya daha zengin metadata gostermiyorsa debug ve benchmark icin sinirli kaliyor.

Neden onemli:
- Retrieval endpoint'in asil degeri, generation'dan bagimsiz kalite gozlemi saglamasidir.
- Hangi chunk neden ust siraya cikti sorusu cevapsiz kalirsa endpoint'in debug degeri duser.

Yapilacaklar:
- Mumkunse score bilgisini response'a ekle.
- Her kaynak icin rank ve anlamli metadata alanlarini netlestir.
- Benchmark raporu ile `POST /rag/retrieve` response seklinin uyumlu kalmasini sagla.

### 6. Chunking ve ingestion kalitesi temel seviyede

Sorun:
- Ingestion akisi `src/index.ts` icinde tek bir JSON dosyasina ve o dosyanin ozelge semasina dogrudan bagli.
- Veri kaynagi `config.data.ozelgeDataPath` altindaki tek bir dosyadan okunuyor; JSON array disindaki formatlar desteklenmiyor.
- Dokuman icerigi sadece `pdfText` alanindan aliniyor; `evrakOid`, `sayi`, `tarih`, `konu` alanlari da dogrudan bu veri semasina gore map ediliyor.
- `src/server.ts` readiness ve operator mesajlari da `non-empty pdfText` varsayimina bagli; yani ingestion kisiti sadece index script'inde degil, operasyonel yuzeyde de gorunur durumda.
- Metin normalization, OCR artigi temizleme, tekrarli whitespace temizligi, header/footer ayiklama gibi adimlar yok.
- Her chunk sadece temel metadata tasiyor.

Neden onemli:
- Bugunku haliyle repo baska bir kullanicinin kendi veri klasorunu koyup dogrudan indexleyebilecegi bir vanilla RAG backend degil; ozelge JSON semasina uyarlama gerektiriyor.
- Vanilla RAG tarafinda beklenen taban yetenek, ingestion katmaninin kaynak formattan olabildigince ayrismis olmasi ve farkli dosya tiplerini ortak `Document` modeline cevirebilmesidir.
- LangChain tarafinda bunun dogal yolu `DocumentLoader` soyutlamasini kullanmak; loader'lar ortak `load()` / `loadAndSplit()` arayuzu verir ve PDF, CSV, JSON, JSONL, text, DOCX gibi farkli kaynaklara ayni ingestion zinciriyle baglanmayi kolaylastirir.
- Ozelge gibi yapisal belgelerde girdi kalitesi retrieval kalitesini dogrudan etkiler.
- Kirik veya gereksiz metinler embedding kalitesini dusurur.

Yapilacaklar:
- Ingestion akisinin alan-adina bagli kismini ayir:
  - `loadOzelgeRecords()` / `toDocuments()` ikilisini daha genel bir `loadSourceDocuments()` abstraction'ina donustur.
  - Ozelge JSON mapping'i genel pipeline'in icinde degil, ayri bir adapter olarak konumlansin.
- LangChain `DocumentLoader` tabanli bir ingestion katmani tasarla:
  - Dosya tipi secimine gore loader kullanan bir katman ekle.
  - Baslangic icin en az su formatlari degerlendir: `txt`, `md`, `pdf`, `json`, `jsonl`, `csv`, `docx`.
  - Tek dosya ve klasor ingestion senaryolarini ayir; gerekirse `DirectoryLoader` veya `MultiFileLoader` benzeri bir kompozisyon kullan.
- JSON ingestion icin sema bagimliligini config'e tasi:
  - `contentField`, `idField` ve `metadataFields` benzeri ayarlar dusun.
  - Mumkunse nested alanlar icin JSON pointer/path semantigi belirle.
  - Boylece kullanici kendi JSON dosyasini kod degistirmeden esleyebilsin.
- Ingestion sonucu uretilen ortak `Document` contract'ini netlestir:
  - `pageContent`
  - normalize edilmis metadata
  - `sourceType`, `sourcePath`, `documentId`, `chunkIndex` gibi alanlar
- Indexleme oncesi basit bir text normalization katmani ekle.
- Sayfa numarasi, belge bolumu, paragraf tipi gibi ek metadata alanlarini dusun.
- Ayni belge icindeki tekrar eden veya asiri kisa chunk'lari filtrele.
- Readiness ve operator mesajlarini sema-ozel dilden kurtar:
  - `non-empty pdfText` yerine `indexable document content` dili kullan.
  - `DATA_FILE_UNREADABLE` ve `NO_INDEXABLE_DOCUMENTS` mesaji, loader / source config mantigina gore yeniden yazilsin.
- CLI ve config yuzeyini ingestion acisindan genislet:
  - `data.sourcePath` veya `data.sourcePaths`
  - `data.sourceType` veya otomatik extension tabanli tespit
  - `data.loaderOptions`
  - `data.indexSampleSize` semantiginin loader-based ingestion ile uyumunu netlestir
- Testleri bu yeni capability etrafinda ekle:
  - Farkli dosya tiplerinden `Document` uretimi
  - Yanlis JSON field mapping durumunda anlasilir hata
  - Bos klasor / unsupported extension / bozuk dosya senaryolari
  - Readiness mesajlarinin `pdfText` gibi source-specific alan adlarina bagli olmamasi

### 6.1. Ingestion capability'si vanilla RAG beklentisinin gerisinde

Sorun:
- Repo retrieval ve generation tarafinda calisiyor olsa da ingestion capability'si halen tek dataset, tek sema ve tek dosya formatina yakin.
- Kullanici kendi veri klasorunu repoya koydugunda "hangi dosyalar destekleniyor, nasil parse ediliyor, metadata nasil cikariliyor" sorularina sistem seviyesinde cevap yok.

Neden onemli:
- Vanilla RAG'in pratikte tekrar kullanilabilir olmasi icin en kritik unsur, veri kaynagini modele degil `Document` katmanina standartlastirmasidir.
- Ingestion esnek degilse repo sadece mevcut veri seti icin calisan bir demo olarak kalir.

Yapilacaklar:
- README ve mimari dokumanda desteklenen ingestion kaynaklarini acik listele.
- "Supported loaders" ve "custom JSON mapping" bolumu ekle.
- Ornek veri klasoru yapilari ver:
  - tek JSON dosyasi
  - klasorde birden fazla PDF/TXT/DOCX dosyasi
  - mixed-source ingestion icin gelecek plan
- Ilk hedefte hangi formatlar resmi olarak desteklenecek, hangileri backlog'da kalacak bunu netlestir.

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
- Loglar faydali ama halen temel seviyede.
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

### 12. `bencmark/` klasor adi hatali yazilmis

Sorun:
- Klasor adi `benchmark` yerine `bencmark`.
- Fonksiyonel olarak calismayi bozmasa da repo profesyonelligini ve aranabilirligi dusuruyor.

Yapilacaklar:
- Klasoru `benchmark/` olarak yeniden adlandir.
- Referanslari ve dokumani guncelle.

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
  - `indexSampleSize` icin `0 = tum veri` gibi yeni semantik gelirse bunun validation'i

## Sonraki oncelikli uygulama sirasi

1. Benchmark runner ekle.
2. Unit ve integration testlerini ekle.
3. Full-data indexing davranisini netlestir.
4. Retrieval observability ve request/log standardizasyonunu ekle.
5. Readiness'i gercek RAG akisina daha yakin probe'larla guclendir.

## Kapanis notu

Bu repo su anda "calisan bir baseline vanilla RAG backend" seviyesinde.
"Guvenle olculebilen, bakimi kolay, genisletilebilir bir backend" seviyesine cikmak icin yukaridaki maddeler tamamlanmali.
