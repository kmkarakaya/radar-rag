# RAG Admin Panel Development Plan

Bu plan, `C:\Codes\Vanilla Rag Backend` reposundaki mevcut backend kontratlarına göre hazırlanmıştır. Amaç, mevcut statik admin panelini adım adım daha güvenilir bir operasyon paneline dönüştürmektir.

En önemli kapsam kuralı: admin panel geliştirme adımlarında backend endpointleri, router'lar, schema'lar veya test kontratları değiştirilmeyecek. Kod değişiklikleri yalnızca `admin/index.html`, `admin/admin.js` ve `admin/admin.css` içinde yapılacak. Bu dosya plan dokümanıdır; uygulama adımlarını çalıştıracak coding agent her adımda sadece `admin/` dizinine dokunmalıdır.

## Repo Gerçeği

Mevcut admin panel zaten şu dosyalardan oluşuyor:

- `admin/index.html`: Tailwind CDN ile çalışan statik shell, sidebar, collections/jobs/health view, inspector panel, editor form.
- `admin/admin.js`: API client, view state, collection list, inspector, readiness, playground, settings save, reindex/delete, health view, jobs placeholder.
- `admin/admin.css`: küçük animasyon ve scrollbar override'ları.

Panel Express tarafından `src/app.ts` içinden `app.use("/admin", express.static(...))` ile servis ediliyor. Geliştirme ve manuel test URL'i:

```text
http://localhost:3010/admin/
```

Bu repo admin panel için ayrı frontend build sistemi kullanmıyor. Bu nedenle doğrulama, statik JS syntax kontrolü, backend build/test komutları ve tarayıcı manuel testi ile yapılmalı.

## Mevcut HTML ve JS Envanteri

Coding agent her adımda bu mevcut yapıyı baz almalı. Gereksiz büyük HTML rewrite yapılmamalı; yeni UI parçası gerekiyorsa mevcut bölüme küçük, isimlendirilmiş elementler eklenmeli ve `admin/admin.js` içindeki `elements` map'i güncellenmeli.

### Mevcut Ana Layout

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Sidebar nav | `.nav-item[data-view="collections/jobs/health"]` | `switchView(viewId)` bu dataset'i kullanıyor. |
| View container | `.view-container`, `#view-collections`, `#view-jobs`, `#view-health` | View göster/gizle bu id pattern'ine bağlı. |
| Başlık | `#viewTitle` | `switchView` güncelliyor. |
| Global refresh | `#btnRefresh` | Collection, job ve health reload tetikliyor. |
| Create button | `#btnCreateCollection` | `openInspector(null)` çağırıyor. |

### Collections View

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Collection grid | `#collectionsGrid` | Mevcut kod string template ve inline `onclick` ile card basıyor. Hedef: güvenli DOM node üretimi ve delegated/event listener. |

### Jobs View

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Job table body | `#jobsTableBody` | Mevcut table header 4 kolon: Job ID, Collection, Status, Actions. Daha fazla kolon eklenecekse `admin/index.html` içindeki `<thead>` de aynı adımda güncellenmeli. |

### Health View

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Health card grid | `#healthGrid` | Summary cards burada render ediliyor. |
| Readiness detail | `#readinessDetail` | Recommended actions/checks/blockers için kullanılacak. |

### Inspector

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Overlay | `#inspectorOverlay` | Overlay click kapatır. Panel overlay'in child'ı değil sibling olduğu için panel click'i normalde overlay'e bubble etmez. |
| Panel | `#inspectorPanel` | Slide-out transform class'ları burada. |
| Title | `#inspectorTitle` | Create/edit mode'a göre güncellenir. |
| Status badge | `#inspectorStatusBadge` | Create mode'da gizlenmeli. |
| Close button | `#btnCloseInspector` | Mevcut handler var. |
| Tab buttons | `.tab-btn[data-tab="ready/playground/editor"]` | `tab-${data-tab}` id pattern'i ile content seçiyor. |
| Tab contents | `#tab-ready`, `#tab-playground`, `#tab-editor` | Create mode'da ready/playground devre dışı bırakılabilir. |

### Inspector Readiness

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Status grid | `#readinessStatusGrid` | Collection readiness indicator'ları. |
| Blockers container | `#readinessBlockers` | Backend collection readiness `blockers` dönmez; UI türetilmiş blocker mesajlarını burada gösterir. |
| Blocker list | `#blockerList` | Güvenli DOM node ile doldurulmalı. |

### Playground

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Mode buttons | `.mode-btn[data-mode="retrieve/query"]` | State ile senkron tutulmalı. |
| Question textarea | `#pgQuestion` | Boş soru API'ye gönderilmemeli. |
| Run button | `#btnPgRun` | Readiness capability'ye göre disabled/loading olmalı. |
| Result area | `#pgResult` | Raw JSON yerine answer/source render. Backend text için `textContent`. |

Not: Mevcut HTML'de retrieve `k` input'u yok. Eklenirse önerilen id `#pgK`; aynı adımda `elements.pgK = document.getElementById("pgK")` eklenmeli ve yoksa kod graceful çalışmalı.

### Editor

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Form | `#colEditForm` | Submit `saveCollection` çağırıyor. |
| Hidden id | `#editId` | Empty ise create mode. |
| Text fields | `#editDisplayName`, `#editDescription`, `#editSourcePath`, `#editOzelgeDataPath`, `#editEmbeddingModel`, `#editChatModel` | Empty string payload'a gitmemeli. |
| Number fields | `#editChunkSize`, `#editChunkOverlap`, `#editRetrievalK`, `#editRetrievalDistanceThreshold` | `0` geçerli olabilecek alanlarda `|| undefined` kullanılmamalı. |
| Select | `#editDistanceMetric` | Sadece `l2`, `cosine`, `ip`. |
| Cancel | `#btnCancelEdit` | HTML'de var, ancak mevcut `elements` map'inde yok; ilgili adımda eklenip handler bağlanmalı. |

### Inspector Footer ve Toast

| Alan | Mevcut selector / id | Kullanım notu |
| :--- | :--- | :--- |
| Re-index | `#btnReindex` | Create mode'da disabled/gizli. Çift tıklama engellenmeli. |
| Delete | `#btnDeleteCol` | Create mode'da disabled/gizli. Confirmation zorunlu. |
| Toast container | `#toastContainer` | Uzun hata ve issue listesi taşmayacak şekilde render edilmeli. |

### Mevcut JS Fonksiyonları

Mevcut `admin/admin.js` fonksiyon adları:

- `apiRequest`
- `showToast`
- `getStatusBadge`
- `switchView`
- `loadCollections`
- `renderCollections`
- `openInspector`
- `closeInspector`
- `updateReadinessTab`
- `setupEditorTab`
- `saveCollection`
- `runPlayground`
- `reindexCollection`
- `deleteCollection`
- `loadJobs`
- `loadHealth`

Küçük model için tercih edilen strateji: bu fonksiyonları bir anda tamamen silip yeniden yazmak yerine, adımın ihtiyacı kadar genişletmek. Bir fonksiyon komple değiştirilecekse çağrı noktaları aynı adımda kontrol edilmeli.

## Değiştirilmeyecek Backend Kontratı

Admin panel sadece mevcut endpointleri kullanacak:

| Amaç | Method | Endpoint | Not |
| :--- | :--- | :--- | :--- |
| Collection listesi | GET | `/v1/rag/collections` | Ucuz registry discovery. Chroma/Ollama probe çalıştırmaz. |
| Collection detayı | GET | `/v1/rag/collections/:collectionId` | Public DTO. Mevcut kod bazı settings alanlarını döndürüyor; agent response alanı yoksa graceful fallback yapmalı. |
| Collection readiness | GET | `/v1/rag/collections/:collectionId/ready` | `capabilities`, `modelAvailability`, `activeJob`, `chromaReadable` döner. `blockers` array'i dönmez. |
| Retrieve testi | POST | `/v1/rag/collections/:collectionId/retrieve` | Body: `{ "question": string, "k"?: number }`. |
| Query testi | POST | `/v1/rag/collections/:collectionId/query` | Body: `{ "question": string }`. |
| Collection oluşturma | POST | `/v1/admin/collections` | Body: `createCollectionSchema`. `displayName` zorunlu. |
| Collection güncelleme | PATCH | `/v1/admin/collections/:collectionId` | Body: `updateCollectionSchema`. Sadece değişen/valid alanlar gönderilmeli. |
| Collection silme | DELETE | `/v1/admin/collections/:collectionId` | `204 No Content`. Soft delete. |
| Re-index başlatma | POST | `/v1/admin/collections/:collectionId/reindex` | `202`, `{ job }` döner. Aynı collection için ikinci aktif job `409 COLLECTION_INDEX_ALREADY_RUNNING`. |
| Job detayı | GET | `/v1/admin/jobs/:jobId` | Sadece bilinen `jobId` ile çalışır. Job list endpointi yok. |
| Job iptal | POST | `/v1/admin/jobs/:jobId/cancel` | Sadece `queued` veya `running` job için. Başarılıysa `204`. |
| Liveness | GET | `/health` | Process ayakta mı. |
| Sistem readiness summary | GET | `/ready` | Non-strict çağırılmalı; hazır değilse de 200 dönebilir. |
| Sistem readiness detay | GET | `/ready?details=true` | `checks`, `blockers`, `warnings`, `recommendedActions`, `dependencies`, `dataSource`. |

Opsiyonel request context header'ları backend tarafından destekleniyor:

- `x-request-id`
- `x-tenant-id`
- `x-user-id`

Admin panel default lokal akışta bu header'ları göndermek zorunda değil. Eğer ileride UI'da tenant/user seçimi eklenirse yalnızca `fetch` header'larına eklenmeli, backend değişmemeli.

## Response Semantiği

### Collection DTO

`GET /v1/rag/collections` her item için en az şu alanlara güvenilebilir:

- `id`
- `displayName`
- `description`
- `status`: `creating`, `indexing`, `ready`, `failed`, `archived`
- `chunkCount`
- `activeVersion`
- `updatedAt`
- `readyUrl`
- `queryUrl`
- `retrieveUrl`

Mevcut kod ayrıca settings alanlarını da döndürüyor:

- `sourcePath`
- `ozelgeDataPath`
- `embeddingModel`
- `chatModel`
- `distanceMetric`
- `chunkSize`
- `chunkOverlap`
- `retrievalK`
- `retrievalDistanceThreshold`

Coding agent bu alanları kullanabilir, ancak yokluklarına karşı dayanıklı yazmalıdır. Form save sırasında bilinmeyen veya boş alanları yanlışlıkla `undefined`, `null`, `NaN` ya da boş string olarak backend'e göndermemelidir.

### Collection Readiness DTO

`GET /v1/rag/collections/:id/ready` response shape:

- `id`
- `status`
- `hasActivePhysicalCollection`
- `activeVersion`
- `activeJob`: `null` veya `{ id, status }`
- `chromaReadable`
- `chromaCount`
- `modelAvailability.embeddingModel`
- `modelAvailability.embeddingModelAvailable`
- `modelAvailability.chatModel`
- `modelAvailability.chatModelAvailable`
- `modelAvailability.desiredEmbeddingModel` opsiyonel
- `capabilities.query`
- `capabilities.retrieve`
- `capabilities.reindex`

Bu endpoint `blockers` array'i döndürmez. UI blocker mesajlarını şu alanlardan türetmeli:

- `!hasActivePhysicalCollection`: "Aktif fiziksel collection yok; re-index çalıştırılmalı."
- `!chromaReadable`: "Chroma collection okunamıyor."
- `!modelAvailability.embeddingModelAvailable`: "Embedding modeli Ollama'da bulunamadı."
- `!modelAvailability.chatModelAvailable`: "Chat modeli Ollama'da bulunamadı."
- `activeJob`: job linki/durumu gösterilmeli.
- `capabilities.retrieve === false`: retrieve butonu disabled.
- `capabilities.query === false`: query butonu disabled.

### Job DTO

`GET /v1/admin/jobs/:jobId` response:

- `job.id`
- `job.collectionId`
- `job.status`: `queued`, `running`, `succeeded`, `failed`, `cancelled`
- `job.targetPhysicalCollection`
- `job.targetVersion`
- `job.targetEmbeddingModel`
- `job.startedAt`
- `job.finishedAt`
- `job.error`
- `job.documentCount`
- `job.chunkCount`
- `job.createdAt`
- `job.updatedAt`

Plan ve UI hiçbir yerde `completed` status beklememeli; backend `succeeded` kullanıyor.

### Error DTO

Hatalar standart olarak şu shape ile gelir:

```json
{
  "error": "Request failed",
  "code": "INVALID_REQUEST_BODY",
  "message": "Invalid collection update payload",
  "requestId": "...",
  "details": {
    "issues": []
  }
}
```

Zod issue listesi `data.details.issues` altındadır. Mevcut admin JS'teki `data.issues` varsayımı düzeltilmeli.

## Endpoint Kullanım Rehberi

Bu bölüm, mevcut endpointlerin admin JS fonksiyonları tarafından nasıl kullanılacağını netleştirir. Coding agent yeni endpoint icat etmeyecek.

| UI / JS akışı | Kullanılacak endpoint | Başarı davranışı | Hata davranışı |
| :--- | :--- | :--- | :--- |
| `loadCollections` | `GET /v1/rag/collections` | `data.collections` array değilse boş liste kabul et. Collection listesi ucuz discovery'dir; readiness iddiası taşımaz. | Toast + view içi error state. |
| Optional detail reload | `GET /v1/rag/collections/:id` | Sadece seçili item listede yoksa veya list item tazelenmek istenirse kullan. Admin detail endpoint yok. | 404 ise inspector kapatılabilir ve liste reload edilir. |
| `openInspector(existingId)` | Önce list item, sonra readiness | Editor list item'daki alanlarla dolar. Settings alanı DTO'da yoksa field boş/placeholder kalır ve save payload'ında gönderilmez. | Inspector açık kalır, ilgili tab içinde hata gösterilir. |
| `updateReadinessTab` | `collection.readyUrl` veya `/v1/rag/collections/:id/ready` | `state.selectedReadiness` güncellenir. `activeJob` varsa known jobs'a merge edilir. | Readiness alanında hata göster; playground disabled kalır. |
| `saveCollection` create | `POST /v1/admin/collections` | `data.collection.id` ile toast; liste reload; create mode kapanabilir veya yeni item seçilir. | `details.issues` field bazlı gösterilir. |
| `saveCollection` update | `PATCH /v1/admin/collections/:id` | `data.collection` döner; selected/list state güncellenir. | 400/403/404 standart error panel/toast. |
| `deleteCollection` | `DELETE /v1/admin/collections/:id` | `204`; inspector kapanır; liste reload. | 403/404/500 mesajı göster. |
| `reindexCollection` | `POST /v1/admin/collections/:id/reindex` | `data.job` known jobs'a eklenir; Job Monitor ve readiness yenilenir. | `409 COLLECTION_INDEX_ALREADY_RUNNING` özel mesaj: active job zaten var; readiness/job monitor yenile. |
| `loadJobs` | `GET /v1/admin/jobs/:jobId` | Sadece known job id'leri poll edilir. Terminal status kalıcı gösterilir. | 404 ise local job "not found/inaccessible" olarak işaretlenir veya local monitor'dan kaldırma aksiyonu sunulur. |
| `cancelJob` | `POST /v1/admin/jobs/:jobId/cancel` | `204`; job ve collection reload. | `400 INVALID_JOB_STATUS` için buton disabled hale getir ve job reload. |
| `runPlayground` retrieve | `POST /v1/rag/collections/:id/retrieve` | `{ question, k? }`; sources list render. | RAG error code paneli. |
| `runPlayground` query | `POST /v1/rag/collections/:id/query` | `{ question }`; answer + sources render. | RAG error code paneli. |
| `loadHealth` | `/health`, `/ready`, `/ready?details=true` | Summary + detail render. `strict=true` kullanılmaz. | Details fail olursa summary korunabilir. |

