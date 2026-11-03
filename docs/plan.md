# Issue Triage Action: plan

Kararlar 2026-11-04. Kapsam tam (sadeleştirme yok), ayrı public repo, GitHub Marketplace'e çıkar. Mevcut repolara eklenmez.

## Problem

Açık kaynak bir repoda issue'lar düzensiz gelir: etiketsiz, öncelik belirsiz, aynı hata ikinci kez açılmış, hata kaydında sürüm ve adımlar yok. Bakımcı her issue'yu okuyup etiketlemek, "hangi sürüm?" diye sormak ve tekrarları bulmak zorunda kalır.

## Benzerleri (kısa inceleme)

- **actions/labeler, stale gibi kural tabanlı Action'lar:** dosya yoluna ya da süreye bakar, issue metnini anlamaz.
- **GitHub'ın kendi AI örnekleri (actions/ai-inference ile yazılan iş akışları):** tek bir prompt, çıktı doğrulaması ve tekrar tespiti yok.
- **Dosu, ücretli triage botları:** kurulum, hesap ve ücret gerektirir.

Bizim farkımız: anahtarsız (GitHub Models + `GITHUB_TOKEN`), çıktısı şemaya ve reponun etiketlerine göre doğrulanan, tekrarı embedding ile bulan, issue'yu kapatmayan ve sadece bir yorum yazan bir Action.

## Özellikler

1. **Tür:** bug, feature, question, docs.
2. **Etiketler:** sadece repoda zaten var olan etiketlerden; yeni etiket açılmaz. Tür ve öncelik için repoda karşılık gelen etiket varsa (ör. `bug`, `P1`) o da eklenir.
3. **Öncelik:** P0-P3 ve tek cümlelik gerekçe.
4. **Olası tekrarlar:** son açık ve kapalı issue'lar arasından embedding benzerliğiyle aday bulunur, model adaylardan gerçekten aynı olanları seçer; yorumda `#12` gibi bağlantı.
5. **Eksik bilgi:** hata kaydında sürüm, adımlar, beklenen/gerçek sonuç yoksa issue sahibinden istenir.
6. **Tek yorum:** gizli bir işaretle (`<!-- issue-triage -->`) bulunur; issue düzenlenince aynı yorum güncellenir. Yorum issue'nun dilinde (Türkçe ya da İngilizce, diğer diller İngilizce).
7. **Atlama:** etiketi olan issue (bakımcı etiketlemiş), bot açtığı issue ve pull request atlanır. Bot daha önce yorum yazdıysa düzenlemede yorum güncellenir, insanın eklediği etiketlere dokunulmaz.
8. **Ayarlar (inputs):** model, aday sayısı, benzerlik eşiği, `dry-run` (etiket/yorum yazmadan sadece günlüğe yazar). **Çıktılar (outputs):** tür, öncelik, etiketler, tekrar adayları; sonraki adımlar kullanabilir.

## Akış

```
issues: opened / edited
  → atlama kuralları
  → reponun etiketleri + son N issue (REST)
  → embedding (yeni issue + adaylar, tek toplu istek) → kosinüs benzerliği → eşiği geçen ilk k aday
  → sohbet modeli (tek istek, JSON şeması) → zod ile doğrulama
  → etiket ekle + yorumu yaz/güncelle
```

Model ya da ağ hatasında Action uyarı yazar ve başarılı biter (issue akışını bloklamaz); yalnızca ayar hataları (yanlış input) Action'ı kırmızıya çevirir.

## Teknoloji ve gerekçesi

| Seçim | Neden | Alternatif |
|---|---|---|
| **TypeScript, JavaScript Action (`node24`)** | Action'ların yerel türü; Docker Action'a göre saniyeler içinde başlar, her işletim sisteminde çalışır | Docker Action (yavaş açılış, sadece Linux), composite + Python |
| **@actions/core, @actions/github (Octokit)** | Resmî araç takımı: input/output, günlük, kimlikli REST istemcisi | Elle fetch |
| **GitHub Models (sohbet + embedding)** | `GITHUB_TOKEN` ve `models: read` izniyle çalışır; anahtar, hesap, ücret yok | OpenAI/Gemini anahtarı (her kullanıcı secret eklemek zorunda) |
| **zod** | Modelin JSON cevabını çalışma anında doğrular, TypeScript türünü aynı şemadan üretir | Elle kontrol, ajv |
| **@vercel/ncc** | Action'ı bağımlılıklarıyla tek `dist/index.js` dosyasına paketler; `node_modules` repoya girmez | rollup, esbuild |
| **Vitest** | Hızlı, TypeScript'i ayarsız çalıştırır; ağ istekleri sahte istemciyle | Jest |

