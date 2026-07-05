/**
 * Web Build brief intelligence.
 *
 * Real users write low-detail prompts ("peyzaj mimarı için site yap"). Korvix
 * must infer the whole strategy — industry, audience, conversion goal, CTA,
 * tone, visual style, section structure, motion — instead of requiring the user
 * to spell out design details.
 *
 * `inferWebsiteBrief(prompt, lang)` detects the industry from the prompt and
 * returns a structured brief from an industry playbook (localized EN/TR; other
 * locales fall back to EN). It is used to (a) fill any brief fields the backend
 * didn't return and (b) synthesize an industry-appropriate section set + copy
 * when the backend reply was thin — so even a one-line prompt yields a real,
 * premium, industry-specific site.
 */
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

export type IndustryKey =
  | 'ai_saas' | 'fitness' | 'landscaping' | 'furniture' | 'automotive'
  | 'restaurant' | 'portfolio' | 'agency' | 'ecommerce' | 'local_service' | 'generic';

export interface InferredBrief {
  industry: IndustryKey;
  /** The layout blueprint — different archetypes get different section shapes. */
  layoutArchetype: string;
  businessType: string;
  targetAudience: string;
  conversionGoal: string;
  primaryCTA: string;
  secondaryCTA: string;
  tone: string;
  visualStyle: string;
  recommendedSections: string[];
  recommendedMotion: string;
  trustSignals: string;
  previewVisualIdea: string;
  /** A natural, research-flavored strategy line for the feed. */
  strategyNote: string;
  heroHeadline: string;
  heroSub: string;
  /** Industry offerings used to fill card sections with real-feeling copy. */
  items: string[];
}

type Lang = 'en' | 'tr' | string;
const L = (lang: Lang, en: string, tr: string) => (lang === 'tr' ? tr : en);

/** Layout blueprint per industry — drives which distinct section shapes render. */
const ARCHETYPE: Record<IndustryKey, string> = {
  landscaping: 'portfolio-consultation', ai_saas: 'product-demo-saas',
  furniture: 'editorial-catalog', automotive: 'inventory-trust',
  fitness: 'appointment-coach', restaurant: 'menu-reservation',
  portfolio: 'case-study', agency: 'service-casestudy',
  ecommerce: 'product-catalog', local_service: 'service-booking', generic: 'standard',
};

/** A short, natural "here's what strong sites in this niche do" line. */
function strategyNoteFor(k: IndustryKey, lang: Lang): string {
  const notes: Record<IndustryKey, [string, string]> = {
    landscaping: ['Strong landscaping sites lead with a project gallery, a before/after story, and a clear consultation request — I\'m structuring it that way.', 'Peyzaj sitelerindeki güçlü örneklerde portfolyo galerisi, önce/sonra anlatımı ve net bir keşif talebi öne çıkıyor. Yapıyı buna göre kuruyorum.'],
    ai_saas: ['Great AI/SaaS pages open with a live product/chat demo, then features, metrics and integrations toward a demo CTA — building it that way.', 'İyi AI/SaaS sayfaları canlı bir ürün/sohbet demosuyla açılıp özellikler, metrikler ve entegrasyonlarla demo CTA\'sına gidiyor. Yapıyı buna göre kuruyorum.'],
    furniture: ['Premium furniture sites are editorial: collections, materials and a gallery leading to a showroom visit — structuring it that way.', 'Premium mobilya siteleri editoryal olur: koleksiyonlar, malzemeler ve galeri showroom ziyaretine götürür. Yapıyı buna göre kuruyorum.'],
    automotive: ['Dealership sites showcase featured inventory with trust and financing, driving to a test drive — building it that way.', 'Oto galeri siteleri öne çıkan araçları güven ve finansmanla sunup test sürüşüne yönlendirir. Yapıyı buna göre kuruyorum.'],
    fitness: ['Coaching sites focus on programs, process and results with an appointment CTA — structuring it that way.', 'Koçluk siteleri programlar, süreç ve sonuçlara odaklanıp randevu CTA\'sıyla ilerler. Yapıyı buna göre kuruyorum.'],
    restaurant: ['Restaurant sites highlight the menu and ambiance with a reservation CTA — building it that way.', 'Restoran siteleri menü ve ambiyansı öne çıkarıp rezervasyon CTA\'sı kullanır. Yapıyı buna göre kuruyorum.'],
    portfolio: ['Portfolios lead with selected work as case studies and a clear project CTA — structuring it that way.', 'Portfolyolar seçili işleri vaka çalışması olarak öne çıkarıp net bir proje CTA\'sı kullanır. Yapıyı buna göre kuruyorum.'],
    agency: ['Agency sites pair a service stack with case studies and a booking CTA — building it that way.', 'Ajans siteleri hizmet listesini vaka çalışmaları ve görüşme CTA\'sıyla birleştirir. Yapıyı buna göre kuruyorum.'],
    ecommerce: ['Product sites spotlight collections and benefits with a shop CTA — structuring it that way.', 'Ürün siteleri koleksiyon ve faydaları öne çıkarıp satın alma CTA\'sı kullanır. Yapıyı buna göre kuruyorum.'],
    local_service: ['Local service sites build trust with services, process and reviews toward a booking — structuring it that way.', 'Yerel hizmet siteleri hizmetler, süreç ve yorumlarla güven kurup randevuya yönlendirir. Yapıyı buna göre kuruyorum.'],
    generic: ['I\'m shaping a focused, conversion-first structure for this business.', 'Bu işletme için dönüşüm odaklı, net bir yapı kuruyorum.'],
  };
  const n = notes[k];
  return L(lang, n[0], n[1]);
}