Public collection DTO konusunda önemli not: repo içinde public DTO'nun zamanla daha sanitize hale gelmesine dair test/kontrat izleri var. Bu yüzden admin panel settings alanlarını list/detail response'unda her zaman var saymamalı. Mevcut backend döndürüyorsa kullan; döndürmüyorsa form alanını boş bırak ve boş değeri update payload'ına gönderme. Admin tarafında tam settings detail ihtiyacı, bu planın sonundaki "Admin Collection Detail Endpointi" önerisine bırakılmıştır.

## Global Uygulama İlkeleri

- Backend endpoint, schema, route path, response shape veya test beklentisi değiştirilmeyecek.
- Uygulama adımlarında yalnızca `admin/` altı dosyalar değiştirilecek.
- Eski endpoint stringleri kullanılmayacak: `/rag/query`, `/rag/retrieve`.
- `fetch` çağrılarında URL oluştururken mümkünse DTO'daki `readyUrl`, `queryUrl`, `retrieveUrl` kullanılacak; yoksa mevcut scoped endpoint pattern'ine fallback yapılacak.
- API hataları kullanıcıya `code`, `message`, `requestId` ve varsa `details.issues` ile gösterilecek.
- DOM'a backend'den gelen metinler `innerHTML` ile enjekte edilmeyecek. Collection adı, description, source content, error message gibi alanlarda `textContent` veya güvenli DOM node üretimi kullanılacak.
- `innerHTML` sadece statik, geliştirici tarafından yazılmış template parçalarında veya önceden escape edilmiş metinde kullanılabilir. Tercih: `document.createElement`.
- Numeric form alanlarında boş değer gönderilmeyecek. `0`, `NaN` ve boş string ayrımı doğru yapılacak.
- Create akışında `description` boşsa field hiç gönderilmeyecek. Update akışında description boşaltılıyorsa `null` gönderilebilir.
- Delete, cancel ve destructive re-index aksiyonlarında net confirmation kullanılacak.
- Loading, disabled, empty ve error state her API alanında açıkça gösterilecek.
- Job monitor sadece panelin bildiği job ID'leri poll edebilir. Backend'de job list endpointi olmadığı için "tüm job'lar" iddiası yapılmayacak.
- Her adım sonunda kullanıcıya ne değiştiği ve manuel olarak neyi test edeceği kısa anlatılacak.

## Küçük Model / Cold Start Uygulama Rehberi

Bu plan, her adımı ayrı bir coding agent oturumuna verilecek şekilde yazılmıştır. Qwen 3.x 30B gibi daha küçük bir modelle çalışırken şu kurallar uygulanmalı:

- Her oturum yalnızca tek adımı uygulasın. "Adım 3 ve 4'ü birlikte yap" şeklinde birleştirme yapılmasın.
- Her adımın başında agent önce ilgili dosyaları tekrar okusun; önceki oturum bağlamına güvenmesin.
- Adım kapsamı geniş görünüyorsa önce alt sıradaki ilk parçayı uygulasın, doğrulasın, sonra devam etsin.
- Büyük rewrite yerine mevcut fonksiyonlar ve mevcut DOM id'leri korunarak incremental edit yapılsın.
- Yeni HTML id'si eklenirse aynı adımda `elements` map'i ve tüm null guard'ları eklensin.
- Yeni endpoint ekleme veya backend dosyası düzenleme isteği hissedilirse durup plana geri dönsün; bu kapsamda izin yok.
- Her adım sonunda `node --check admin/admin.js` çalıştırılsın. Build çalışmazsa sebep raporlanmalı, backend dosyası değiştirilmemeli.
- Manuel test açıklaması kısa ve somut olmalı: hangi URL, hangi buton, beklenen görünüm.
- Agent final mesajında "dokunulan dosyalar", "çalıştırılan komutlar", "manuel test" ve "bilinen sınırlama" bilgilerini versin.

## Plan Tamlık Kontrol Listesi

Bu planın uygulanabilirliği şu sorularla kontrol edilecek:

- Var olan endpointlerin tamamı doğru method/path/body ile kullanılıyor mu?
- Hiçbir adım backend route/schema/test değiştirmeyi gerektiriyor mu?
- Job monitor, job list endpointi yokluğunu dürüst ele alıyor mu?
- Collection readiness için var olmayan `blockers` response'u beklenmiyor mu?
- Error issues `details.issues` üzerinden okunuyor mu?
- Mevcut HTML id'leri ve tab/view dataset pattern'leri korunuyor mu?
- `btnCancelEdit` gibi HTML'de var ama JS map'inde eksik elementler plana dahil mi?
- Her adım tek başına cold start yapılabilecek kadar sınırlı mı?
- Her adımın test ve manuel test çıktısı net mi?

## Ortak Doğrulama Komutları

Her coding adımı sonunda minimum:

```powershell
node --check admin/admin.js
npm.cmd run build
```

Değişiklik riskliyse veya backend kontratına yanlışlıkla dokunulmadığını doğrulamak gerekiyorsa:

```powershell
npm.cmd test
rg -n '"/rag/query"|"/rag/retrieve"|/rag/query|/rag/retrieve' admin
git diff -- admin
```

Manuel test için lokal servis:

```powershell
cd "C:\Codes\Vanilla Rag Backend"
docker compose up -d chroma
npm.cmd run dev
```

Tarayıcı:

```text
http://localhost:3010/admin/
```

## Adım 0 - Cold Start Audit ve Kapsam Kilidi

Bu adım kod değiştirmez. Coding agent repo durumunu okur, backend kontratını tekrar doğrular ve sadece `admin/` altında çalışacağını netleştirir.

### Yapılacaklar

- `git status --short` ile dirty worktree durumunu kontrol et.
- `admin/index.html`, `admin/admin.js`, `admin/admin.css` dosyalarını oku.
- `src/http/adminRouter.ts`, `src/http/ragRouter.ts`, `src/app.ts`, `src/http/errors.ts` dosyalarından endpoint kontratını doğrula.
- Mevcut admin panelindeki açık sorunları not et:
  - Job monitor sadece placeholder.
  - Error issues path'i yanlış.
  - Collection cards string template ile render ediliyor.
  - Readiness tab sadece inspector açıldığında otomatik yüklenmiyor; tab state ve refresh davranışı güçlendirilmeli.
  - Playground raw JSON gösteriyor; kullanıcı dostu kaynak/cevap görünümü yok.
  - Create mode'da reindex/delete aksiyonları gizlenmeli veya disabled olmalı.

### Kabul Kriteri

- Kod değişikliği yok.
- Agent sonraki adım için sadece `admin/` dosyalarını değiştireceğini final/update mesajında belirtir.