GitHub Models ücretsiz katmanının kotası modele göre değişir; varsayılan model küçük ve kotası geniş olandan seçilir (ilk parçada güncel kotaya bakılır). Embedding uç noktasının güncel adresi de ilk parçada doğrulanır.

## Güvenlik

- **Prompt injection:** public repoda issue'yu herkes yazar. Issue metni sistem talimatından ayrı, sınırlandırılmış veri olarak verilir; modelin cevabı ne derse desin yalnızca şemadaki alanlar kullanılır.
- **Çıktıya güvenilmez:** etiketler reponun etiket listesiyle kesiştirilir, tekrar adayları yalnızca bizim gönderdiğimiz aday numaralarından olabilir, öncelik enum.
- **Yorum metni şablondan üretilir:** model serbest metin yazmaz; gerekçe ve eksik bilgi alanları kısaltılır, `@` anmaları ve bağlantılar etkisizleştirilir (kimse etiketlenmez, oltalama linki çıkmaz), Markdown kaçışlanır.
- **En az yetki:** örnek iş akışında `issues: write`, `contents: read`, `models: read`; `pull_request_target` kullanılmaz.
- **Kota kötüye kullanımı:** metin kırpılır (üst sınır), aday sayısı sınırlı; issue başına en fazla 2 model isteği.
- Bağımlılıklar yayından önce `npm audit` ile kontrol edilir.

## Testler

Birim: atlama kuralları, kosinüs ve aday seçimi, şema doğrulaması (bozuk JSON, bilinmeyen etiket, aday dışı numara, boş alanlar), yorum şablonu (anma/bağlantı etkisizleştirme, iki dil), yorum bulma/güncelleme. Entegrasyon: sahte GitHub ve Models istemcisiyle uçtan uca çalıştırma; 429/5xx'te çökmeme. Güvenlik testleri kural bozularak doğrulanır.

## Yayın

- Repo kendi issue'larında kendini çalıştırır (`uses: ./`); ekran görüntüleri buradan.
- `dist/` repoda tutulur; CI `dist/`'in kaynakla güncel olduğunu kontrol eder.
- SEO'dan sonra `v1.0.0` etiketi + Release + taşınan `v1` etiketi; Marketplace'e Release sırasında çıkar. Marketplace'te görünen ad benzersiz olmalı ("Issue Triage Action" dolu); ad Release öncesi seçilir.
- Kendi sitesi yok: SEO portfolyo proje sayfası, repo açıklaması/topics, README ilk paragrafı ve Marketplace açıklamasıyla yapılır.

## Issue'lar ve sprintler

Sprint 1 (4-10 Kas):
1. chore: TypeScript iskeleti, action.yml, ncc, Vitest, CI (test + dist güncel mi)
2. feat: issue okuma ve atlama kuralları
3. feat: GitHub Models istemcisi (sohbet + embedding, hata ve 429 yönetimi)
4. feat: embedding ile tekrar adayları
5. feat: sınıflandırma prompt'u, JSON şeması, zod doğrulaması
6. feat: etiket ekleme ve tek yorum (yaz/güncelle, TR/EN şablon, temizleme)

Sprint 2 (11-17 Kas):
7. feat: inputs/outputs ve dry-run
8. test: prompt injection ve kenar durumları
9. chore: repoda kendi kendini çalıştıran iş akışı, canlı deneme
10. docs: README (TR/EN) ve ekran görüntüleri
11. chore: son tarama (bağımlılıklar, izinler)
12. chore: SEO, Marketplace adı, v1.0.0 Release
