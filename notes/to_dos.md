**Development Notes**

**@82uzman:** Sorulan sorunun türüne göre klasik RAG, Vanilla RAG ya da agentic RAG mi kullanacağız; kullandığımız LLM thinking modu açık mı kapalı mı olacak kısmını yine router'daki LLM karar verecek dimi hocam?

---

**TODO: Admin indexing endpoint**

- Indexleme su anda bilerek HTTP endpoint degil; `npm.cmd run index` ile operasyonel komut olarak calisiyor.
- Mevcut akis Chroma collection'i silip bastan yazdigi icin public endpoint olarak acilmamali.
- V1 icin hedef yuzey:
  - `POST /admin/index/rebuild`: auth/admin korumali, tek seferde bir job calistiran rebuild tetikleyici.
  - `GET /admin/index/status`: running/succeeded/failed, startedAt/finishedAt, indexed chunk count ve last error bilgisi.
- Uygulama notu: `src/index.ts` icindeki CLI `main()` reusable `runIndexingJob()` benzeri export edilen bir fonksiyona ayrilmali.
- Kabul kriteri: ayni anda ikinci rebuild istegi reddedilmeli; job sonucu `/ready` ve test frontend ile gozlemlenebilir olmali.
