# Graph Report - Vanilla Rag Backend  (2026-06-27)

## Corpus Check
- 86 files · ~1,141,919 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1280 nodes · 2253 edges · 107 communities (96 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `82c040af`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_RAG Backend Core|RAG Backend Core]]
- [[_COMMUNITY_Turkish Historical Data|Turkish Historical Data]]
- [[_COMMUNITY_RAG Data & Training Content|RAG Data & Training Content]]
- [[_COMMUNITY_Multi-Collection Architecture|Multi-Collection Architecture]]
- [[_COMMUNITY_Admin Panel Design|Admin Panel Design]]
- [[_COMMUNITY_Training Diagrams|Training Diagrams]]
- [[_COMMUNITY_Training Content Images|Training Content Images]]
- [[_COMMUNITY_Admin Panel UI|Admin Panel UI]]
- [[_COMMUNITY_Turkish Independence Speech|Turkish Independence Speech]]
- [[_COMMUNITY_Dataset Entry|Dataset Entry]]
- [[_COMMUNITY_Onboarding Flow|Onboarding Flow]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 106|Community 106]]

## God Nodes (most connected - your core abstractions)
1. `Multi-Collection Refactor Done Log` - 44 edges
2. `createEl()` - 31 edges
3. `SqliteCollectionRegistry` - 31 edges
4. `Vanilla RAG Backend` - 29 edges
5. `RAG Admin Panel Development Plan` - 24 edges
6. `clearNode()` - 23 edges
7. `saveCollection()` - 23 edges
8. `Ücretli ve Lokal LLM'leri Birlikte Kullanarak Ölçeklenebilir Kod Geliştirme` - 23 edges
9. `Admin Panel Prompt Denetim Kaydi` - 22 edges
10. `loadJobs()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `startEphemeralApp()` --calls--> `createApp()`  [EXTRACTED]
  test/acceptance/api.endpoints.test.ts → src/app.ts
- `startServer()` --calls--> `createApp()`  [EXTRACTED]
  test/app.foundation.test.ts → src/app.ts
- `seedPhysical()` --calls--> `createPhysicalCollectionName()`  [EXTRACTED]
  test/collections.registry.test.ts → src/collections/ids.ts
- `Vanilla RAG Test Console UI` --conceptually_related_to--> `Hybrid LLM Coding Workflow`  [INFERRED]
  test_frontend/index.html → egitim/egitim_icerigi.md
- `seedPhysicalRecord()` --calls--> `createPhysicalCollectionName()`  [EXTRACTED]
  test/indexing.cleanup.test.ts → src/collections/ids.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Core Architecture Pattern** — vanilla_rag_backend, express, langchain, chroma, ollama, typescript, sqlite_registry [EXTRACTED 1.00]
- **Zero-Downtime Rebuild System** — zero_downtime_rebuild, readme_collection, readme_index_job, readme_physical_collection, retention_cleanup, stale_job_recovery, sqlite_registry [EXTRACTED 1.00]
- **Admin Panel Components** — notes_adminpanel_plan_collection_view, notes_adminpanel_plan_inspector, notes_adminpanel_plan_playground, notes_adminpanel_plan_job_monitor, notes_adminpanel_plan_health_dashboard, notes_adminpanel_plan_editor [EXTRACTED 1.00]
- **Multi-Collection Plan Components** — notes_multicollection_plan_registry_model, notes_multicollection_plan_zero_downtime, notes_multicollection_plan_concurrency, notes_multicollection_plan_id_strategy [EXTRACTED 1.00]
- **Mehmet Akif Ersoy's national poems** — dataset1_canakkale, graphify_out_converted_istiklal_marsi_ad54f9f4, dataset1_canakkale_mehmet_akif_ersoy [EXTRACTED 1.00]
- **Educational content about Hybrid LLM Workflow** — egitim_egitim_icerigi, egitim_index, egitim_output [EXTRACTED 1.00]
- **RAG Backend ecosystem** — dataset2_readme_rag_sistemi, test_frontend_index_rag_api_endpoints, test_frontend_index_rag_test_console, egitim_egitim_icerigi_hybrid_llm_workflow [INFERRED 0.75]

## Communities (107 total, 11 thin omitted)

### Community 0 - "RAG Backend Core"
Cohesion: 0.17
Nodes (9): addNullablePatch(), addPatch(), isRecord(), mapCollectionRow(), normalizeChromaCollectionConfiguration(), CreateCollectionInput, RagCollection, RequestContext (+1 more)

### Community 1 - "Turkish Historical Data"
Cohesion: 0.18
Nodes (14): Canakkale.txt - Çanakkale Şehitlerine poem, Çanakkale Savaşı (Gallipoli Campaign), Kılıç Arslan, Mehmet Akif Ersoy, Peygamber (Prophet), Selahaddin Eyyubi (Saladin), Istiklal_Marsi - Turkish National Anthem, Türk Bayrağı (Turkish Flag / al sancak / hilal) (+6 more)

### Community 2 - "RAG Data & Training Content"
Cohesion: 0.32
Nodes (7): Cold Start Prompt, done.md logging convention, Hybrid LLM Coding Workflow, Lokal Model (Local LLM), Yüksek Kapasiteli Model (Paid LLM), index.html - Educational content HTML page, output.html - Partial HTML output of lesson

### Community 3 - "Multi-Collection Architecture"
Cohesion: 0.18
Nodes (10): Chroma Dokümanlarıyla Uyum Notları, Endpoint Path'ine Collection Hash Ekleyelim mi?, Collection ID Strategy, İkinci Repo İncelemesiyle Eklenen Netleştirmeler, Kısa Karar, Mimari Etkinlik Değerlendirmesi, Readiness ve Healthcheck, Son Kullanıcı Collection'ları Kolayca Bulabiliyor mu? (+2 more)

### Community 4 - "Admin Panel Design"
Cohesion: 0.06
Nodes (33): Collections View, Editor, System Health Dashboard, Health View, Inspector, Inspector Footer ve Toast, Inspector Readiness, Job Monitor (+25 more)

### Community 5 - "Training Diagrams"
Cohesion: 0.83
Nodes (4): Adım 10 — Final Audit: high-capacity model reviews plan vs actual work via done.md and git diff, Ana Döngü (Full Cycle Diagram) — complete hybrid LLM coding workflow: plan → prompt → execute → test → commit → audit, Prensipler — 5 key principles: small tasks, cold-start prompts, code-based info transfer, trace leaving, human checkpoint, Yapılacaklar (To-Do Board) — project task/todo list UI screenshot for RAG Backend

### Community 6 - "Training Content Images"
Cohesion: 1.00
Nodes (4): Döngünün Tam Şeması (Full Cycle Diagram), Adım Adım Hybrid LLM Coding Workflow, En Önemli Prensipler (Key Principles), Zihinsel Model (Mental Model Diagram)

### Community 7 - "Admin Panel UI"
Cohesion: 0.08
Nodes (24): Admin Panel HTML, Tailwind CSS, Admin Panel Prompt Denetim Kaydi, Ek Duzeltme - Playground MODEL_BACKPRESSURE Abort Regresyonu, Prompt 00 - Audit, Kod Degisikligi Yok, Prompt 01 - API Client, State Model, Safe Render Temeli, Prompt 02 - Collections View ve Inspector Akisi, Prompt 03 - Create/Edit Form ve Payload Guvenligi (+16 more)

### Community 10 - "Onboarding Flow"
Cohesion: 0.08
Nodes (27): addIfNumber(), addIfText(), adminCollectionValidateUrl(), adminJobDeleteUrl(), adminJobsBulkDeleteUrl(), adminJobsListUrl(), adminJobUrl(), API (+19 more)

### Community 11 - "Community 11"
Cohesion: 0.35
Nodes (17): apiRequest(), cancelJob(), changeJobsStatusFilter(), deleteCollection(), deleteJob(), loadCollections(), loadHealth(), loadJobs() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (38): appendCell(), appendChildren(), appendIssueSection(), appendJsonDetails(), appendText(), clearNode(), clearReadinessRefreshNotice(), collectionQueryUrl() (+30 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (44): Log Sink Isolation Bug Fix, Multi-Collection Refactor Done Log, Prompt 0: Planning, Prompt 10: Tenant Access, Registry-Aware Readiness, and Collection Capabilities, Prompt 11: Acceptance Tests, Test Isolation, and External-Service Boundaries, Prompt 12: Documentation, Frontend Contract, and Architecture Cleanup, Prompt 13: Final Multi-Collection Audit and Release Gate, Prompt 14: Job Version, Registry Invariants, and Physical Record Integrity (+36 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (43): Prompt 10: Tenant Access, Registry-Aware Readiness, and Collection Capabilities, Prompt 11: Acceptance Tests, Test Isolation, and External-Service Boundaries, Prompt 12: Documentation, Frontend Contract, and Architecture Cleanup, Prompt 13: Final Multi-Collection Audit and Release Gate, Prompt 14: Job Version, Registry Invariants, and Physical Record Integrity, Prompt 15: Acceptance Coverage, Test Typechecking, and Script Discipline, Prompt 16: Readiness Contract, Runtime Copy Cleanup, and Operational Config, Prompt 17: Documentation Truth, Done Log Repair, and Final Release Audit (+35 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (33): dependencies, better-sqlite3, chromadb, express, @langchain/classic, @langchain/community, @langchain/core, @langchain/ollama (+25 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (30): 0. Ollama modelleri saglikli yakalanmiyor, isleme giriyor, 10. Lint ve format adimi yok, 11. CI pipeline yok, 13.1. `test_frontend` artik ayri bir bakim yuzeyi, 13.2. TODO'nun kendisi hizla stale olabilir, 13. README teknik olarak yeterli ama kalite sinirlari daha acik yazilmali, 14. Konfigurasyon dogrulamasi kisitli, 15. All-in-One Deployment Paketi (Dockerization) Eksikligi (+22 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (7): createVersionString(), mapIndexJobRow(), mapIndexJobSummaryRow(), SqliteCollectionRegistry, BeginIndexJobInput, CompleteIndexJobResult, IndexJob

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (24): description, minLength, type, description, minLength, type, minLength, type (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (18): 10. Final Audit Prompt Şablonu, 12. Test Stratejisi, 13. Kayıt tutmak (Logging) Neden Önemli?, 14. Lokal Model İçin Scope Nasıl Küçültülür?, 16. Bu Workflow Ne Zaman Kullanılmalı?, 17. RAG Backend Projesinden Çıkan Dersler, 18. Kısa Kontrol Listesi, 19. En Kısa Özet (+10 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (18): Multi-Collection Support, typescript, Başlıca Hata Kodları:, Health ve Readiness, Hızlı Kullanım Kılavuzu, Index Job, Kolleksiyon oluşturma, Kurulum (+10 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (16): Coding Agent İçin Uygulama Blueprint'i, Coding Agent Çalışma Sırası, Doğrulama Komutları, HTTP Hata Kodları, Registry Storage Kararı, Registry Åeması, `src/app.ts` ve `src/server.ts`, `src/collections/chromaCollections.ts` (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (12): resolveReadableCollection(), Express HTTP Framework, collectionCreateSchema, collectionUpdateSchema, ApiErrorCode, ApiErrorResponse, HttpError, createRequestContext() (+4 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (13): Faz 0.5: Test ve Bootstrap Hazirligi, Faz 0: Davranis Sozlesmesini Netlestir, Faz 1: RAG Core'u Collection-Aware Yap, Faz 2: Collection Registry Ekle, Faz 3: API Endpointlerini Yeniden Tasarla, Faz 4: Zero-Downtime Index/Rebuild, Faz 5: Backend Operasyonel Olgunluk, Faz 6: Test Frontend ve Dokumantasyon (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, rootDir (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (15): 10.1 Implement edildi, 10. Bu Repoda Implement Edilen Vanilla RAG Noktaları, 13. Bu Mimariyi Nasıl Okumalıyız?, 14. Sonuç, 1. Amaç ve Kapsam, 2. Vanilla RAG Backend Nedir?, 3. Bu Reponun Mimari Kararı, 4.1 Multi-Collection Control Plane (+7 more)

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (11): 5. Adım Adım Hybrid LLM Coding Workflow, Adım 10 — Tüm promptlar bitince yüksek kapasiteli modelle audit yap, Adım 1 — Geliştirilecek işi yüksek kapasiteli modele anlat, Adım 2 — Planı kendin oku ve revize ettir, Adım 3 — Planı cold start prompt paketlerine böldür, Adım 4 — Promptları kendin denetle, Adım 5 — Temiz başlangıç için git commit al, Adım 6 — Yeni branch aç (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (11): 10. Config Defaults Endpointi, 1. Job List Endpointi, 2. Admin Collection Detail Endpointi, 3. Collection Readiness Blockers/Warn Listesi, 4. Model Discovery Endpointi, 5. Collection Config Validation / Dry Run, 6. Job Progress, Logs ve Events, 7. Cleanup ve Physical Collection Görünürlüğü (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (16): 5.1.1 Mevcut Endpoint Yüzeyi, 5.1 API Katmanı, 5.2 RAG Orchestrator Katmanı, 5.3 Retrieval Katmanı, 5.4 Generation Katmanı, 5.5 İndeksleme Katmanı, 5.6 Konfigürasyon Katmanı, 5. Temel Bileşenler (+8 more)

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (9): description, minLength, type, properties, datasetName, schemaVersion, default, description (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (9): $defs, ozelgeBenchmarkItem, questionAnswerPair, additionalProperties, required, type, additionalProperties, required (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.22
Nodes (9): Değiştirilmeyecek Backend Kontratı, Endpoint İyileştirme Notları İçin Kural, Endpoint Kullanım Rehberi, Global Uygulama İlkeleri, Küçük Model / Cold Start Uygulama Rehberi, Ortak Doğrulama Komutları, Plan Tamlık Kontrol Listesi, RAG Admin Panel Development Plan (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.15
Nodes (22): CollectionRegistry, addMetadataToChunks(), buildPhysicalCollection(), cleanupRetiredPhysicalCollections(), DeletePhysicalCollectionFn, isPhysicalCollectionMissingError(), createIndexJobRunner(), IndexJobRunner (+14 more)

### Community 33 - "Community 33"
Cohesion: 0.22
Nodes (10): Chroma Vector Store, RAG Config YAML, Collection Defaults, Observability Config, Model Backpressure, Concurrency Strategy, Registry Model, Ollama LLM Gateway (+2 more)

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (7): additionalProperties, description, $id, required, $schema, title, type

### Community 35 - "Community 35"
Cohesion: 0.25
Nodes (8): properties, description, minLength, type, ozelgeId, sayi, description, type

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (8): Adım 3 - Create/Edit Form ve Payload Güvenliği, Backend Schema Özeti, Cold Start Prompt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (8): Adım 6 - Re-index Job Tracking ve Job Monitor, Cold Start Prompt, Gerçek Kısıt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (8): Admin Onboarding CLI Implementation Plan, Assumptions, CLI Behavior, Error Handling, Implementation Details, Key Changes, Summary, Test Plan

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (8): 11.1 Evaluation ve benchmark loop eksik, 11.2 Test stratejisi eksik, 11.3 Retrieval observability durumu, 11.4 Readiness katmanı var, ama gerçek RAG akışını bire bir garanti etmiyor, 11.5 Full-data indexing semantiği net değil, 11.6 Incremental indexing yok, 11.7 API hardening durumu, 11. Hâlâ Implement Edilmemiş veya Eksik Kalan Vanilla RAG Backend Noktaları

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (8): 8. Dosya Bazlı Mimari Eşleme, [docker-compose.yml](docker-compose.yml), [package.json](package.json), [src/app.ts](src/app.ts), [src/config.ts](src/config.ts), [src/index.ts](src/index.ts), [src/rag.ts](src/rag.ts), [src/server.ts](src/server.ts)

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (7): $ref, items, questions, description, items, minItems, type

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (6): Data Klasörü, RAG (Retrieval-Augmented Generation) sistemi, test.txt - Recursive ingestion test, index.html - Vanilla RAG Test Console, RAG API Endpoints (/v1/rag/collections), Vanilla RAG Test Console UI

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (7): Adım 1 - API Client, State Model ve Güvenli Render Temeli, Cold Start Prompt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (7): Adım 2 - Collections View ve Inspector Açılış Akışı, Cold Start Prompt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (7): Adım 4 - Collection Readiness ve Capability-Driven UI, Cold Start Prompt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (7): Adım 5 - Playground: Retrieve ve Query Sonuçlarının Kullanılabilir Render'ı, Cold Start Prompt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (7): Adım 7 - System Health Dashboard Detayları, Cold Start Prompt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 49 - "Community 49"
Cohesion: 0.29
Nodes (7): Adım 8 - UX Polish, Accessibility ve Responsive Stabilizasyon, Cold Start Prompt, Kullanıcıya Açıklanacak, Küçük Model İçin Alt Uygulama Sırası, Manuel Test, Testler, Yapılacaklar

### Community 50 - "Community 50"
Cohesion: 0.20
Nodes (14): assertChromaCollectionReadable(), buildCreateCollectionRequest(), chromaClientParams(), createPhysicalChromaCollection(), deletePhysicalChromaCollection(), isRecord(), listPhysicalChromaCollections(), normalizeChromaCollectionConfiguration() (+6 more)

### Community 51 - "Community 51"
Cohesion: 0.33
Nodes (6): 15. Sık Yapılan Hatalar, Hata 1 — Plan yazdırmadan kod yazdırmak, Hata 2 — Aynı session içinde çok prompt çalıştırmak, Hata 3 — done.md istememek, Hata 4 — Test komutu eklememek, Hata 5 — Pahalı modeli sadece kod yazdırmak için kullanmak

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (6): 4.1. Büyük işi küçük ve bağımsız parçalara böl, 4.2. Her prompt cold start çalışabilmeli, 4.3. Kod üzerinden bilgi aktar, sohbet geçmişi üzerinden değil, 4.4. Her adım sonunda iz bırak, 4.5. İnsan her zaman kontrol noktasında kalır, 4. Bu Yöntemin En Önemli Prensipleri

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (6): Değiştirilen Dosyalar, Prompt XX — <Başlık>, Sonraki Prompt İçin Notlar, Yapılamayanlar veya Riskler, Yapılanlar, Çalıştırılan Testler

### Community 54 - "Community 54"
Cohesion: 0.11
Nodes (19): answerCalls, AppRagAnswerHandler, AppRagHandlers, AppRagRetrieveHandler, availableOllamaModels, createQueuedJob(), operationalLogs, readablePhysicalCollections (+11 more)

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (6): 1. Collection Yaratma (Admin API), 2. Re-Index / Job Başlatma, 3. Job Durumunu Görüntüleme, Backend Yönetimi ve Admin Workflow, Operasyonel Config Yüzeyi, Sistem Onboarding (İlk Kurulum)

### Community 56 - "Community 56"
Cohesion: 0.35
Nodes (11): assertValidChromaCollectionName(), createPhysicalCollectionName(), generateCollectionId(), isIPv4AddressLike(), isValidChromaCollectionName(), normalizeText(), slugifyCollectionName(), slugifyPhysicalNamePart() (+3 more)

### Community 57 - "Community 57"
Cohesion: 0.23
Nodes (14): buildJobRecord(), clearJobSelection(), collectionNameById(), getJobViewEmptyMessage(), getJobViewRows(), getVisibleSelectableJobIds(), mergeActiveJobFromReadiness(), pruneSelectedJobIds() (+6 more)

### Community 58 - "Community 58"
Cohesion: 0.40
Nodes (5): 11. Git Disiplini, Başlangıç, Final merge, Hatalı agent değişikliğini geri alma, Her prompt sonrası

### Community 60 - "Community 60"
Cohesion: 0.40
Nodes (5): Adım 0 - Cold Start Audit ve Kapsam Kilidi, Cold Start Prompt, Kabul Kriteri, Kullanıcıya Açıklanacak, Yapılacaklar

### Community 61 - "Community 61"
Cohesion: 0.40
Nodes (5): Adım 9 - Final Contract Audit ve Handoff, Cold Start Prompt, Kullanıcıya Açıklanacak, Manuel Test Senaryo Seti, Yapılacaklar

### Community 62 - "Community 62"
Cohesion: 0.40
Nodes (5): Collection DTO, Collection Readiness DTO, Error DTO, Job DTO, Response Semantiği

### Community 63 - "Community 63"
Cohesion: 0.06
Nodes (46): analyzeSourcePath(), buildChangedFields(), buildCreateCollectionInput(), buildCreateValidationDraft(), buildImpact(), buildUpdateValidationDraft(), CollectionValidationDraft, CollectionValidationHealthChecks (+38 more)

### Community 64 - "Community 64"
Cohesion: 0.40
Nodes (5): Adım A: Registry Interface ve Kalıcı Registry Eklenir, Adım B: Lock ve Job State Eklenir, Adım C: RAG Core ve Indexing Versioned Physical Collection Modeline Geçirilir, Adım D: Yeni API ve Test Frontend Eski Endpointleri Silerek Eklenir, Doğrudan Hedef Mimariyi Uygulama Stratejisi

### Community 65 - "Community 65"
Cohesion: 0.16
Nodes (18): adminCollectionUrl(), clearCollectionIndexStateBanner(), clearCollectionValidation(), clearEditorForm(), closeInspector(), getValidationTitle(), handleOverlayClick(), hasValidationBlockers() (+10 more)

### Community 66 - "Community 66"
Cohesion: 0.18
Nodes (12): buildCollectionIndexSnapshot(), buildCollectionIndexState(), isDistanceMetric(), parseCollectionIndexSnapshot(), parseCollectionIndexSnapshotJson(), CollectionIndexSnapshot, CollectionIndexState, CollectionStatus (+4 more)

### Community 67 - "Community 67"
Cohesion: 0.15
Nodes (17): clampInteger(), CollectionRow, createSqliteCollectionRegistry(), decodeJobCursor(), encodeJobCursor(), ensureColumn(), IndexJobRow, IndexJobSummaryRow (+9 more)

### Community 68 - "Community 68"
Cohesion: 0.25
Nodes (9): LangChain Framework, Zero-Downtime Index/Rebuild Plan, langchain, Logical Collection, Onboarding CLI, Physical Chroma Collection, Retention Cleanup, Stale Job Recovery (+1 more)

### Community 69 - "Community 69"
Cohesion: 0.29
Nodes (6): Admin API, RAG API, Readiness System, Benchmark Runner Gap, Ollama Model Validation Gap, Test Coverage Gap

### Community 70 - "Community 70"
Cohesion: 0.12
Nodes (28): createAdminRouter(), buildCollectionReadinessPayload(), CollectionReadinessHealthChecks, CollectionReadinessIssue, CollectionReadinessPayload, makeIssue(), errorHandler(), notFoundHandler() (+20 more)

### Community 83 - "Community 83"
Cohesion: 0.15
Nodes (13): Canonical Admin Workflow, Canonical End-User RAG Workflow, Core Mental Model, Error Handling Rules, Frontend Agent Handoff, Goal, Non-Negotiable Integration Rules, Polling Guidance (+5 more)

### Community 84 - "Community 84"
Cohesion: 0.33
Nodes (6): Güvenlik eksikleri, Kalan Backend Eksikleri - Sade Özet, Konfigürasyon ve doğrulama eksikleri, Operasyonel görünürlük eksikleri, Readiness ve durum açıklığı eksikleri, Sonuç

### Community 85 - "Community 85"
Cohesion: 0.40
Nodes (5): Kalan Backend Eksikleri - Öncelik Sırası, Kısa karar kuralı, P1 - Panelin doğru çalışması için kritik, P2 - Kullanıcı deneyimini güçlendiren eksikler, P3 - Operasyon şeffaflığı ve bakım

### Community 86 - "Community 86"
Cohesion: 0.19
Nodes (16): createBadge(), createReadinessRow(), getCollectionCardStatusBadge(), getCollectionCardStatusNote(), getCollectionCardStatusPresentation(), getStatusBadge(), getStatusColor(), hasDependencyBlocker() (+8 more)

### Community 87 - "Community 87"
Cohesion: 0.20
Nodes (10): Base Rules, `GET /`, `GET /health`, `GET /ready`, Public Collection DTO, Public Error Codes, Public RAG API Reference, Rate Limiting And Body Limits (+2 more)

### Community 88 - "Community 88"
Cohesion: 0.22
Nodes (9): Faz 0.5: Test ve Bootstrap Hazırlığı, Faz 0: Davranış Sözleşmesini Netleştir, Faz 1: RAG Core'u Collection-Aware Yap, Faz 2: Collection Registry Ekle, Faz 3: API Endpointlerini Yeniden Tasarla, Faz 4: Zero-Downtime Index/Rebuild, Faz 5: Backend Operasyonel Olgunluk, Faz 6: Test Frontend ve Dokümantasyon (+1 more)

### Community 89 - "Community 89"
Cohesion: 0.22
Nodes (9): `package.json` ve Test Altyapısı, Repo ile Mevcut Durum Karşılaştırması, `src/admin/onboard.ts`, `src/config.ts`, `src/index.ts`, `src/ingestion/pipeline.ts`, `src/rag.ts`, `src/server.ts` (+1 more)

### Community 90 - "Community 90"
Cohesion: 0.33
Nodes (4): PhysicalCollectionStatus, collectionInput, context, seedPhysical()

### Community 91 - "Community 91"
Cohesion: 0.14
Nodes (21): CliOptions, DISTANCE_METRICS, main(), parseArgs(), printConfigSummary(), printSourceAnalysis(), promptBoolean(), promptConfig() (+13 more)

### Community 92 - "Community 92"
Cohesion: 0.50
Nodes (4): description, minLength, type, konu

### Community 95 - "Community 95"
Cohesion: 0.25
Nodes (8): Admin API Reference, Admin Error Codes, Collection Configuration Fields, Create request, Immediate vs Reindex-Bound Fields, Practical Frontend Rules, Request Headers, Update request

### Community 96 - "Community 96"
Cohesion: 0.40
Nodes (5): description, minItems, type, uniqueItems, ozelgeler

### Community 97 - "Community 97"
Cohesion: 0.25
Nodes (8): Collection Endpoints, `DELETE /v1/admin/collections/:collectionId`, `GET /v1/admin/collections/:collectionId`, `PATCH /v1/admin/collections/:collectionId`, `POST /v1/admin/collections`, `POST /v1/admin/collections/:collectionId/reindex`, `POST /v1/admin/collections/:collectionId/validate`, `POST /v1/admin/collections/validate`

### Community 98 - "Community 98"
Cohesion: 0.50
Nodes (4): tarih, description, pattern, type

### Community 99 - "Community 99"
Cohesion: 0.50
Nodes (4): Concurrency Stratejisi, Index/Rebuild Path, Ollama ve Chroma Backpressure, Query/Retrieve Path

### Community 100 - "Community 100"
Cohesion: 0.20
Nodes (6): Fast Integration Summary, Reading Order, Source Of Truth, Suggested Prompt For End Users, Vanilla RAG Backend Documentation, Which File To Give A Coding Agent

### Community 101 - "Community 101"
Cohesion: 0.33
Nodes (6): `DELETE /v1/admin/jobs/:jobId`, `GET /v1/admin/jobs`, `GET /v1/admin/jobs/:jobId`, Job Endpoints, `POST /v1/admin/jobs/bulk-delete`, `POST /v1/admin/jobs/:jobId/cancel`

### Community 102 - "Community 102"
Cohesion: 0.33
Nodes (6): `GET /v1/rag/collections`, `GET /v1/rag/collections/:collectionId`, `GET /v1/rag/collections/:collectionId/ready`, `POST /v1/rag/collections/:collectionId/query`, `POST /v1/rag/collections/:collectionId/retrieve`, Public Endpoints

### Community 103 - "Community 103"
Cohesion: 0.40
Nodes (5): 12. Tasarım Trade-off'ları, Trade-off 1: Basitlik vs kalite, Trade-off 2: Tek orkestratör dosyası vs daha fazla ayrışım, Trade-off 3: Full reset index vs incremental updates, Trade-off 4: Lokal model bağımlılığı vs taşınabilirlik

### Community 104 - "Community 104"
Cohesion: 0.50
Nodes (4): sourceFile, description, minLength, type

### Community 105 - "Community 105"
Cohesion: 0.08
Nodes (35): answerQuestion(), ChatGenerationHealthDetails, checkChatGenerationHealth(), chromaClientParams(), ChromaHealthDetails, contentToString(), createChatModel(), createEmbeddings() (+27 more)

## Ambiguous Edges - Review These
- `Döngünün Tam Şeması (Full Cycle Diagram)` → `Adım Adım Hybrid LLM Coding Workflow`  [AMBIGUOUS]
  egitim/image/egitim_icerigi/1782318515814.png · relation: conceptually_related_to
- `Döngünün Tam Şeması (Full Cycle Diagram)` → `En Önemli Prensipler (Key Principles)`  [AMBIGUOUS]
  egitim/image/egitim_icerigi/1782318515814.png · relation: conceptually_related_to
- `Döngünün Tam Şeması (Full Cycle Diagram)` → `Zihinsel Model (Mental Model Diagram)`  [AMBIGUOUS]
  egitim/image/egitim_icerigi/1782318515814.png · relation: conceptually_related_to
- `Adım Adım Hybrid LLM Coding Workflow` → `En Önemli Prensipler (Key Principles)`  [AMBIGUOUS]
  egitim/image/egitim_icerigi/1782318538498.png · relation: conceptually_related_to
- `Adım Adım Hybrid LLM Coding Workflow` → `Zihinsel Model (Mental Model Diagram)`  [AMBIGUOUS]
  egitim/image/egitim_icerigi/1782318538498.png · relation: conceptually_related_to
- `En Önemli Prensipler (Key Principles)` → `Zihinsel Model (Mental Model Diagram)`  [AMBIGUOUS]
  egitim/image/egitim_icerigi/1782318549808.png · relation: conceptually_related_to

## Knowledge Gaps
- **657 isolated node(s):** `$schema`, `plugin`, `@opencode-ai/plugin`, `API`, `EDIT_FIELD_IDS` (+652 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Döngünün Tam Şeması (Full Cycle Diagram)` and `Adım Adım Hybrid LLM Coding Workflow`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Döngünün Tam Şeması (Full Cycle Diagram)` and `En Önemli Prensipler (Key Principles)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Döngünün Tam Şeması (Full Cycle Diagram)` and `Zihinsel Model (Mental Model Diagram)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Adım Adım Hybrid LLM Coding Workflow` and `En Önemli Prensipler (Key Principles)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Adım Adım Hybrid LLM Coding Workflow` and `Zihinsel Model (Mental Model Diagram)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `En Önemli Prensipler (Key Principles)` and `Zihinsel Model (Mental Model Diagram)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Express HTTP Framework` connect `Community 22` to `Community 32`, `Community 68`, `Community 70`, `Community 15`, `Community 20`, `Community 54`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._