### Kullanıcıya Açıklanacak

"Bu adımda backend kontratını ve mevcut admin panel yapısını doğruladım. Backend endpointlerini değiştirmeden, sonraki adımlarda yalnızca `admin/` statik dosyalarını iyileştireceğim."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. First audit the current admin panel and backend API contracts. Do not edit files in this step. Read admin/index.html, admin/admin.js, admin/admin.css, src/http/adminRouter.ts, src/http/ragRouter.ts, src/app.ts, and src/http/errors.ts. Confirm that future implementation work must only touch files under admin/. Identify mismatches between the current admin UI and actual endpoints, especially job listing absence, collection readiness shape, job statuses, and error details. Finish with a concise summary and next-step risks.
```

## Adım 1 - API Client, State Model ve Güvenli Render Temeli

Amaç, sonraki adımlara sağlam temel hazırlamak. Görsel büyük değişiklik yerine `admin/admin.js` içindeki API ve render yardımcıları iyileştirilecek.

### Yapılacaklar

- `apiRequest` fonksiyonunu standartlaştır:
  - `204` için `null` döndür.
  - JSON olmayan veya boş response body durumunda dayanıklı ol.
  - Hata objesinde `status`, `code`, `message`, `requestId`, `details`, `issues` alanlarını normalize et.
  - Zod issue listesi için `data.details?.issues` kullan.
- `state` modelini genişlet:
  - `collections`
  - `selectedCollection`
  - `selectedReadiness`
  - `playgroundMode`: `retrieve` veya `query`
  - `knownJobs`: local/session job listesi
  - `isLoading` flags
  - `lastError`
- Endpoint helper'ları ekle:
  - `collectionReadyUrl(collection)`
  - `collectionQueryUrl(collection)`
  - `collectionRetrieveUrl(collection)`
  - `adminCollectionUrl(id)`
  - `adminJobUrl(id)`
- Güvenli DOM helper'ları ekle:
  - `clearNode(node)`
  - `appendText`
  - `createBadge`
  - `formatDateTime`
  - `formatCount`
  - `setButtonLoading`
- Collection card render'ında backend text alanlarını mümkün olduğunca `textContent` ile bas.
- Mevcut UI davranışını bozmadan syntax ve build doğrulaması yap.

### Küçük Model İçin Alt Uygulama Sırası

1. Sadece `apiRequest` ve error normalization'ı düzelt; `node --check` çalıştır.
2. Endpoint/helper fonksiyonlarını ekle; mevcut call site'ları kırmadan bırak.
3. DOM helper'larını ekle.
4. Sadece `renderCollections` içinde inline `onclick` ve backend text injection riskini azalt.
5. Son olarak refresh/create/open inspector akışının hâlâ çalıştığını manuel kontrol et.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
rg -n '"/rag/query"|"/rag/retrieve"|/rag/query|/rag/retrieve' admin
```

### Manuel Test

1. `npm.cmd run dev` çalıştır.
2. `http://localhost:3010/admin/` aç.
3. Collections view yükleniyor mu kontrol et.
4. Refresh butonuna basınca console error oluşmamalı.
5. Backend kapalıyken veya yanlış portta açarak hata toast'ının anlaşılır `message/code/requestId` gösterdiğini kontrol et.

### Kullanıcıya Açıklanacak

"Bu adımda UI görünümünü büyütmeden API client ve state temelini sağlamlaştırdık. Manuel testte admin sayfasını açıp collection listesinin yüklenmesini ve hata durumunda toast'ın düzgün görünmesini kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 1 of notes/adminpanel_plan.md. Only edit admin/index.html, admin/admin.js, and admin/admin.css if needed. Do not modify backend files or endpoint contracts. Improve the admin API client and state helpers: normalize error handling around the existing ApiErrorResponse shape, read Zod issues from details.issues, keep 204 handling safe, add endpoint URL helpers, add safe DOM/render helpers, and reduce unsafe backend text injection in collection rendering. Preserve the current UI behavior. Run node --check admin/admin.js and npm.cmd run build. Report exactly what changed and how the user can manually test http://localhost:3010/admin/.
```

## Adım 2 - Collections View ve Inspector Açılış Akışı

Amaç, collection listesi ve inspector davranışını güvenilir hale getirmek.

### Yapılacaklar

- Collections view için loading, empty, error state ekle.
- Card/table tasarımını mevcut Tailwind stiline uygun tut:
  - `displayName`
  - `description`
  - `status`
  - `chunkCount`
  - `activeVersion`
  - `updatedAt`
- Status badge renklerini backend status değerlerine göre düzelt:
  - `creating`: slate/amber
  - `indexing`: blue
  - `ready`: emerald
  - `failed`: rose
  - `archived`: slate
- Inspector açarken:
  - Seçilen collection state'e alınsın.
  - Inspector title/status güncellensin.
  - Editor form mevcut DTO alanlarıyla doldurulsun.
  - Readiness tab default açılıyorsa readiness hemen yüklensin.
  - Create mode açılıyorsa selected collection null olsun.
  - Create mode'da readiness/playground tableri ve footer'daki reindex/delete aksiyonları gizlensin veya disabled olsun.
- Inspector overlay click davranışını güvenli hale getir:
  - Panel içine tıklayınca kapanmamalı.
  - Overlay'e tıklayınca kapanmalı.
- Escape ile inspector kapatma eklenebilir.
- `btnCancelEdit` mevcut HTML'de var; click handler bağlanmalı.

### Küçük Model İçin Alt Uygulama Sırası

1. `elements` map'ine eksik `btnCancelEdit` ve gerekirse küçük yardımcı elementleri ekle.
2. `renderCollections` için loading/empty/error state ekle; collection click handler'ını güvenli hale getir.
3. `openInspector(null)` create mode davranışını düzelt; ready/playground/reindex/delete disabled/gizli olsun.
4. `openInspector(id)` edit mode davranışını düzelt; form dolsun ve default tab/readiness akışı netleşsin.
5. Close/cancel/escape davranışını ekle ve yalnızca inspector davranışını manuel test et.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
```

### Manuel Test

1. Admin paneli aç.
2. Collection yoksa boş state mesajı gör.
3. "New Collection" ile create mode aç; reindex/delete görünmemeli veya disabled olmalı.
4. Var olan bir collection kartına tıkla; inspector açılmalı, başlık/status/form dolmalı.
5. Panel içine tıklayınca kapanmamalı; overlay/close/cancel ile kapanmalı.
6. Refresh sonrası liste ve inspector state tutarlı kalmalı.

### Kullanıcıya Açıklanacak

