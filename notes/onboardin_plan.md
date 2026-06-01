# Admin Onboarding CLI Implementation Plan

> **LEGACY PLAN / G�NCEL DE��L**: Bu dok�man eski single-collection yap�s�na g�re planlanm��t�r. G�ncel Multi-Collection onboarding, job runner ve Admin API y�netimi i�in do�rudan [README.md](../README.md) ve [vanilla_rag_backend_mimarisi.md](../vanilla_rag_backend_mimarisi.md) dosyalar�na bak�n�z.

## Summary

Bu plan, mevcut repo gerçeklerine göre onboarding CLI için uygulanacak plandır. Hedef, admin’in `config/rag.config.yaml` dosyasını elle düzenlemek ve sonra `npm.cmd run index` çalıştırmak yerine tek komutla ayarları gözden geçirip doğrulaması ve index pipeline’ı çalıştırmasıdır.

Yeni komut:

```powershell
npm.cmd run onboard
```

CLI şu akışı yönetecek: config oku, admin’e ayarları sor, config’i doğrula/yaz, source analysis yap, Chroma/Ollama readiness kontrollerini göster, açık reset onayı al, index pipeline’ı çalıştır.

## Key Changes

- `package.json`:
  - `"onboard": "tsx src/admin/onboard.ts"` script’i eklenecek.
- Yeni CLI:
  - `src/admin/onboard.ts`
  - Node built-in `readline/promises` kullanılacak; yeni prompt paketi eklenmeyecek.
- `src/config.ts` refactor:
  - Mevcut `export const config` korunacak.
  - Ek reusable API eklenecek:
    - `readConfigFile(configPath?)`
    - `parseConfig(raw)`
    - `resolveConfig(raw)`
    - `loadConfig(configPath?)`
    - `writeConfigFile(raw, configPath?)`
  - `RawConfig` ve `ResolvedConfig` type’ları export edilecek.
- `src/rag.ts` refactor:
  - Mevcut public fonksiyonlar ve default `config` kullanan davranış korunacak.
  - Health, vector store ve model factory mantığı resolved config parametresi alabilecek hale getirilecek.
  - Bu refactor yapılmadan `--config <path>` güvenli değildir; aksi halde CLI farklı config okurken `rag.ts` default `config/rag.config.yaml` değerlerini kullanabilir.
- `src/index.ts` refactor:
  - Mevcut `main()` içindeki indexing akışı `runIndexing(resolvedConfig, options?)` olarak export edilecek.
  - `npm.cmd run index` aynı fonksiyonu mevcut config ile çağırmaya devam edecek.
- `todos.md`:
  - Yeni “Admin onboarding CLI yok” başlığı eklenecek.
  - Onboarding tamamlanınca bu başlık `Yapildi/Kalanlar` formatına çevrilecek.
- README:
  - `npm.cmd run onboard`
  - `npm.cmd run onboard -- --dry-run`
  - `npm.cmd run onboard -- --yes`
  - `npm.cmd run onboard -- --skip-index`
    kullanımı eklenecek.

## CLI Behavior

- Default interactive mode:
  - Mevcut config değerleri gösterilir.
  - Boş cevap mevcut değeri korur.
  - Sayısal alanlar parse edilir; invalid giriş tekrar sorulur.
  - `chroma.distanceMetric` sadece `l2`, `cosine`, `ip` kabul eder.
  - `data.indexSampleSize = 0` için açıklama gösterilir: “all parsed ozelge records”.
- CLI flags:
  - `--dry-run`: config okur, validate eder, source/dependency özetini gösterir; config yazmaz, index çalıştırmaz.
  - `--yes`: prompt sormadan mevcut config ile validation, source/dependency checks ve index çalıştırır.
  - `--skip-index`: config wizard + validation + source/dependency checks çalışır; index çalışmaz.
  - `--config <path>`: alternatif config dosyası kullanır; default `config/rag.config.yaml`.
  - `--no-write`: interactive wizard çalışır ama final config dosyasına yazılmaz; sadece validation/source/dependency kontrolleri yapılır.
- Prompt edilecek config alanları:
  - `server.port`
  - `chroma.url`, `chroma.collection`, `chroma.distanceMetric`
  - `ollama.baseUrl`, `ollama.chatModel`, `ollama.embeddingModel`, `ollama.numCtx`, `ollama.numPredict`
  - `data.sourcePath`, `data.ozelgeDataPath`, `data.indexSampleSize`
  - `rag.chunkSize`, `rag.chunkOverlap`, `rag.retrievalK`, `rag.retrievalDistanceThreshold`, `rag.timeoutMs`
  - `readiness.timeoutMs`, `readiness.embeddingProbeText`, `readiness.chatProbeText`

## Implementation Details

- Implementation order:
  1. `config.ts` reusable load/parse/resolve/write API'sine ayrılır.
  2. `rag.ts` default config davranışı korunarak config-injected factory/check fonksiyonları eklenir.
  3. `index.ts` `runIndexing(resolvedConfig, options)` export edecek şekilde refactor edilir.
  4. `src/admin/onboard.ts` CLI eklenir.
  5. `package.json`, README ve `todos.md` güncellenir.