/** Build a unicode-boundary keyword regex. Plain `\b` fails around Turkish
 *  letters (ı, ç, ş, ğ, ö, ü aren't \w), so use letter-class lookarounds. */
const kw = (...words: string[]) =>
  new RegExp(`(?<![\\p{L}])(?:${words.join('|')})(?![\\p{L}])`, 'iu');

/** Keyword detectors, most specific first. */
const DETECTORS: { key: IndustryKey; re: RegExp }[] = [
  { key: 'ai_saas', re: kw('ai', 'yapay zeka', 'makine öğren\\p{L}*', 'chatbot', 'chat bot', 'saas', 'müşteri destek', 'destek botu', 'dashboard', 'api', 'platform', 'otomasyon', 'automation', 'analytics', 'analitik', 'yazılım') },
  { key: 'fitness', re: kw('fitness', 'koç\\p{L}*', 'antren\\p{L}*', 'spor salon\\p{L}*', 'gym', 'pilates', 'yoga', 'diyet\\p{L}*', 'beslenme', 'personal train\\p{L}*') },
  { key: 'landscaping', re: kw('peyzaj\\p{L}*', 'bahçe\\p{L}*', 'landscap\\p{L}*', 'garden', 'dış mekan\\p{L}*', 'çevre düzenleme', 'yeşil alan') },
  { key: 'furniture', re: kw('mobilya\\p{L}*', 'furniture', 'iç mimar\\p{L}*', 'interior', 'dekorasyon', 'koltuk', 'ahşap', 'marangoz') },
  { key: 'automotive', re: kw('araba\\p{L}*', 'araç\\p{L}*', 'oto galeri\\p{L}*', 'oto ?galeri\\p{L}*', 'car dealer\\p{L}*', 'dealership', 'vehicle', 'test sürüş\\p{L}*', 'otomotiv', 'automotive') },
  { key: 'restaurant', re: kw('restoran\\p{L}*', 'restaurant', 'cafe', 'kafe', 'menü\\p{L}*', 'lokanta', 'bistro', 'mutfak', 'coffee shop', 'fine dining', 'pastane\\p{L}*', 'fırın', 'bakery', 'patisserie') },
  { key: 'ecommerce', re: kw('mağaza\\p{L}*', 'e-?ticaret\\p{L}*', 'e-?commerce', 'online satış\\p{L}*', 'online store', 'shop', 'storefront') },
  { key: 'portfolio', re: kw('portfolyo\\p{L}*', 'portfolio', 'freelance\\p{L}*', 'kişisel site', 'tasarımcı\\p{L}*', 'designer portfolio', 'fotoğrafçı\\p{L}*', 'photographer') },
  { key: 'agency', re: kw('ajans\\p{L}*', 'agency', 'studio', 'stüdyo', 'reklam ajans\\p{L}*', 'marketing agency', 'dijital ajans\\p{L}*', 'prodüksiyon') },
];

export function detectIndustry(prompt: string): IndustryKey {
  const p = (prompt || '').toLowerCase();
  for (const d of DETECTORS) if (d.re.test(p)) return d.key;
  // A trade word → local service (appointment/quote pattern).
  if (kw('berber\\p{L}*', 'kuaför\\p{L}*', 'güzellik', 'klinik\\p{L}*', 'diş\\p{L}*', 'avukat\\p{L}*', 'danışman\\p{L}*', 'emlak\\p{L}*', 'temizlik', 'tesisat\\p{L}*', 'boya\\p{L}*', 'nakliyat', 'clinic', 'salon', 'lawyer', 'consult\\p{L}*', 'real estate').test(p)) return 'local_service';
  return 'generic';
}

type Playbook = Omit<InferredBrief, 'layoutArchetype' | 'strategyNote'>;