"Bu adımda collections ekranı ve inspector açılış/kapanış davranışını netleştirdik. Manuel testte özellikle create mode ile mevcut collection inspect mode arasındaki farkları kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 2 of notes/adminpanel_plan.md. Only edit files under admin/. Do not change backend endpoints. Improve the collections view states and inspector open/close flow. Use the existing GET /v1/rag/collections contract and be defensive if optional settings fields are missing. Hide or disable readiness/playground/reindex/delete actions in create mode. Fix overlay behavior so clicks inside the panel do not close it. Wire the Cancel button. Run node --check admin/admin.js and npm.cmd run build. Include manual test instructions for http://localhost:3010/admin/.
```

## Adım 3 - Create/Edit Form ve Payload Güvenliği

Amaç, collection oluşturma/güncelleme formlarını backend schema'larına tam uyumlu hale getirmek.

### Backend Schema Özeti

Create body (`POST /v1/admin/collections`):

- `displayName`: required non-empty string
- `description`: optional string
- `sourcePath`: optional non-empty string
- `ozelgeDataPath`: optional non-empty string
- `distanceMetric`: optional `l2 | cosine | ip`
- `chunkSize`: optional positive integer
- `chunkOverlap`: optional nonnegative integer
- `retrievalK`: optional positive integer
- `retrievalDistanceThreshold`: optional nonnegative number
- `embeddingModel`: optional non-empty string
- `chatModel`: optional non-empty string

Update body (`PATCH /v1/admin/collections/:id`) aynı alanları optional kabul eder; `description` ayrıca `null` olabilir.

### Yapılacaklar

- Form payload builder yaz:
  - Empty string değerleri gönderme.
  - Create sırasında boş description gönderme.
  - Update sırasında description alanı bilinçli boşaltılmışsa `null` gönder.
  - Number alanlarında `Number(value)` kullan, `NaN` ise gönderme.
  - `retrievalDistanceThreshold: 0` geçerli sayılmalı.
  - `chunkOverlap: 0` geçerli sayılmalı.
- Client-side validation:
  - `displayName.trim()` zorunlu.
  - `chunkSize`, `retrievalK`: integer ve `> 0`.
  - `chunkOverlap`: integer ve `>= 0`.
  - `retrievalDistanceThreshold`: number ve `>= 0`.
  - `distanceMetric`: sadece `l2`, `cosine`, `ip`.
  - `chunkOverlap >= chunkSize` ise kullanıcıya uyarı göster; backend schema bunu admin router'da zorunlu olarak reddetmese bile UX bunu engellemeli veya en azından net uyarmalı.
- Save sırasında submit button loading/disabled.
- Başarılı create:
  - Toast: collection id.
  - Collection list reload.
  - Yeni collection seçilip inspector edit/readiness'e geçebilir veya panel kapanabilir; davranış net ve tutarlı olsun.
- Başarılı update:
  - Toast.
  - List reload.
  - `selectedCollection` güncel response/list item ile yenilenmeli.
- `INVALID_REQUEST_BODY` geldiğinde issue listesi okunur ve kullanıcıya field bazlı gösterilir.
- Unknown keys gönderilmediğini garanti et.

### Küçük Model İçin Alt Uygulama Sırası

1. Form okuma helper'larını yaz: `readTrimmed`, `readOptionalNumber`, `readOptionalInteger`.
2. `buildCollectionPayload({ mode })` fonksiyonunu ekle; henüz `saveCollection` içine bağlamadan küçük console-free kod kontrolü yap.
3. Client validation helper'ını ekle ve hata render/toast formatını düzelt.
4. `saveCollection` create/update dallarını payload builder ile değiştir.
5. Network tab manuel testiyle boş string, `NaN` ve unknown key gitmediğini doğrula.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
```

İsteğe bağlı backend kontrat smoke:

```powershell
npm.cmd test
```

### Manuel Test

1. New Collection aç.
2. Boş display name ile save dene; client-side hata gör.
3. Sadece display name girerek create et; backend default'ları doldurmalı.
4. Var olan collection'ı aç; description temizle ve save et; sonrasında açıklama boş görünmeli.
5. `retrievalDistanceThreshold` alanına `0` girip save dene; payload düşmemeli.
6. Geçersiz number değerleri için UI hata göstermeli.
7. Network tab'da create/update payload'ında boş string, `NaN`, bilinmeyen key olmadığını kontrol et.

### Kullanıcıya Açıklanacak

"Bu adımda create/edit formunun backend schema ile uyumunu sıkılaştırdık. Manuel testte özellikle boş alanların payload'a gitmediğini ve 0 değerlerinin kaybolmadığını Network tab'dan kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 3 of notes/adminpanel_plan.md. Only edit admin files. Do not change src/http/adminRouter.ts or any backend schema. Make the create/update collection form generate strict payloads compatible with createCollectionSchema and updateCollectionSchema. Fix numeric parsing so valid 0 values are preserved and NaN/empty values are omitted. Render INVALID_REQUEST_BODY details.issues clearly. Add client-side validation for displayName and numeric fields. Run node --check admin/admin.js and npm.cmd run build. Explain manual tests, including checking the browser Network payload.
```

## Adım 4 - Collection Readiness ve Capability-Driven UI

Amaç, her collection için gerçek query/retrieve uygunluğunu readiness endpointine göre göstermek.

### Yapılacaklar

- Inspector readiness tab açıldığında ve inspector bir collection için açıldığında `GET /v1/rag/collections/:id/ready` çağır.
- Loading state göster.
- Readiness summary render et:
  - Collection status.
  - Active version.
  - Active job varsa job id/status.
  - Chroma readable.
  - Chroma count.
  - Embedding model adı ve availability.
  - Chat model adı ve availability.
  - Desired embedding model farkı varsa "re-index required for desired embedding model" mesajı.
  - Capabilities: query/retrieve/reindex.
- Backend'den `blockers` bekleme; blocker list'i response alanlarından türet.
- Playground mode butonları ve Run butonu capability'e göre disabled olsun:
  - retrieve mode için `capabilities.retrieve`.
  - query mode için `capabilities.query`.
- Disabled sebebi tooltip/title veya görünür kısa mesaj olarak gösterilsin.
- Reindex capability false değilse reindex button aktif kalabilir; bu endpoint bugün her zaman `true` dönüyor.
- Readiness refresh butonu eklenebilir veya global refresh mevcut seçili inspector readiness'i de yenilemeli.
- Readiness hata durumunda inspector kapanmamalı; panel içinde hata gösterilmeli.

### Küçük Model İçin Alt Uygulama Sırası

1. `fetchCollectionReadiness(collection)` helper'ını ekle; sadece URL fallback ve state update yapsın.
2. `deriveReadinessBlockers(readiness)` helper'ını ekle; backend'den `blockers` bekleme.
3. `renderReadiness(readiness)` fonksiyonunu `#readinessStatusGrid`, `#readinessBlockers`, `#blockerList` mevcut id'leriyle değiştir.
4. `updatePlaygroundCapabilityState()` ekle; `.mode-btn`, `#btnPgRun` ve açıklama/title durumunu güncelle.
5. Global refresh ve tab switch sırasında seçili collection varsa readiness yenilemeyi bağla.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
```

### Manuel Test

1. Yeni ama henüz indexlenmemiş collection aç.
2. Readiness tab'de aktif fiziksel collection yok uyarısı görünmeli.
3. Retrieve ve Query çalıştırma disabled olmalı.
4. Re-index başlat; readiness active job göstermeli.
5. Job başarılı olduktan sonra readiness yenile; Chroma/model durumuna göre query/retrieve aktif olmalı.
6. Ollama model eksikse model availability uyarısı görünmeli.

### Kullanıcıya Açıklanacak

"Bu adımda inspector, collection'ın gerçekten sorgulanabilir olup olmadığını `/ready` sonucuna göre gösteriyor. Manuel testte indexlenmemiş bir collection'da query/retrieve butonlarının disabled olduğunu, re-index sonrası tekrar aktifleştiğini kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 4 of notes/adminpanel_plan.md. Only edit admin files. Do not add or change backend endpoints. Use GET /v1/rag/collections/:id/ready exactly as implemented; it does not return blockers, so derive blocker messages from hasActivePhysicalCollection, chromaReadable, modelAvailability, activeJob, and capabilities. Drive playground button disabled states from capabilities.retrieve and capabilities.query. Keep errors visible inside the inspector. Run node --check admin/admin.js and npm.cmd run build. Include manual test instructions around an unindexed collection and a reindex flow.
```

## Adım 5 - Playground: Retrieve ve Query Sonuçlarının Kullanılabilir Render'ı

