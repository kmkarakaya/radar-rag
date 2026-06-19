Repo genelinde RAG backend’de Chroma client / vector store lifecycle yönetimini incele ve gerekirse düzelt.

Elimdeki ilk incelemede özellikle `rag.ts` ve `chromaCollections.ts` dosyalarında şu riskli pattern’ler görünüyor:

1. `chromaCollections.ts` içinde birden fazla function kendi içinde `new ChromaClient(chromaClientParams(...))` çağırıyor:
   * `createPhysicalChromaCollection`
   * `assertChromaCollectionReadable`
   * `deletePhysicalChromaCollection`
   * `listPhysicalChromaCollections`
2. `rag.ts` içinde de ayrıca `checkChromaHealth` sırasında `new ChromaClient(...)` yaratılıyor.
3. `retrieveSources` akışında her RAG query/retrieval öncesinde `assertChromaCollectionReadable(...)` çağrılıyor. Bu da Chroma’ya her query’de en az `getCollection` + `count` operasyonu attırıyor olabilir. Bu hot path için gereksiz latency ve load yaratabilir.
4. `rag.ts` içinde `createVectorStore(...)` her retrieval’da yeni LangChain `Chroma` vector store wrapper oluşturuyor gibi görünüyor. Eğer LangChain Chroma wrapper’a shared `ChromaClient` verilmezse, wrapper kendi içinde de ayrıca client yaratıyor olabilir. Bunu kullanılan LangChain/Chroma sürümüne göre doğrula.
5. `rag.ts` ve `chromaCollections.ts` arasında circular dependency riski var gibi:
   * `rag.ts` → `chromaCollections.ts`
   * `chromaCollections.ts` → `rag.ts` içinden `RagQueryError`
     Bu mimari olarak temizlenmeli.
6. `chromaClientParams(...)` fonksiyonu iki yerde duplicate olabilir. Chroma client config tek kaynaktan yönetilmeli.

Görevin:

Repo genelinde Chroma kullanımını ara:

* `new ChromaClient`
* `new Chroma`
* `chromaClientParams`
* `assertChromaCollectionReadable`
* `getCollection`
* `count`
* `similaritySearch`
* `similaritySearchWithScore`
* LangChain Chroma importları
* Chroma collection create/delete/list/readiness logic

Ardından şu soruları cevaplayarak düzeltme yap:

1. Chroma client request başına mı yaratılıyor, yoksa app lifecycle boyunca reuse ediliyor mu?
2. Query hot path’te gereksiz `getCollection`, `count`, health/readiness check veya wrapper creation var mı?
3. LangChain Chroma wrapper shared `ChromaClient` alabiliyor mu? Kullanılan package version bunu destekliyor mu?
4. `ChromaClient` için public `close/dispose/shutdown` lifecycle API var mı? Yoksa client’ı kapatmaya çalışmak yerine reuse etmek mi doğru?
5. Multi-tenant, multi-database, farklı Chroma URL, auth, headers, SSL, path, tenant/database gibi config varyasyonları var mı? Varsa global singleton yerine config-keyed cache kullanılmalı.
6. Testlerde veya worker/job tarafında farklı Chroma config’leri aynı process içinde kullanılabiliyor mu? Buna göre cache key güvenli tasarlanmalı.
7. Collection readiness check gerçekten her query’de gerekli mi, yoksa startup/admin/activation aşamasına mı alınmalı? Alternatif olarak TTL cache veya “query fail olursa diagnostic check” modeli uygulanmalı mı?
8. Circular dependency var mı? Varsa error classes, client factory ve collection helper’lar ayrı modüllere taşınarak kırılmalı.

Beklenen teknik yön:

* `ChromaClient` yaratımı helper function’ların içine dağılmış olmamalı.
* Ortak bir `chromaClient.ts` / benzeri module oluşturulabilir:
  * `chromaClientParams(runtimeConfig)`
  * `getChromaClient(runtimeConfig)`
  * gerekiyorsa config-keyed client cache
  * test/reset helper gerekiyorsa sadece test ortamına uygun şekilde
* `chromaCollections.ts` doğrudan `new ChromaClient(...)` yapmamalı; shared factory/cache kullanmalı.
* `rag.ts` doğrudan `new ChromaClient(...)` yapmamalı; shared factory/cache kullanmalı.
* LangChain `Chroma` wrapper mümkünse shared client ile kurulmalı. Örneğin package destekliyorsa `clientParams` yerine/yanında `index: getChromaClient(runtimeConfig)` benzeri kullanım değerlendirilmeli.
* `createVectorStore(...)` her request’te gereksiz wrapper/embedding object yaratıyorsa collectionName + embeddingModel + runtime config bazlı cache düşünülebilir. Ancak cache invalidation ve test izolasyonu dikkate alınmalı.
* Her query öncesinde `assertChromaCollectionReadable(...).count()` yapılması gerekiyorsa gerekçelendirilmeli; gerekmiyorsa hot path’ten çıkarılmalı veya TTL cache’e alınmalı.
* Collection create/delete gibi mutation operasyonlarından sonra readiness/vector store cache invalidation gerekiyorsa eklenmeli.
* `RagQueryError` gibi domain error’lar `rag.ts` içinden collection module’a import edilmemeli; ayrı bir error module’a taşınarak circular dependency kırılmalı.
* Chroma config duplicate olmamalı; tek kaynak kullanılmalı.

Kalite beklentileri:

* Değişiklik repo genelindeki mevcut mimariye uyumlu olsun.
* TypeScript tipleri temiz kalsın; `any` veya gereksiz cast ekleme.
* Mevcut hata davranışlarını koru:
  * collection not found → uygun domain error / 404 davranışı
  * timeout/abort → mevcut semantik korunmalı
  * delete missing collection → idempotent kalmalı
* Abort/timeout wrapper davranışını bozma.
* Test varsa güncelle; yoksa en azından ilgili lifecycle/cache/readiness davranışları için test eklemeyi değerlendir.
* Kod değişikliğinden sonra lint/typecheck/test komutlarını çalıştır ve sonucu raporla.
* Son cevapta:
  * Nerelerde Chroma client yaratılıyordu?
  * Ne şekilde merkezi hale getirildi?
  * Query hot path’te hangi operasyonlar kaldırıldı veya cache’lendi?
  * LangChain Chroma wrapper shared client kullanıyor mu?
  * Circular dependency temizlendi mi?
  * Hangi testler çalıştı?
    açıkça özetle.

Önemli: Sadece `rag.ts` ve `chromaCollections.ts` ile sınırlı kalma. Tüm repoda Chroma/RAG/vector store kullanımını araştır ve düzeltmeyi repo bütününe göre yap.