/** The industry playbook — sections, CTA, tone, motion, hero copy, offerings. */
function playbook(industry: IndustryKey, lang: Lang): Playbook {
  switch (industry) {
    case 'ai_saas':
      return {
        industry, businessType: L(lang, 'AI product / SaaS', 'AI ürünü / SaaS'),
        targetAudience: L(lang, 'startups, support & ecommerce teams', 'startuplar, destek ve e-ticaret ekipleri'),
        conversionGoal: L(lang, 'demo booking / free trial', 'demo planlama / ücretsiz deneme'),
        primaryCTA: L(lang, 'Book a demo', 'Demo planla'),
        secondaryCTA: L(lang, 'Try it free', 'Ücretsiz dene'),
        tone: L(lang, 'modern, technical, trustworthy', 'modern, teknik, güven veren'),
        visualStyle: L(lang, 'clean modern SaaS, dark premium', 'temiz modern SaaS, koyu premium'),
        recommendedSections: ['hero', 'product-demo', 'features', 'workflow', 'metrics', 'integrations', 'pricing', 'faq', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'animated product/chat demo card, moving gradient grid', 'animasyonlu ürün/sohbet demo kartı, hareketli gradient grid'),
        trustSignals: L(lang, 'logos, uptime, SOC2, customer metrics', 'logolar, uptime, SOC2, müşteri metrikleri'),
        previewVisualIdea: L(lang, 'floating chat/dashboard preview with metrics', 'metrikli, havada duran sohbet/dashboard önizlemesi'),
        heroHeadline: L(lang, 'Automate customer support with an AI that actually resolves tickets', 'Talepleri gerçekten çözen bir yapay zekâ ile müşteri desteğini otomatikleştir'),
        heroSub: L(lang, 'Deploy an AI support agent in minutes — it answers instantly, escalates smartly, and learns from every conversation.', 'Dakikalar içinde bir AI destek asistanı devreye al — anında yanıtlar, akıllıca yönlendirir ve her görüşmeden öğrenir.'),
        items: L(lang,
          'Instant AI replies|Smart escalation to humans|Trained on your docs|Multichannel (web, email, WhatsApp)|Analytics & CSAT tracking|One-click integrations',
          'Anında AI yanıtları|İnsana akıllı yönlendirme|Dökümanlarınla eğitim|Çok kanallı (web, e-posta, WhatsApp)|Analitik ve CSAT takibi|Tek tıkla entegrasyonlar').split('|'),
      };
    case 'fitness':
      return {
        industry, businessType: L(lang, 'fitness coaching', 'fitness koçluğu'),
        targetAudience: L(lang, 'people wanting sustainable results', 'sürdürülebilir sonuç isteyen bireyler'),
        conversionGoal: L(lang, 'free intro consultation', 'ücretsiz ön görüşme'),
        primaryCTA: L(lang, 'Book a free intro call', 'Ücretsiz ön görüşme planla'),
        secondaryCTA: L(lang, 'See programs', 'Programları gör'),
        tone: L(lang, 'motivating, premium, personal', 'motive edici, premium, kişisel'),
        visualStyle: L(lang, 'premium, energetic, mobile-first', 'premium, enerjik, mobil öncelikli'),
        recommendedSections: ['hero', 'programs', 'process', 'results', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'soft animated gradient hero, reveal cards', 'yumuşak animasyonlu gradient hero, beliren kartlar'),
        trustSignals: L(lang, 'client transformations, certifications', 'danışan dönüşümleri, sertifikalar'),
        previewVisualIdea: L(lang, 'transformation/process cards + appointment CTA', 'dönüşüm/süreç kartları + randevu CTA'),
        heroHeadline: L(lang, 'Premium coaching built around your goals', 'Hedeflerine göre tasarlanmış premium fitness koçluğu'),
        heroSub: L(lang, 'A personal training plan, a sustainable nutrition approach, and steady weekly check-ins.', 'Sana özel antrenman planı, sürdürülebilir beslenme yaklaşımı ve düzenli haftalık takip.'),
        items: L(lang,
          'Personalized training plan|Sustainable nutrition|Weekly check-ins|Progress tracking|1:1 messaging support|Mobile workout access',
          'Kişisel antrenman planı|Sürdürülebilir beslenme|Haftalık takip|İlerleme ölçümü|Birebir mesaj desteği|Mobil antrenman erişimi').split('|'),
      };
    case 'landscaping':
      return {
        industry, businessType: L(lang, 'landscape design', 'peyzaj mimarlığı'),
        targetAudience: L(lang, 'homeowners, villa owners, businesses', 'ev/villa sahipleri, işletmeler'),
        conversionGoal: L(lang, 'consultation request', 'keşif / danışmanlık talebi'),
        primaryCTA: L(lang, 'Request a free site visit', 'Ücretsiz keşif talep et'),
        secondaryCTA: L(lang, 'View projects', 'Projeleri incele'),
        tone: L(lang, 'natural, premium, architectural', 'doğal, premium, mimari'),
        visualStyle: L(lang, 'organic, editorial, image-first', 'organik, editoryal, görsel öncelikli'),
        recommendedSections: ['hero', 'gallery', 'services', 'before-after', 'process', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'subtle organic gradient, gallery reveal', 'ince organik gradient, galeri beliriş animasyonu'),
        trustSignals: L(lang, 'completed projects, before/after', 'tamamlanan projeler, öncesi/sonrası'),
        previewVisualIdea: L(lang, 'project gallery cards of outdoor transformations', 'dış mekan dönüşümlerinden proje galeri kartları'),
        heroHeadline: L(lang, 'Outdoor spaces designed with architectural precision', 'Mimari hassasiyetle tasarlanan dış mekanlar'),
        heroSub: L(lang, 'From concept to planting — gardens, terraces and courtyards designed and built for how you live.', 'Konseptten uygulamaya — yaşam biçimine göre tasarlanıp hayata geçirilen bahçeler, teraslar ve avlular.'),
        items: L(lang,
          'Garden & terrace design|Planting & irrigation|Lighting & hardscape|Pool & water features|Maintenance plans|3D concept visuals',
          'Bahçe ve teras tasarımı|Bitkilendirme ve sulama|Aydınlatma ve sert zemin|Havuz ve su öğeleri|Bakım planları|3B konsept görselleri').split('|'),
      };
    case 'furniture':
      return {
        industry, businessType: L(lang, 'furniture & interiors', 'mobilya ve iç mekan'),
        targetAudience: L(lang, 'homeowners, interior designers', 'ev sahipleri, iç mimarlar'),
        conversionGoal: L(lang, 'browse collection / showroom visit', 'koleksiyon inceleme / showroom ziyareti'),
        primaryCTA: L(lang, 'Explore the collection', 'Koleksiyonu incele'),
        secondaryCTA: L(lang, 'Book a showroom visit', 'Showroom randevusu al'),
        tone: L(lang, 'warm, premium, editorial', 'sıcak, premium, editoryal'),
        visualStyle: L(lang, 'editorial, visual-first, refined', 'editoryal, görsel öncelikli, zarif'),
        recommendedSections: ['hero', 'collections', 'materials', 'gallery', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'slow product gallery, soft reveal cards', 'yavaş ürün galerisi, yumuşak beliren kartlar'),
        trustSignals: L(lang, 'craftsmanship, materials, warranty', 'ustalık, malzeme, garanti'),
        previewVisualIdea: L(lang, 'editorial product grid + material cards', 'editoryal ürün gridi + malzeme kartları'),
        heroHeadline: L(lang, 'Furniture made to live with for years', 'Yıllarca birlikte yaşanacak mobilyalar'),
        heroSub: L(lang, 'Considered design and honest materials — pieces crafted for real homes, not showrooms.', 'Özenli tasarım ve dürüst malzemeler — showroom için değil, gerçek evler için üretilen parçalar.'),
        items: L(lang,
          'Living room collections|Bespoke production|Solid wood & fabrics|Dining & bedroom|Interior consulting|Delivery & assembly',
          'Oturma odası koleksiyonları|Özel üretim|Masif ahşap ve kumaşlar|Yemek ve yatak odası|İç mekan danışmanlığı|Teslimat ve montaj').split('|'),
      };
    case 'automotive':
      return {
        industry, businessType: L(lang, 'car dealership', 'oto galeri'),
        targetAudience: L(lang, 'buyers looking for new/used cars', 'sıfır/ikinci el araç arayan alıcılar'),
        conversionGoal: L(lang, 'inventory inquiry / test drive', 'araç sorgusu / test sürüşü'),
        primaryCTA: L(lang, 'Browse inventory', 'Araçları incele'),
        secondaryCTA: L(lang, 'Book a test drive', 'Test sürüşü planla'),
        tone: L(lang, 'bold, trustworthy, performance', 'iddialı, güvenilir, performans odaklı'),
        visualStyle: L(lang, 'bold, dark, high-contrast', 'iddialı, koyu, yüksek kontrast'),
        recommendedSections: ['hero', 'inventory', 'financing', 'process', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'vehicle cards, subtle speed-line gradient', 'araç kartları, ince hız-çizgisi gradient'),
        trustSignals: L(lang, 'warranty, inspection, financing', 'garanti, ekspertiz, finansman'),
        previewVisualIdea: L(lang, 'featured vehicle cards + financing band', 'öne çıkan araç kartları + finansman bandı'),
        heroHeadline: L(lang, 'Find your next car with total confidence', 'Bir sonraki aracını tam bir güvenle bul'),
        heroSub: L(lang, 'Hand-picked, fully inspected vehicles with transparent pricing and flexible financing.', 'Özenle seçilmiş, tam ekspertizli araçlar; şeffaf fiyat ve esnek finansman ile.'),
        items: L(lang,
          'Certified used cars|Full inspection report|Flexible financing|Trade-in valuation|Extended warranty|Test drive at home',
          'Sertifikalı ikinci el araçlar|Tam ekspertiz raporu|Esnek finansman|Takas değerleme|Uzatılmış garanti|Adrese test sürüşü').split('|'),
      };
    case 'restaurant':
      return {
        industry, businessType: L(lang, 'restaurant', 'restoran'),
        targetAudience: L(lang, 'local diners & groups', 'yerel misafirler ve gruplar'),
        conversionGoal: L(lang, 'reservation', 'rezervasyon'),
        primaryCTA: L(lang, 'Reserve a table', 'Masa ayırt'),
        secondaryCTA: L(lang, 'View the menu', 'Menüyü gör'),
        tone: L(lang, 'warm, inviting, refined', 'sıcak, davetkâr, zarif'),
        visualStyle: L(lang, 'atmospheric, appetizing, editorial', 'atmosferik, iştah açıcı, editoryal'),
        recommendedSections: ['hero', 'menu', 'gallery', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'soft ambiance fade, menu reveal', 'yumuşak ambiyans geçişi, menü beliriş'),
        trustSignals: L(lang, 'reviews, chef, hours & location', 'yorumlar, şef, saatler ve konum'),
        previewVisualIdea: L(lang, 'menu highlights + ambiance gallery', 'menü öne çıkanları + ambiyans galerisi'),
        heroHeadline: L(lang, 'A seasonal table worth coming back for', 'Tekrar gelmeye değer, mevsimlik bir sofra'),
        heroSub: L(lang, 'Fresh, seasonal cooking in a warm room — reserve your table for lunch or dinner.', 'Sıcak bir mekânda taze, mevsimlik lezzetler — öğle ya da akşam için masanı ayırt.'),
        items: L(lang,
          'Seasonal menu|Signature dishes|Wine pairing|Private events|Weekend brunch|Central location',
          'Mevsim menüsü|İmza tabaklar|Şarap eşleştirme|Özel etkinlikler|Hafta sonu brunch|Merkezi konum').split('|'),
      };
    case 'portfolio':
      return {
        industry, businessType: L(lang, 'personal portfolio', 'kişisel portfolyo'),
        targetAudience: L(lang, 'potential clients & recruiters', 'potansiyel müşteriler ve işverenler'),
        conversionGoal: L(lang, 'contact / project inquiry', 'iletişim / proje talebi'),
        primaryCTA: L(lang, 'Start a project', 'Projeye başla'),
        secondaryCTA: L(lang, 'View work', 'Çalışmaları gör'),
        tone: L(lang, 'confident, minimal, personal', 'kendinden emin, minimal, kişisel'),
        visualStyle: L(lang, 'minimal, typographic, refined', 'minimal, tipografik, zarif'),
        recommendedSections: ['hero', 'work', 'services', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'scroll reveal of case studies', 'vaka çalışmalarının scroll beliriş animasyonu'),
        trustSignals: L(lang, 'selected work, clients', 'seçili işler, müşteriler'),
        previewVisualIdea: L(lang, 'case-study grid + intro', 'vaka çalışması gridi + tanıtım'),
        heroHeadline: L(lang, 'Design that makes products feel effortless', 'Ürünleri zahmetsiz hissettiren tasarım'),
        heroSub: L(lang, 'Selected product and brand work — from first concept to shipped interface.', 'Seçili ürün ve marka çalışmaları — ilk konseptten yayınlanan arayüze.'),
        items: L(lang,
          'Product design|Brand identity|Design systems|Prototyping|Web design|Art direction',
          'Ürün tasarımı|Marka kimliği|Tasarım sistemleri|Prototipleme|Web tasarımı|Sanat yönetimi').split('|'),
      };
    case 'agency':
      return {
        industry, businessType: L(lang, 'creative agency', 'yaratıcı ajans'),
        targetAudience: L(lang, 'growing brands & founders', 'büyüyen markalar ve kurucular'),
        conversionGoal: L(lang, 'discovery call', 'tanışma görüşmesi'),
        primaryCTA: L(lang, 'Book a call', 'Görüşme planla'),
        secondaryCTA: L(lang, 'See case studies', 'Vaka çalışmaları'),
        tone: L(lang, 'bold, credible, strategic', 'iddialı, güvenilir, stratejik'),
        visualStyle: L(lang, 'bold, modern, high-contrast', 'iddialı, modern, yüksek kontrast'),
        recommendedSections: ['hero', 'services', 'work', 'process', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'reveal case studies, gradient accents', 'vaka çalışması beliriş, gradient vurgular'),
        trustSignals: L(lang, 'results, client logos', 'sonuçlar, müşteri logoları'),
        previewVisualIdea: L(lang, 'service stack + case study grid', 'hizmet listesi + vaka çalışması gridi'),
        heroHeadline: L(lang, 'Brand and growth work that moves the numbers', 'Rakamları hareket ettiren marka ve büyüme işleri'),
        heroSub: L(lang, 'Strategy, brand and campaigns for teams that need results, not decks.', 'Sunum değil sonuç isteyen ekipler için strateji, marka ve kampanya.'),
        items: L(lang,
          'Brand strategy|Performance marketing|Content & social|Web & product|Creative direction|Analytics & reporting',
          'Marka stratejisi|Performans pazarlama|İçerik ve sosyal|Web ve ürün|Kreatif yönetim|Analitik ve raporlama').split('|'),
      };
    case 'ecommerce':
      return {
        industry, businessType: L(lang, 'online store', 'online mağaza'),
        targetAudience: L(lang, 'online shoppers', 'online alışveriş yapanlar'),
        conversionGoal: L(lang, 'shop / preorder', 'satın al / ön sipariş'),
        primaryCTA: L(lang, 'Shop now', 'Alışverişe başla'),
        secondaryCTA: L(lang, 'View bestsellers', 'Çok satanları gör'),
        tone: L(lang, 'clean, product-first, premium', 'temiz, ürün öncelikli, premium'),
        visualStyle: L(lang, 'product-first, premium retail', 'ürün öncelikli, premium perakende'),
        recommendedSections: ['hero', 'collections', 'features', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'product spotlight, soft reveal', 'ürün vurgusu, yumuşak beliriş'),
        trustSignals: L(lang, 'reviews, returns, secure checkout', 'yorumlar, iade, güvenli ödeme'),
        previewVisualIdea: L(lang, 'product spotlight + benefit cards', 'ürün vurgusu + fayda kartları'),
        heroHeadline: L(lang, 'Products people actually keep', 'İnsanların gerçekten sakladığı ürünler'),
        heroSub: L(lang, 'Thoughtfully made essentials with fast shipping and easy returns.', 'Özenle üretilmiş temel ürünler; hızlı kargo ve kolay iade ile.'),
        items: L(lang,
          'New arrivals|Bestsellers|Free & fast shipping|Easy 30-day returns|Secure checkout|Loyalty rewards',
          'Yeni gelenler|Çok satanlar|Ücretsiz hızlı kargo|30 gün kolay iade|Güvenli ödeme|Sadakat ödülleri').split('|'),
      };
    case 'local_service':
      return {
        industry, businessType: L(lang, 'local service', 'yerel hizmet'),
        targetAudience: L(lang, 'nearby customers', 'çevredeki müşteriler'),
        conversionGoal: L(lang, 'appointment / quote', 'randevu / teklif'),
        primaryCTA: L(lang, 'Book an appointment', 'Randevu al'),
        secondaryCTA: L(lang, 'Get a quote', 'Teklif al'),
        tone: L(lang, 'trustworthy, local, clear', 'güvenilir, yerel, net'),
        visualStyle: L(lang, 'clean, approachable, premium', 'temiz, samimi, premium'),
        recommendedSections: ['hero', 'services', 'process', 'testimonials', 'faq', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'subtle gradient, reveal cards', 'ince gradient, beliren kartlar'),
        trustSignals: L(lang, 'reviews, experience, guarantees', 'yorumlar, deneyim, garantiler'),
        previewVisualIdea: L(lang, 'service cards + booking CTA', 'hizmet kartları + randevu CTA'),
        heroHeadline: L(lang, 'Reliable service, booked in minutes', 'Güvenilir hizmet, dakikalar içinde randevulu'),
        heroSub: L(lang, 'Experienced local specialists with transparent pricing and on-time service.', 'Şeffaf fiyat ve zamanında hizmet sunan deneyimli yerel uzmanlar.'),
        items: L(lang,
          'Expert specialists|Transparent pricing|On-time service|Satisfaction guarantee|Easy online booking|Local & trusted',
          'Uzman kadro|Şeffaf fiyatlandırma|Zamanında hizmet|Memnuniyet garantisi|Kolay online randevu|Yerel ve güvenilir').split('|'),
      };
    default:
      return {
        industry: 'generic', businessType: L(lang, 'business', 'işletme'),
        targetAudience: L(lang, 'your customers', 'müşterileriniz'),
        conversionGoal: L(lang, 'contact', 'iletişim'),
        primaryCTA: L(lang, 'Get started', 'Hemen başla'),
        secondaryCTA: L(lang, 'Learn more', 'Daha fazla bilgi'),
        tone: L(lang, 'clear, modern, premium', 'net, modern, premium'),
        visualStyle: L(lang, 'clean, modern, premium', 'temiz, modern, premium'),
        recommendedSections: ['hero', 'features', 'process', 'testimonials', 'final-cta', 'footer'],
        recommendedMotion: L(lang, 'subtle gradient background, reveal cards', 'ince gradient arka plan, beliren kartlar'),
        trustSignals: L(lang, 'social proof, guarantees', 'sosyal kanıt, garantiler'),
        previewVisualIdea: L(lang, 'feature cards + strong CTA', 'özellik kartları + güçlü CTA'),
        heroHeadline: L(lang, 'A better way to get it done', 'İşini daha iyi yapmanın yolu'),
        heroSub: L(lang, 'Everything you need in one clean, modern experience — built to convert.', 'İhtiyacın olan her şey; temiz, modern ve dönüşüm için tasarlanmış tek bir deneyimde.'),
        items: L(lang,
          'Fast & reliable|Made for your goals|Simple to start|Premium quality|Responsive support|Clear pricing',
          'Hızlı ve güvenilir|Hedeflerine uygun|Başlaması kolay|Premium kalite|Hızlı destek|Net fiyatlandırma').split('|'),
      };
  }
}