- Config writing:
  - İlk sürüm canonical YAML yazar; mevcut yorumları birebir korumak şart değil.
  - `yaml` paketi zaten mevcut, ek dependency gerekmiyor.
  - Yazmadan önce config dosyasının `.bak` yedeği alınacak: `rag.config.yaml.bak`.
  - `--dry-run` ve `--no-write` modlarında dosya yazılmaz ve backup alınmaz.
- Source analysis:
  - `analyzeMixedIndexingSource()` doğrudan `ResolvedConfig` değerleriyle çağrılacak.
  - CLI şunları gösterecek:
    - `sourcePath`
    - file count
    - supported source files
    - unsupported files
    - loaded/indexable document count
    - ozelge `recordCount`, `sampledRecordCount`, `sampleLimited`
- Dependency checks:
  - `checkChromaHealth(resolvedConfig)`
  - `checkOllamaHealth(resolvedConfig)`
  - `checkEmbeddingHealth(resolvedConfig)`
  - `checkChatGenerationHealth(resolvedConfig)`
  - Mevcut argümansız fonksiyonlar server için kalacak ve default `config` ile bu injected varyantları çağıracak.
- Index pipeline:
  - `runIndexing()` parametre olarak `ResolvedConfig` alacak.
  - Chroma vector store, embeddings ve reset işlemleri bu config üzerinden üretilecek.
  - Böylece `--config <path>` hem validation hem health hem index aşamasında aynı ayarları kullanacak.
- Index reset confirmation:
  - Interactive mode’da index öncesi zorunlu açık onay alınacak:
    ```text
    This will reset Chroma collection "<collection>" at <url> and rebuild the index. Continue? (y/N)
    ```
  - `--yes` bu onayı otomatik `yes` sayar.
- Blocking rules:
  - Chroma unreachable ise index çalıştırılmaz.
  - Ollama unreachable ise index çalıştırılmaz.
  - Embedding model missing/failing ise index çalıştırılmaz.
  - Chat model missing/failing index için blocker değildir, ama query readiness warning olarak gösterilir.
  - Source analysis `documentCount = 0` döndürürse index çalıştırılmaz.
  - Unsupported source files warning’dir, blocker değildir.
- Server başlatma:
  - CLI backend server başlatmaz.
  - Başarılı onboarding sonunda şu next step gösterilir:
    ```powershell
    npm.cmd run dev
    ```

## Error Handling

- YAML parse hatası:
  - Dosya path’i ve parse hatası gösterilir.
  - CLI non-zero exit code ile çıkar.
- Config validation hatası:
  - Zod issue path + message listelenir.
  - Interactive modda admin tüm config prompt’larını tekrar geçer ve validation yeniden çalışır.
  - `--yes` modunda non-zero exit.
- Config write hatası:
  - Hata mesajı gösterilir.
  - Index çalıştırılmaz.
  - CLI non-zero exit code ile çıkar.
- Source analysis hatası:
  - `data.sourcePath` veya `data.ozelgeDataPath` kaynaklı hata açık yazılır.
  - Bozuk JSON dosyası varsa JSON parse hatası gösterilir.
- Index hatası:
  - Hata mesajı gösterilir.
  - Config yazılmışsa geri alınmaz.
  - CLI non-zero exit code ile çıkar.

## Test Plan

- Build:
  ```powershell
  npm.cmd run build
  ```
- Dry run:
  ```powershell
  npm.cmd run onboard -- --dry-run
  ```

  Beklenen: config yazılmaz, index çalışmaz, source/dependency summary görünür.
- Non-interactive validation:
  ```powershell
  npm.cmd run onboard -- --yes --skip-index
  ```

  Beklenen: prompt yok, config validation + source/dependency checks var, index yok.
- Full onboarding:
  ```powershell
  npm.cmd run onboard -- --yes
  ```

  Beklenen: Chroma/Ollama hazırsa index pipeline çalışır.
- Alternate config:
  ```powershell
  npm.cmd run onboard -- --config config/rag.config.yaml --dry-run
  ```

  Beklenen: validation, health ve source analysis aynı config dosyasındaki değerlerle çalışır.
- Regression:
  ```powershell
  npm.cmd run index
  npm.cmd run dev
  ```

  Beklenen: mevcut script’ler kırılmaz.
- Validation scenario:
  - `rag.chunkOverlap >= rag.chunkSize` geçici config ile denenir.
  - CLI validation bunu yakalar.
- Data scenario:
  - `data.indexSampleSize: 0` tüm parse edilen ozelge kayıtlarını alır.
  - Pozitif değer sadece ozelge JSON sample limitidir.
  - Dosya tabanlı `txt/md/pdf/doc/docx` kaynaklar bu limit yüzünden düşmez.

## Assumptions

- İlk sürüm full rebuild yapar; incremental/upsert onboarding kapsamı dışında.
- CLI config yorumlarını korumak zorunda değildir.
- Benchmark runner onboarding kapsamına dahil değildir.
- Admin onboarding lokal/operasyonel CLI’dır; HTTP admin endpoint veya auth bu planın kapsamına girmez.
- Dosya adı repo içinde mevcut haliyle `onboardin_plan.md` kalabilir; README/TODO referansları bu mevcut dosya adıyla tutarlı olmalıdır.
