# Multidoc DocumentLoader Ingestion Plan

## Summary

Repo şu an `ozelge_veri.json` + `pdfText` şemasına bağlı. Planı, mevcut `data/` içeriğiyle uyumlu olacak şekilde genişletiyoruz: `.txt`, `.md`, `.pdf`, `.doc`, `.docx` ve özelge JSON tek ingestion akışında indexlenecek. Özelge adapter’ı korunacak; dosya tabanlı kaynaklar LangChain loader’larıyla okunacak.

## Key Changes

- Config:
  - `data.sourcePath: data` eklenecek ve yeni ingestion’ın ana kaynağı olacak.
  - `data.ozelgeDataPath` korunacak; `sourcePath` içinde bu JSON görülürse özelge adapter’ı kullanılacak.
  - `config.ts` schema/export alanları `sourcePath` ile genişletilecek.
- Dependencies:
  - `@langchain/classic` explicit dependency yapılacak.
  - `pdf-parse`, `word-extractor`, `mammoth` eklenecek.
- Loader mapping:
  - `.txt`, `.md`: `@langchain/classic/document_loaders/fs/text`
  - `.pdf`: `@langchain/community/document_loaders/fs/pdf`
  - `.doc`: `DocxLoader(path, { type: "doc" })`
  - `.docx`: `DocxLoader(path, { type: "docx" })`
  - özelge JSON: mevcut `loadOzelgeRecords()` + `toDocuments()` adapter’ı
- Ortak metadata:
  - `documentId`, `sourcePath`, `sourceType`, `chunkIndex`
  - özelge için ayrıca `ozelgeId`, `sayi`, `tarih`, `konu`
  - file document id formatı deterministic olacak: `file:<path-hash>:<loader-doc-index>`
  - özelge document id formatı: `ozelge:<evrakOid veya record-index>`

## Implementation Changes

- `src/ingestion/pipeline.ts` genel mixed-source pipeline’a dönüşecek:
  - `sourcePath` dosyaysa tek dosya, klasörse mevcut `data/` dosyaları okunacak.
  - İlk sürümde recursive okuma yapılmayacak.
  - Unsupported extension hata vermeyecek; analysis sonucunda `unsupportedFiles` olarak raporlanacak.
  - Tüm loader çıktıları `normalizeText()` ile temizlenecek, boş içerikler elenecek.
- `src/index.ts` ozelge-specific health tiplerini genelleştirecek:
  - `sourcePath`, `fileCount`, `loadedDocumentCount`, `documentCount`, `unsupportedFiles`, `indexSampleSize`, `sampleLimited`
  - Chroma ids artık `${documentId}:${chunkIndex}` olacak; özelge dışı dosyalarda `ozelgeId` beklenmeyecek.
- `src/rag.ts` retrieval source contract’ı genişletilecek:
  - `RagSource` içine `documentId`, `sourcePath`, `sourceType`, `chunkIndex` eklenecek.
  - `formatContext()` özelge yoksa file metadata label’ı kullanacak.
  - error summary ve `/rag/retrieve` response yeni metadata’yı gösterecek.
- `src/server.ts` readiness dili genelleşecek:
  - `DATA_FILE_READABLE` yerine source odaklı mesajlar.
  - `non-empty pdfText` ifadeleri “indexable document content” olarak değişecek.
  - recommended action artık sadece JSON dosyasını değil `data.sourcePath` değerini referans alacak.

## Test Plan

- `npm run build`
- `npm run index`
- Index loglarında şu kaynakların yüklendiğini doğrula:
  - `Canakkale.txt`
  - `README.md`
  - `Genclige_Hitabe.pdf`
  - `Istiklal_Marsi.doc`
  - `Istiklal_Marsi.docx`
  - `ozelge_veri.json`
- `GET /ready?details=true` çıktısında `pdfText` referansı kalmadığını doğrula.
- `/rag/retrieve` ile dosya tabanlı bir soru sorup `sourcePath`, `sourceType`, `documentId`, `chunkIndex` döndüğünü doğrula.
- Mevcut özelge sorularında `ozelgeId`, `sayi`, `tarih`, `konu` metadata’sının korunmasını doğrula.

## Assumptions

- `.json` desteği v1’de yalnızca `ozelge_veri.json` özel adapter’ı anlamına gelir; generic JSON mapping bu iterasyonun dışında.
- CSV, JSONL ve recursive directory ingestion bu plana dahil değil.
- `indexSampleSize` özelge JSON adapter’ında örneklenecek kayıt sayısına uygulanır. `0` değeri limit yok anlamına gelir. Dosya tabanlı `.txt`, `.md`, `.pdf`, `.doc` ve `.docx` kaynaklar bu limit yüzünden index dışı bırakılmaz.