/** Infer the full website strategy from a (possibly one-line) prompt. */
export function inferWebsiteBrief(prompt: string, lang: Lang = 'en'): InferredBrief {
  const industry = detectIndustry(prompt || '');
  return {
    ...playbook(industry, lang),
    layoutArchetype: ARCHETYPE[industry],
    strategyNote: strategyNoteFor(industry, lang),
  };
}

/** Alias — the strategy IS the brief (industry, sections, layout, motion, copy). */
export const inferWebsiteStrategy = inferWebsiteBrief;

/* ── Design system per industry ───────────────────────────────────────────
 * A different typographic personality + palette + rhythm per niche, so a
 * landscaping studio doesn't look like a SaaS dashboard. Uses only CSS font
 * stacks (no network fonts). The preview document reads these via CSS vars. */
export interface DesignTokens {
  /** Page background. */ bg: string;
  /** Heading font stack. */ headingFont: string;
  /** Body font stack. */ bodyFont: string;
  /** Primary accent (CTAs, glows). */ accent: string;
  /** Secondary accent. */ accent2: string;
  /** Heading letter-spacing. */ tracking: string;
  /** Corner radius for cards. */ radius: string;
}

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';

const TOKENS: Record<IndustryKey, DesignTokens> = {
  ai_saas:      { bg: '#05070d', headingFont: SANS,  bodyFont: SANS, accent: '#6366f1', accent2: '#22d3ee', tracking: '-0.025em', radius: '0.9rem' },
  fitness:      { bg: '#0a0710', headingFont: SANS,  bodyFont: SANS, accent: '#f97316', accent2: '#22d3ee', tracking: '-0.02em',  radius: '1rem' },
  landscaping:  { bg: '#071009', headingFont: SERIF, bodyFont: SANS, accent: '#34d399', accent2: '#a3e635', tracking: '-0.005em', radius: '1.25rem' },
  furniture:    { bg: '#0d0b08', headingFont: SERIF, bodyFont: SANS, accent: '#d6a35c', accent2: '#8b5e34', tracking: '0em',       radius: '1rem' },
  automotive:   { bg: '#05060a', headingFont: SANS,  bodyFont: SANS, accent: '#e11d48', accent2: '#f59e0b', tracking: '-0.03em',  radius: '0.75rem' },
  restaurant:   { bg: '#0e0a07', headingFont: SERIF, bodyFont: SANS, accent: '#e0a35b', accent2: '#b45309', tracking: '0.01em',   radius: '1.1rem' },
  portfolio:    { bg: '#08080a', headingFont: SANS,  bodyFont: SANS, accent: '#e5e7eb', accent2: '#94a3b8', tracking: '-0.04em',  radius: '0.75rem' },
  agency:       { bg: '#07070e', headingFont: SANS,  bodyFont: SANS, accent: '#8b5cf6', accent2: '#ec4899', tracking: '-0.03em',  radius: '1rem' },
  ecommerce:    { bg: '#0a0a0c', headingFont: SANS,  bodyFont: SANS, accent: '#ec4899', accent2: '#f59e0b', tracking: '-0.02em',  radius: '1.1rem' },
  local_service:{ bg: '#060a12', headingFont: SANS,  bodyFont: SANS, accent: '#0ea5e9', accent2: '#22c55e', tracking: '-0.015em', radius: '1rem' },
  generic:      { bg: '#05070d', headingFont: SANS,  bodyFont: SANS, accent: '#6366f1', accent2: '#22d3ee', tracking: '-0.02em',  radius: '1rem' },
};