Amaç, raw JSON yerine operasyonel olarak okunabilir test sonucu üretmek.

### Yapılacaklar

- Playground mode state'ini net tut: `retrieve` veya `query`.
- Question validation:
  - Boş/whitespace soru reddedilir.
  - Retrieve için opsiyonel `k` input eklenebilir; eklenirse positive integer olmalı.
- Run sırasında:
  - Button disabled/loading.
  - Önce mevcut readiness capability kontrolü.
  - Eğer readiness bilinmiyorsa lazy readiness fetch yap.
- Retrieve response render:
  - `question`
  - `k`
  - `sourceCount`
  - `distanceScoreThreshold`
  - `collectionDisplayName`
  - `activeVersion`
  - `sources[]`: `sourcePath`, `sourceType`, `chunkIndex`, `ozelgeId`, `sayi`, `tarih`, `konu`, `distanceScore`, content preview.
- Query response render:
  - `answer` ayrı, okunur panelde.
  - `sources[]` citation/source list olarak.
  - `distanceScoreThreshold`, `activeVersion`.
- RAG hata kodlarını kullanıcı dostu göster:
  - `NO_RELEVANT_CONTEXT`
  - `ANSWER_NOT_IN_RETRIEVED_CONTEXT`
  - `COLLECTION_INDEXING`
  - `COLLECTION_NOT_READY`
  - `MODEL_BACKPRESSURE`
  - `RATE_LIMIT_EXCEEDED`
- Raw JSON için collapsible/debug alanı opsiyonel olabilir.
- Backend'den gelen source content için `textContent` kullanılmalı.

### Küçük Model İçin Alt Uygulama Sırası

1. Mevcut `#pgQuestion`, `.mode-btn`, `#btnPgRun`, `#pgResult` ile çalış; `k` input'u eklenmeyecekse retrieve default backend ayarını kullansın.
2. `runPlayground` içinde boş soru ve capability guard ekle; henüz render formatını değiştirmeden syntax kontrolü yap.
3. `renderRetrieveResult(data)` helper'ını yaz ve source list'i güvenli DOM node'larıyla bas.
4. `renderQueryResult(data)` helper'ını yaz ve answer/source alanlarını ayır.
5. `renderPlaygroundError(error)` ekle; bilinen RAG error code'larını kısa açıklama ile göster.
6. Opsiyonel raw JSON/debug istiyorsan `<details>` elementiyle ekle; zorunlu değil.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
```

### Manuel Test

1. Ready collection seç.
2. Retrieve mode'da soru sor; source list görünmeli.
3. Query mode'da aynı soruyu sor; answer ve citation/source list görünmeli.
4. Çok ilgisiz soru sor; `NO_RELEVANT_CONTEXT` veya ilgili hata kullanıcı dostu görünmeli.
5. Question boşken Run tıkla; API çağrısı yapılmamalı.

### Kullanıcıya Açıklanacak

"Bu adımda playground raw JSON ekranından çıkıp cevap ve kaynakları ayrı gösteren test aracına dönüştü. Manuel testte ready bir collection ile retrieve/query deneyip kaynakların okunabilir listelendiğini kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 5 of notes/adminpanel_plan.md. Only edit admin files. Do not change RAG endpoints. Improve the playground UI for POST /v1/rag/collections/:id/retrieve and /query. Render answer and sources as safe DOM nodes, not raw innerHTML from backend text. Keep a clear error panel for known RAG error codes. Use readiness capabilities before enabling calls. Run node --check admin/admin.js and npm.cmd run build. Provide manual test instructions for retrieve, query, empty question, and no-context errors.
```

## Adım 6 - Re-index Job Tracking ve Job Monitor

Amaç, backend'de job list endpointi olmadan, admin panelin başlattığı job'ları izlemek.

### Gerçek Kısıt

Backend'de `GET /v1/admin/jobs` yok. Bu yüzden panel sistemdeki tüm job'ları listeleyemez. Sadece şu kaynaklardan job öğrenebilir:

- `POST /v1/admin/collections/:id/reindex` response'u.
- `GET /v1/rag/collections/:id/ready` içindeki `activeJob`.
- Browser local/session storage'da daha önce kaydedilmiş job id'leri.

UI metni bu kısıtı dürüst göstermeli: "This monitor tracks jobs observed by this browser/admin session."

### Yapılacaklar

- `knownJobs` state ve localStorage persistence ekle.
- Re-index response'undaki job'ı hemen `knownJobs` içine ekle:
  - `id`
  - `collectionId`
  - collection display name snapshot
  - `status`
  - `targetPhysicalCollection`
  - timestamps
- Collection readiness `activeJob` görürse job listesine merge et.
- `loadJobs` artık placeholder değil:
  - Bilinen job'ları `GET /v1/admin/jobs/:jobId` ile poll eder.
  - `queued`/`running` için 5-10 saniyede polling.
  - Terminal status: `succeeded`, `failed`, `cancelled`.
- Job monitor table:
  - Job ID kısa/monospace.
  - Collection.
  - Status badge.
  - Target version/physical collection.
  - Document/chunk count.
  - Created/updated/finished time.
  - Error message.
  - Actions: cancel, refresh, remove from local monitor.
- Cancel button:
  - Sadece `queued` veya `running` status'ta enabled.
  - `POST /v1/admin/jobs/:jobId/cancel`.
  - Başarılı olunca job reload ve collection list reload.
- Re-index button:
  - Çift tıklama engellenmeli.
  - `409 COLLECTION_INDEX_ALREADY_RUNNING` gelirse kullanıcıya active job olup olmadığını readiness'ten yenilemesini söylemeli veya readiness'i otomatik yenilemeli.
- Progress bar:
  - Gerçek progress yok. Simulated percent iddiası kullanılmamalı.
  - Bunun yerine status timeline veya indeterminate activity gösterilmeli.

### Küçük Model İçin Alt Uygulama Sırası

1. `knownJobs` state shape'ini ve localStorage key'ini ekle; UI render değiştirmeden syntax kontrolü yap.
2. `rememberJob(job, collection)` ve `loadKnownJobsFromStorage/saveKnownJobsToStorage` helper'larını ekle.
3. `reindexCollection` response'undaki `job` bilgisini known jobs'a ekle.
4. `loadJobs` placeholder'ını değiştir: sadece known job id'lerini `GET /v1/admin/jobs/:jobId` ile poll et.
5. `renderJobs` ile mevcut `#jobsTableBody` doldur. Ek kolon gerekiyorsa aynı adımda `admin/index.html` table header'ını da güncelle.
6. `cancelJob(jobId)` ekle; yalnızca `queued/running` için enabled.
7. Readiness `activeJob` gördüğünde known jobs'a merge et.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
```

### Manuel Test

1. Bir collection aç ve Re-index başlat.
2. Toast job id göstermeli.
3. Job Monitor view'a geç; job listede görünmeli.
4. Status `queued/running/succeeded/failed/cancelled` olarak güncellenmeli.
5. Aktif job için cancel dene; sonrasında status `cancelled` görünmeli veya job terminal state'e geçmeli.
6. Aynı collection için ikinci re-index'i aktif job varken dene; `409 COLLECTION_INDEX_ALREADY_RUNNING` mesajı anlaşılır görünmeli.
7. Sayfayı yenile; localStorage sayesinde bilinen job'lar tekrar görünmeli.

### Kullanıcıya Açıklanacak

"Bu adımda Job Monitor gerçekçi hale geldi: backend job list endpointi olmadığı için yalnızca bu tarayıcı oturumunun gördüğü re-index job'larını izliyor. Manuel testte re-index başlatıp Job Monitor'da status değişimini ve cancel akışını kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 6 of notes/adminpanel_plan.md. Only edit admin files. Do not add GET /v1/admin/jobs or any backend endpoint. Build job monitoring around observed job IDs from reindex responses, collection readiness activeJob, and localStorage. Poll each known job via GET /v1/admin/jobs/:jobId. Use statuses queued, running, succeeded, failed, cancelled. Do not show fake deterministic progress; use status/timeline or indeterminate activity. Add cancel support for queued/running jobs through POST /v1/admin/jobs/:jobId/cancel. Run node --check admin/admin.js and npm.cmd run build. Explain the job listing limitation clearly in the user-facing summary and manual test steps.
```