/** Palette hints derived from the model's stated color/mood direction — used
 *  for ideas that don't map to a known industry, so unusual/sophisticated
 *  concepts still get a distinct, fitting palette instead of default indigo. */
const COLOR_HINTS: { re: RegExp; accent: string; accent2: string; bg: string }[] = [
  { re: /(green|emerald|botanic|garden|nature|forest|peyzaj|yeşil|organic|\beco)/i, accent: '#34d399', accent2: '#a3e635', bg: '#071009' },
  { re: /(amber|gold|warm|dining|wood|ahşap|sıcak|terracotta|earth|honey)/i,        accent: '#e0a35b', accent2: '#b45309', bg: '#0e0a07' },
  { re: /(crimson|scarlet|luxur|bold|kırmızı|metallic|racing|noir gold)/i,           accent: '#e11d48', accent2: '#f59e0b', bg: '#05060a' },
  { re: /(sky|\bblue|cyan|tech|trust|clinical|medical|mavi|clean|glacial)/i,          accent: '#0ea5e9', accent2: '#22d3ee', bg: '#060a12' },
  { re: /(violet|purple|indigo|creative|mor|neon|electric)/i,                         accent: '#8b5cf6', accent2: '#ec4899', bg: '#07070e' },
  { re: /(pink|rose|magenta|pembe|coral)/i,                                           accent: '#ec4899', accent2: '#f59e0b', bg: '#0a0a0c' },
  { re: /(mono|black|minimal|monochrome|noir|siyah|stark|brutalist)/i,                accent: '#e5e7eb', accent2: '#94a3b8', bg: '#08080a' },
];

/** Resolve the design tokens for a preview brief. Industry inference is only a
 *  starting point; when the concept is generic, the palette is driven by the
 *  model's own color/mood/metaphor direction so different ideas look different. */
export function designTokensForBrief(
  brief: {
    type?: string; style?: string; goal?: string; colorDirection?: string; visualMood?: string; visualMetaphor?: string;
    /** Explicit palette from the UI / Art Director agent — wins over inference. */
    artAccent?: string; artAccent2?: string; artBg?: string; artHeadingSerif?: boolean;
  } | undefined,
): DesignTokens {
  const text = `${brief?.type || ''} ${brief?.style || ''} ${brief?.goal || ''} ${brief?.colorDirection || ''} ${brief?.visualMood || ''} ${brief?.visualMetaphor || ''}`;
  const industry = detectIndustry(text);
  let base = TOKENS[industry] || TOKENS.generic;
  if (industry === 'generic') {
    const hintSource = `${brief?.colorDirection || ''} ${brief?.visualMood || ''} ${brief?.visualMetaphor || ''} ${brief?.style || ''} ${brief?.type || ''}`;
    const hint = COLOR_HINTS.find((h) => h.re.test(hintSource));
    if (hint) base = { ...base, accent: hint.accent, accent2: hint.accent2, bg: hint.bg };
  }
  // The Art Director's explicit palette is the source of truth when present — so
  // Art Direction actually drives the preview/files instead of a generic default.
  if (brief?.artAccent || brief?.artAccent2 || brief?.artBg || brief?.artHeadingSerif !== undefined) {
    base = {
      ...base,
      accent: brief.artAccent || base.accent,
      accent2: brief.artAccent2 || base.accent2,
      bg: brief.artBg || base.bg,
      headingFont: brief.artHeadingSerif === true ? SERIF : brief.artHeadingSerif === false ? SANS : base.headingFont,
    };
  }
  return base;
}