## Adım 7 - System Health Dashboard Detayları

Amaç, `/health`, `/ready` ve `/ready?details=true` sonuçlarını kullanarak sistem durumunu okunabilir hale getirmek.

### Yapılacaklar

- `loadHealth` iki veya üç çağrı yapabilir:
  - `/health`
  - `/ready`
  - `/ready?details=true`
- `/ready?strict=true` kullanılmamalı; hazır değilken 503 almak dashboard için gereksiz.
- Summary cards:
  - Process health: `status`, `alive`, `uptimeSec`, `timestamp`, `port`.
  - Readiness: `ready`, `systemReadyFor`, `overallSummary`, `queryReady`, `indexReady`.
  - Dependencies: registry, chroma, ollama.
- Details section:
  - `recommendedActions`
  - `blockers`
  - `warnings`
  - `checks` listesi: code, name, status, capabilities, message, latency/details.
  - Data source info: path, ok/error.
  - Config info: chat model, embedding model, chroma URL, port.
- Empty states:
  - No recommended actions varsa "No recommended actions" göster.
  - Details fetch fail olursa summary yine gösterilebilir.
- Global refresh health'i yenilemeli.
- Health polling interval devam edebilir ama overlapping request engellenmeli.

### Küçük Model İçin Alt Uygulama Sırası

1. `loadHealth` içinde overlapping guard ekle; eski render davranışını bozmadan syntax kontrolü yap.
2. `/health` ve `/ready` summary render'ını `#healthGrid` içinde güvenli hale getir.
3. `/ready?details=true` fetch'i ekle; fail olursa summary render'ını bozma.
4. `renderReadinessDetails(details)` ile `#readinessDetail` içine recommended actions, blockers, warnings ve checks bas.
5. Dependency cards için registry/chroma/ollama alanlarının yokluğuna karşı fallback ekle.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
```

### Manuel Test

1. Health view'a geç.
2. Chroma ve Ollama ayaktaysa dependency OK görünmeli.
3. Ollama veya Chroma kapalıyken readiness degraded ve recommended action görünmeli.
4. `/ready?details=true` response'undaki checks UI'da okunabilir listelenmeli.
5. Refresh'e basınca eski sonuçlar karışmadan güncellenmeli.

### Kullanıcıya Açıklanacak

"Bu adımda System Health ekranı summary kartlarının ötesine geçti ve `/ready?details=true` içindeki blockers/checks/action bilgilerini gösteriyor. Manuel testte Chroma veya Ollama kapalıyken degraded durumun doğru göründüğünü kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 7 of notes/adminpanel_plan.md. Only edit admin files. Do not change /health or /ready backend behavior. Render /health, /ready, and /ready?details=true into a clear system health dashboard with summary cards, dependencies, checks, blockers, warnings, recommended actions, and data source details. Avoid strict=true for dashboard fetches. Prevent overlapping polling requests. Run node --check admin/admin.js and npm.cmd run build. Provide manual test instructions for healthy and degraded dependency states.
```

## Adım 8 - UX Polish, Accessibility ve Responsive Stabilizasyon

Amaç, admin paneli günlük kullanım için daha tutarlı ve dayanıklı yapmak.

### Yapılacaklar

- Visual consistency:
  - Cards ve panels 8px civarı radius veya mevcut stile uyumlu.
  - Sidebar, header, content spacing tutarlı.
  - Status renkleri tüm views arasında aynı.
- Responsive:
  - Sidebar/mobile davranışı kontrol edilir.
  - Inspector mobile width tam ekran, desktop max width.
  - Form grid küçük ekranda tek kolon.
  - Uzun job id, path, model name taşmadan kırılır veya monospace wrap.
- Accessibility:
  - Buttons için `type` doğru.
  - Icon-only butonlarda `title` veya `aria-label`.
  - Disabled butonlarda sebep title/visible helper.
  - Focus states korunur.
  - Escape ile modal kapatma.
- Toast:
  - Uzun error message taşmamalı.
  - Details/issues listesi okunabilir.
  - Success/error/info varyantları tutarlı.
- Polling cleanup:
  - Inspector kapandığında gereksiz selected readiness loop yoksa temizle.
  - Sayfa görünür değilken polling yavaşlatılabilir.
- Kod düzeni:
  - `admin/admin.js` içinde fonksiyon grupları net.
  - Büyük render fonksiyonlarında küçük helper'lar.
  - Yorum sadece karmaşık davranışlarda.

### Küçük Model İçin Alt Uygulama Sırası

1. Önce sadece CSS/HTML taşma ve responsive class düzeltmelerini yap.
2. Sonra accessibility attribute'larını ekle: `aria-label`, `title`, doğru `type`.
3. Ardından toast layout ve uzun hata metni davranışını düzelt.
4. En son polling cleanup/page visibility gibi davranışsal küçük iyileştirmeleri ekle.
5. Her alt parça sonrası `node --check admin/admin.js` çalıştır.

### Testler

```powershell
node --check admin/admin.js
npm.cmd run build
rg -n '"/rag/query"|"/rag/retrieve"|/rag/query|/rag/retrieve' admin
```

### Manuel Test

1. Desktop geniş ekranda tüm view'ları gez.
2. Browser devtools mobile viewport ile collections, inspector, jobs, health kontrol et.
3. Uzun collection adı/path/model/job id taşma yapmamalı.
4. Keyboard ile tab/escape davranışını kontrol et.
5. Console'da runtime error olmamalı.

### Kullanıcıya Açıklanacak

"Bu adımda fonksiyonellikten çok kullanım kalitesini toparladık. Manuel testte desktop ve mobile viewport'larda taşma, focus, disabled açıklamaları ve toast davranışlarını kontrol edin."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Implement Step 8 of notes/adminpanel_plan.md. Only edit admin files. Do not change backend endpoints. Polish the admin UI for responsive behavior, accessibility, stable sizing, consistent badges, robust toasts, and clean polling behavior. Keep the app operational and avoid unrelated redesign. Run node --check admin/admin.js, npm.cmd run build, and search admin/ for legacy /rag/query or /rag/retrieve strings. Provide manual desktop/mobile testing instructions.
```

## Adım 9 - Final Contract Audit ve Handoff

Amaç, admin-only geliştirme tamamlandığında kontrat dışına çıkılmadığını ve manuel test dokümantasyonunun hazır olduğunu doğrulamak.

### Yapılacaklar

- `git diff -- admin` ile sadece admin dosyaları değişmiş mi doğrula.
- Backend dosyalarında değişiklik görünürse bu plan kapsamında yeni backend edit'i yapma. Değişiklik sana aitse kullanıcıdan onay almadan revert etme; finalde açıkça raporla. Bu planın beklenen uygulama çıktısı yalnızca `admin/` değişiklikleridir.
- Legacy endpoint stringlerini tara.
- API URL'lerinin tümü mevcut kontratla eşleşiyor mu kontrol et.
- Error handling `details.issues` kullanıyor mu kontrol et.
- Job statuses `succeeded`, `failed`, `cancelled` ile uyumlu mu kontrol et.
- Collection readiness için `blockers` response beklenmiyor mu kontrol et.
- Son smoke:

```powershell
node --check admin/admin.js
npm.cmd run build
rg -n '"/rag/query"|"/rag/retrieve"|/rag/query|/rag/retrieve' admin
git diff -- admin
```

Risk durumuna göre:

```powershell
npm.cmd test
```

### Manuel Test Senaryo Seti

1. Admin açılış:
   - `http://localhost:3010/admin/`
   - Collections yüklenir veya boş state görünür.