const humanize = (id: string, lang: Lang): string => {
  const map: Record<string, { en: string; tr: string }> = {
    hero: { en: 'Hero', tr: 'Hero' },
    services: { en: 'Services', tr: 'Hizmetler' },
    features: { en: 'Features', tr: 'Özellikler' },
    gallery: { en: 'Gallery', tr: 'Galeri' },
    collections: { en: 'Collections', tr: 'Koleksiyonlar' },
    materials: { en: 'Materials', tr: 'Malzemeler' },
    inventory: { en: 'Inventory', tr: 'Araçlar' },
    financing: { en: 'Financing', tr: 'Finansman' },
    'product-demo': { en: 'Product demo', tr: 'Ürün demosu' },
    workflow: { en: 'How it works', tr: 'Nasıl çalışır' },
    integrations: { en: 'Integrations', tr: 'Entegrasyonlar' },
    metrics: { en: 'By the numbers', tr: 'Rakamlarla' },
    results: { en: 'Results', tr: 'Sonuçlar' },
    programs: { en: 'Programs', tr: 'Programlar' },
    'before-after': { en: 'Before & after', tr: 'Önce & sonra' },
    process: { en: 'How it works', tr: 'Nasıl çalışır' },
    menu: { en: 'Menu', tr: 'Menü' },
    work: { en: 'Selected work', tr: 'Seçili işler' },
    pricing: { en: 'Pricing', tr: 'Fiyatlandırma' },
    testimonials: { en: 'Testimonials', tr: 'Yorumlar' },
    faq: { en: 'FAQ', tr: 'Sıkça sorulanlar' },
    'final-cta': { en: 'Get started', tr: 'Hemen başla' },
    footer: { en: 'Footer', tr: 'Alt bilgi' },
  };
  const e = map[id];
  return e ? L(lang, e.en, e.tr) : id.replace(/[-_]/g, ' ');
};

const pascal = (id: string) => id.replace(/(^|[-_ ]+)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '') || 'Section';

/**
 * Synthesize an industry-appropriate section set with real-feeling copy from an
 * inferred brief — used when the backend reply had too few sections to build a
 * real site. Card sections get a slice of the industry offerings as bullets.
 */
export function fallbackSectionItems(b: InferredBrief, lang: Lang = 'en'): WebBuildSectionItem[] {
  const items = b.items.length ? b.items : ['—'];
  let cursor = 0;
  const takeBullets = (n: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) { out.push(items[cursor % items.length]); cursor += 1; }
    return out;
  };
  return b.recommendedSections.map((id) => {
    const name = humanize(id, lang);
    const base: WebBuildSectionItem = { id, name, component: `${pascal(id)}.tsx` };
    if (/hero/.test(id)) {
      return { ...base, headline: b.heroHeadline, sub: b.heroSub, cta: b.primaryCTA, bullets: [b.secondaryCTA, b.trustSignals], copyPreview: b.heroHeadline };
    }
    if (/footer/.test(id)) {
      return { ...base, headline: b.businessType, bullets: [b.primaryCTA, b.secondaryCTA], copyPreview: b.businessType };
    }
    if (/final-cta|cta/.test(id)) {
      return { ...base, headline: L(lang, 'Ready to get started?', 'Başlamaya hazır mısın?'), sub: b.heroSub, cta: b.primaryCTA, bullets: [], copyPreview: b.primaryCTA };
    }
    if (/testimonial/.test(id)) {
      return { ...base, headline: L(lang, 'What clients say', 'Müşteriler ne diyor'), bullets: takeBullets(2), copyPreview: name };
    }
    // Card-style section: a heading + a slice of the offerings.
    return { ...base, headline: name, sub: '', bullets: takeBullets(3), purpose: b.previewVisualIdea, copyPreview: name };
  });
}

/* ── Quality gate ─────────────────────────────────────────────────────── */
export interface QualityReport {
  hasSpecificHeadline: boolean;
  hasClearCTA: boolean;
  hasIndustryRelevantSections: boolean;
  hasFiles: boolean;
  hasLocalizedCopy: boolean;
  ok: boolean;
}

const GENERIC_HEADLINE = /^(your website|hoş geldin|welcome|hayallerinize ulaş|geleceği keşfet|işinizi büyüt|your headline)/i;
/** Full English marketing phrases that must NOT appear in a Turkish build.
 *  (Standalone labels like "Testimonials" are our own humanized defaults and are
 *  localized elsewhere — only flag phrases that signal English-language copy.) */
const ENGLISH_HEADING = /\b(what our clients|frequently asked questions|get started today|why choose us|about us|contact us|read more|learn more|book now|our services|view all|shop now|sign up free|our story)\b/i;

/** Lightweight quality gate. When `lang` is 'tr', English headings/CTAs fail
 *  the localization check so a mixed-language reply is repaired to Turkish. */
export function checkQuality(
  sectionItems: WebBuildSectionItem[],
  fileCount: number,
  lang: Lang = 'en',
): QualityReport {
  const hero = sectionItems.find((s) => /hero/.test(`${s.id} ${s.name}`.toLowerCase()));
  const headline = hero?.headline || '';
  const hasSpecificHeadline = headline.trim().length >= 12 && !GENERIC_HEADLINE.test(headline.trim());
  const hasClearCTA = sectionItems.some((s) => !!s.cta && s.cta.trim().length >= 3);
  const hasIndustryRelevantSections = sectionItems.length >= 4;
  const hasFiles = fileCount >= 3;
  // Turkish build must not carry English headings/CTAs.
  const hasLocalizedCopy = lang !== 'tr' || !sectionItems.some((s) =>
    ENGLISH_HEADING.test(`${s.name} ${s.headline || ''} ${s.cta || ''}`));
  return {
    hasSpecificHeadline, hasClearCTA, hasIndustryRelevantSections, hasFiles, hasLocalizedCopy,
    ok: hasSpecificHeadline && hasClearCTA && hasIndustryRelevantSections && hasFiles && hasLocalizedCopy,
  };
}