2. Create:
   - Sadece display name ile collection oluştur.
   - Listeye geldiğini doğrula.
3. Edit:
   - Description ve retrieval threshold değiştir.
   - Save sonrası değerlerin korunduğunu doğrula.
4. Readiness:
   - Yeni collection'da query/retrieve disabled.
   - Re-index sonrası active job görünür.
5. Job monitor:
   - Re-index job listelenir.
   - Polling status günceller.
   - Cancel uygun status'ta çalışır.
6. Playground:
   - Ready collection'da retrieve source list gösterir.
   - Query answer ve citations gösterir.
7. Health:
   - `/health`, `/ready`, `/ready?details=true` bilgileri UI'da görünür.
8. Error:
   - Invalid form payload client-side yakalanır.
   - Backend error gelirse `code/message/requestId/issues` görünür.

### Kullanıcıya Açıklanacak

"Final kontrolde admin panelin yalnızca mevcut endpointleri kullandığını, backend dosyalarına dokunulmadığını ve temel manuel senaryoların çalıştığını doğruladık."

### Cold Start Prompt

```text
You are working in C:\Codes\Vanilla Rag Backend. Perform Step 9 final audit from notes/adminpanel_plan.md. Do not implement new features unless a small admin-only fix is necessary. Verify that only admin files changed, no backend endpoint/schema was modified, no legacy /rag/query or /rag/retrieve strings exist, job statuses match queued/running/succeeded/failed/cancelled, readiness handling does not expect a blockers array, and error issues come from details.issues. Run node --check admin/admin.js, npm.cmd run build, rg legacy endpoint search, and git diff -- admin. Summarize changed files, validation output, residual risks, and exact manual test steps.
```

## Gelecekte Endpointler Nasıl Geliştirilebilir?

Bu bölüm admin-only planın parçası değildir. Aşağıdaki maddeler ileride backend kapsamı ayrıca açılırsa değerlendirilebilir. Bu maddeler uygulanacaksa backend router, schema, test ve dokümantasyon birlikte güncellenmelidir.

### 1. Job List Endpointi

Eksik: Admin panel bugün tüm job'ları bilemez; sadece gördüğü job id'lerini poll edebilir.

Öneri:

- `GET /v1/admin/jobs?collectionId=&status=&limit=&cursor=`
- Tenant-scoped olmalı.
- Response paginated olmalı.
- Status filter: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

Admin faydası: Job Monitor gerçek sistem monitorüne dönüşür, localStorage workaround kalkar.

### 2. Admin Collection Detail Endpointi

Eksik: Public collection DTO zamanla sanitize edilirse admin settings formu tam veri alamaz.

Öneri:

- `GET /v1/admin/collections/:collectionId`
- Full editable admin DTO döndürür:
  - settings fields
  - created/updated metadata
  - active physical summary
  - last indexed info
  - latest active/past job summary

Admin faydası: Editor public DTO'ya bağımlı kalmaz.

### 3. Collection Readiness Blockers/Warn Listesi

Eksik: Collection readiness endpointi `blockers` array'i döndürmüyor; UI blocker'ları türetiyor.

Öneri:

- `GET /v1/rag/collections/:id/ready` response'una geriye uyumlu olarak ek alanlar:
  - `blockers[]`
  - `warnings[]`
  - `recommendedActions[]`
  - dependency breakdown: chroma, ollama, embedding model, chat model

Admin faydası: UI mesajları backend truth source ile aynı olur.

### 4. Model Discovery Endpointi

Eksik: Admin formunda model adları serbest text.

Öneri:

- `GET /v1/admin/models`
- Ollama available models ve configured defaults döner.
- Response model type ayrımı yapabilir: embedding-compatible/chat-compatible eğer güvenilir şekilde belirlenebiliyorsa.

Admin faydası: Model seçimi dropdown/autocomplete olabilir, typo riski düşer.

### 5. Collection Config Validation / Dry Run

Eksik: Kullanıcı `sourcePath`, `ozelgeDataPath`, chunk ayarları ve model isimlerinin etkisini save/reindex sonrası öğreniyor.

Öneri:

- `POST /v1/admin/collections/validate`
- `POST /v1/admin/collections/:id/validate`
- Path readability, supported file count, model availability, chunk settings ve distance metric uyumunu kontrol eder.

Admin faydası: Re-index başlatmadan önce hatalar yakalanır.

### 6. Job Progress, Logs ve Events

Eksik: Job status dışında gerçek ilerleme/progress yok.

Öneri:

- `GET /v1/admin/jobs/:jobId/events`
- veya SSE: `GET /v1/admin/jobs/:jobId/stream`
- Indexing pipeline document count/chunk count aşamalarını event olarak yazar.

Admin faydası: "running" durumunda ne olduğu görünür, progress bar gerçek veriyle çalışır.

### 7. Cleanup ve Physical Collection Görünürlüğü

Eksik: Zero-downtime rebuild sonrası eski physical collection cleanup durumları admin UI'dan görülemiyor.

Öneri:

- `GET /v1/admin/collections/:id/physical-collections`
- `POST /v1/admin/physical-collections/:name/cleanup`

Admin faydası: Retention cleanup, failed cleanup ve active/retired physical state izlenebilir.

### 8. Audit Log / Operational Logs Endpointi

Eksik: Structured logs stdout'ta; admin panel geçmiş operasyonları okuyamıyor.

Öneri:

- `GET /v1/admin/audit-log?collectionId=&operation=&limit=&cursor=`
- Kalıcı log storage gerektirir.

Admin faydası: Re-index, delete, query/retrieve test ve error geçmişi görülebilir.

### 9. Auth/RBAC ve CSRF Sertleştirme

Eksik: Lokal geliştirme admin paneli doğrudan static servis ediliyor.

Öneri:

- Admin API için auth middleware.
- Role-based izinler: viewer/operator/admin.
- Destructive aksiyonlar için CSRF veya signed action token.

Admin faydası: Panel production benzeri ortamlarda güvenli kullanılabilir.

### 10. Config Defaults Endpointi

Eksik: Create form default değerleri backend config'ten doğrudan okuyamıyor; boş bırakınca backend dolduruyor.

Öneri:

- `GET /v1/admin/config/defaults`
- `collectionDefaults`, current model names, limits ve readiness config summary döner.

Admin faydası: Create form default değerleri görünür olur; kullanıcı boş bırakınca ne olacağını bilir.

## Endpoint İyileştirme Notları İçin Kural

Yukarıdaki endpoint önerileri admin panelin mevcut adımlarında uygulanmayacak. Her biri ayrı backend işi olarak ele alınmalı ve şu dosyalar birlikte güncellenmelidir:

- `src/http/adminRouter.ts` veya `src/http/ragRouter.ts`
- ilgili registry/interface kodu
- `test/acceptance/api.endpoints.test.ts`
- README veya mimari dokümantasyon
- admin panel entegrasyonu

Admin-only geliştirme sırasında bu öneriler yalnızca doküman notu olarak kalmalıdır.
