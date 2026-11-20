export interface CategoryDef {
  code: string;
  name_sk: string;
  name_zh: string;
  sort_order: number;
}

/**
 * 78-item Bilingual Category Dictionary (Slovak + Chinese) per §5.3
 */
export const CATEGORY_DICTIONARY: CategoryDef[] = [
  // Women's Apparel (w_*)
  { code: 'w_tshirt', name_sk: 'Dámske tričká', name_zh: '女装T恤', sort_order: 10 },
  { code: 'w_shirt', name_sk: 'Dámske košele a blúzky', name_zh: '女装衬衫/雪纺衫', sort_order: 11 },
  { code: 'w_sweater', name_sk: 'Dámske svetre', name_zh: '女装毛衣/针织', sort_order: 12 },
  { code: 'w_hoodie', name_sk: 'Dámske mikiny', name_zh: '女装卫衣', sort_order: 13 },
  { code: 'w_jacket', name_sk: 'Dámske bundy a kabáty', name_zh: '女装外套/大衣', sort_order: 14 },
  { code: 'w_dress', name_sk: 'Dámske šaty', name_zh: '女装连衣裙', sort_order: 15 },
  { code: 'w_skirt', name_sk: 'Dámske sukne', name_zh: '女装半身裙', sort_order: 16 },
  { code: 'w_pants', name_sk: 'Dámske nohavice', name_zh: '女装长裤', sort_order: 17 },
  { code: 'w_jeans', name_sk: 'Dámske rifle', name_zh: '女装牛仔裤', sort_order: 18 },
  { code: 'w_shorts', name_sk: 'Dámske šortky', name_zh: '女装短裤', sort_order: 19 },
  { code: 'w_leggings', name_sk: 'Dámske legíny', name_zh: '女装打底裤', sort_order: 20 },
  { code: 'w_underwear', name_sk: 'Dámska spodná bielizeň', name_zh: '女式内衣', sort_order: 21 },
  { code: 'w_socks', name_sk: 'Dámske ponožky', name_zh: '女袜', sort_order: 22 },
  { code: 'w_pajama', name_sk: 'Dámske pyžamá', name_zh: '女式睡衣', sort_order: 23 },
  { code: 'w_swim', name_sk: 'Dámske plavky', name_zh: '女式泳装', sort_order: 24 },
  { code: 'w_shoes', name_sk: 'Dámska obuv', name_zh: '女鞋', sort_order: 25 },

  // Men's Apparel (m_*)
  { code: 'm_tshirt', name_sk: 'Pánske tričká', name_zh: '男装T恤', sort_order: 30 },
  { code: 'm_shirt', name_sk: 'Pánske košele', name_zh: '男装衬衫', sort_order: 31 },
  { code: 'm_sweater', name_sk: 'Pánske svetre', name_zh: '男装毛衣', sort_order: 32 },
  { code: 'm_hoodie', name_sk: 'Pánske mikiny', name_zh: '男装卫衣', sort_order: 33 },
  { code: 'm_jacket', name_sk: 'Pánske bundy a kabáty', name_zh: '男装外套/夹克', sort_order: 34 },
  { code: 'm_pants', name_sk: 'Pánske nohavice', name_zh: '男装长裤', sort_order: 35 },
  { code: 'm_jeans', name_sk: 'Pánske rifle', name_zh: '男装牛仔裤', sort_order: 36 },
  { code: 'm_shorts', name_sk: 'Pánske šortky', name_zh: '男装短裤', sort_order: 37 },
  { code: 'm_underwear', name_sk: 'Pánska spodná bielizeň', name_zh: '男式内裤', sort_order: 38 },
  { code: 'm_socks', name_sk: 'Pánske ponožky', name_zh: '男袜', sort_order: 39 },
  { code: 'm_pajama', name_sk: 'Pánske pyžamá', name_zh: '男式睡衣', sort_order: 40 },
  { code: 'm_swim', name_sk: 'Pánske plavky', name_zh: '男式泳裤', sort_order: 41 },
  { code: 'm_shoes', name_sk: 'Pánska obuv', name_zh: '男鞋', sort_order: 42 },

  // Kids Apparel (kid_*)
  { code: 'kid_tshirt', name_sk: 'Detské tričká', name_zh: '童装T恤', sort_order: 50 },
  { code: 'kid_shirt', name_sk: 'Detské košele', name_zh: '童装衬衫', sort_order: 51 },
  { code: 'kid_sweater', name_sk: 'Detské svetre', name_zh: '童装毛衣', sort_order: 52 },
  { code: 'kid_hoodie', name_sk: 'Detské mikiny', name_zh: '童装卫衣', sort_order: 53 },
  { code: 'kid_jacket', name_sk: 'Detské bundy', name_zh: '童装外套', sort_order: 54 },
  { code: 'kid_dress', name_sk: 'Dievčenské šaty', name_zh: '女童连衣裙', sort_order: 55 },
  { code: 'kid_pants', name_sk: 'Detské nohavice', name_zh: '童装裤子', sort_order: 56 },
  { code: 'kid_underwear', name_sk: 'Detská bielizeň', name_zh: '儿童内衣', sort_order: 57 },
  { code: 'kid_socks', name_sk: 'Detské ponožky', name_zh: '童袜', sort_order: 58 },
  { code: 'kid_pajama', name_sk: 'Detské pyžamá', name_zh: '儿童睡衣', sort_order: 59 },
  { code: 'kid_shoes', name_sk: 'Detská obuv', name_zh: '童鞋', sort_order: 60 },
  { code: 'kid_general', name_sk: 'Detský tovar', name_zh: '儿童通用服饰', sort_order: 61 },

  // Unisex / General Apparel
  { code: 'u_tshirt', name_sk: 'Unisex tričká', name_zh: '通用T恤', sort_order: 70 },
  { code: 'u_shirt', name_sk: 'Unisex košele', name_zh: '通用衬衫', sort_order: 71 },
  { code: 'u_sweater', name_sk: 'Unisex svetre', name_zh: '通用毛衣', sort_order: 72 },
  { code: 'u_hoodie', name_sk: 'Unisex mikiny', name_zh: '通用卫衣', sort_order: 73 },
  { code: 'u_jacket', name_sk: 'Unisex bundy', name_zh: '通用外套', sort_order: 74 },
  { code: 'u_pants', name_sk: 'Unisex nohavice', name_zh: '通用长裤', sort_order: 75 },
  { code: 'u_socks', name_sk: 'Ponožky', name_zh: '袜类通用', sort_order: 76 },
  { code: 'u_shoes', name_sk: 'Obuv', name_zh: '鞋类通用', sort_order: 77 },
  { code: 'u_slippers', name_sk: 'Šľapky a papuče', name_zh: '拖鞋/家居鞋', sort_order: 78 },

  // Accessories & Bags
  { code: 'acc_bag', name_sk: 'Kabelky a tašky', name_zh: '包袋/手提包', sort_order: 80 },
  { code: 'acc_backpack', name_sk: 'Ruksaky a batohy', name_zh: '双肩背包', sort_order: 81 },
  { code: 'acc_wallet', name_sk: 'Peňaženky', name_zh: '钱包/卡包', sort_order: 82 },
  { code: 'acc_belt', name_sk: 'Opasky', name_zh: '腰带/皮带', sort_order: 83 },
  { code: 'acc_hat', name_sk: 'Čiapky a šiltovky', name_zh: '帽子/鸭舌帽', sort_order: 84 },
  { code: 'acc_scarf', name_sk: 'Šály a šatky', name_zh: '围巾/丝巾', sort_order: 85 },
  { code: 'acc_gloves', name_sk: 'Rukavice', name_zh: '手套', sort_order: 86 },
  { code: 'acc_glasses', name_sk: 'Okuliare', name_zh: '太阳镜/眼镜', sort_order: 87 },
  { code: 'acc_jewelry', name_sk: 'Bižutéria a doplnky', name_zh: '饰品/发饰', sort_order: 88 },
  { code: 'acc_umbrella', name_sk: 'Dáždniky', name_zh: '雨伞', sort_order: 89 },

  // Beauty & Cosmetics
  { code: 'bea_skincare', name_sk: 'Starostlivosť o pleť', name_zh: '护肤品', sort_order: 95 },
  { code: 'bea_makeup', name_sk: 'Dekoratívna kozmetika', name_zh: '彩妆', sort_order: 96 },
  { code: 'bea_perfume', name_sk: 'Parfumy a vône', name_zh: '香水香氛', sort_order: 97 },
  { code: 'bea_hygiene', name_sk: 'Osobná hygiena', name_zh: '个人护理/洗护', sort_order: 98 },

  // Home, Kitchen & General Merchandise
  { code: 'home_kitchen', name_sk: 'Kuchynské potreby', name_zh: '厨房用品', sort_order: 100 },
  { code: 'home_tableware', name_sk: 'Riad a poháre', name_zh: '餐具/杯具', sort_order: 101 },
  { code: 'home_bedding', name_sk: 'Posteľná bielizeň', name_zh: '床上用品', sort_order: 102 },
  { code: 'home_towel', name_sk: 'Uteráky a osušky', name_zh: '毛巾浴巾', sort_order: 103 },
  { code: 'home_decor', name_sk: 'Bytové doplnky', name_zh: '家居装饰/收纳', sort_order: 104 },
  { code: 'home_clean', name_sk: 'Čistiace prostriedky', name_zh: '日用清洁', sort_order: 105 },
  { code: 'home_hardware', name_sk: 'Náradie a elektro', name_zh: '五金/小家电', sort_order: 106 },
  { code: 'home_stationery', name_sk: 'Papiernictvo', name_zh: '文具办公', sort_order: 107 },
  { code: 'home_toy', name_sk: 'Hračky', name_zh: '儿童玩具', sort_order: 108 },
  { code: 'home_sport', name_sk: 'Športové potreby', name_zh: '运动户外', sort_order: 109 },
  { code: 'home_pet', name_sk: 'Chovateľské potreby', name_zh: '宠物用品', sort_order: 110 },
  { code: 'home_auto', name_sk: 'Auto-moto doplnky', name_zh: '汽车用品', sort_order: 111 },
  { code: 'food_snack', name_sk: 'Potraviny a pochutiny', name_zh: '食品零食', sort_order: 112 },
  { code: 'food_drink', name_sk: 'Nápoje', name_zh: '饮品茶水', sort_order: 113 },
];

/**
 * Normalizes product title: lowercase + NFD diacritics stripped + collapsed spaces (§5.3 / B-20)
 */
export function normalizeCategoryText(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

type GenderPrefix = 'w_' | 'm_' | 'kid_' | 'u_';

function detectGenderPrefix(normalized: string): GenderPrefix {
  if (/(damske|damska|damsky|\bdam\b|zena|zensk|dievcen|women|lady|女)/.test(normalized)) {
    return 'w_';
  }
  if (/(panske|panska|pansky|muz|chlap|men\b|男)/.test(normalized)) {
    return 'm_';
  }
  if (/(detske|detska|detsky|chlapcensk|\bkids?\b|junior|baby|童|儿童)/.test(normalized)) {
    return 'kid_';
  }
  return 'u_';
}

interface KeywordRule {
  pattern: RegExp;
  genderAware?: boolean;
  map?: Partial<Record<GenderPrefix, string>>;
  fixedCode?: string;
}

const ORDERED_RULES: KeywordRule[] = [
  // Specific apparel types (checked top-down)
  {
    pattern: /(tricko|tricka|t-shirt|tshirt|polokosel|top\b|t恤)/,
    genderAware: true,
    map: { w_: 'w_tshirt', m_: 'm_tshirt', kid_: 'kid_tshirt', u_: 'u_tshirt' },
  },
  {
    pattern: /(bluzka|bluzky|kosela|kosele|koš|shirt|衬衫|雪纺)/,
    genderAware: true,
    map: { w_: 'w_shirt', m_: 'm_shirt', kid_: 'kid_shirt', u_: 'u_shirt' },
  },
  {
    pattern: /(sveter|svetre|pulover|kardigan|sweater|knit|毛衣|针织)/,
    genderAware: true,
    map: { w_: 'w_sweater', m_: 'm_sweater', kid_: 'kid_sweater', u_: 'u_sweater' },
  },
  {
    pattern: /(mikina|mikiny|hoodie|teplakov|卫衣|套头)/,
    genderAware: true,
    map: { w_: 'w_hoodie', m_: 'm_hoodie', kid_: 'kid_hoodie', u_: 'u_hoodie' },
  },
  {
    pattern: /(bunda|bundy|kabat|kabaty|vetrovka|parka|sako|vesta|jacket|coat|外套|夹克|大衣|羽绒)/,
    genderAware: true,
    map: { w_: 'w_jacket', m_: 'm_jacket', kid_: 'kid_jacket', u_: 'u_jacket' },
  },
  {
    pattern: /(saty|dress|连衣裙)/,
    genderAware: true,
    map: { w_: 'w_dress', kid_: 'kid_dress', u_: 'w_dress', m_: 'w_dress' },
  },
  {
    pattern: /(sukna|sukne|skirt|半身裙|短裙)/,
    fixedCode: 'w_skirt',
  },
  {
    pattern: /(legin|legging|打底裤)/,
    fixedCode: 'w_leggings',
  },
  {
    pattern: /(rifle|dzins|jeans|denim|牛仔裤)/,
    genderAware: true,
    map: { w_: 'w_jeans', m_: 'm_jeans', kid_: 'kid_pants', u_: 'w_jeans' },
  },
  {
    pattern: /(sortky|kratasy|shorts|短裤)/,
    genderAware: true,
    map: { w_: 'w_shorts', m_: 'm_shorts', kid_: 'kid_pants', u_: 'm_shorts' },
  },
  {
    pattern: /(nohavice|teplaky|pants|trouser|长裤|裤)/,
    genderAware: true,
    map: { w_: 'w_pants', m_: 'm_pants', kid_: 'kid_pants', u_: 'u_pants' },
  },
  {
    pattern: /(pyzam|nocna|pajama|睡衣)/,
    genderAware: true,
    map: { w_: 'w_pajama', m_: 'm_pajama', kid_: 'kid_pajama', u_: 'w_pajama' },
  },
  {
    pattern: /(plavky|bikini|swim|泳衣|泳裤)/,
    genderAware: true,
    map: { w_: 'w_swim', m_: 'm_swim', kid_: 'kid_general', u_: 'w_swim' },
  },
  {
    pattern: /(podprsenk|nohavick|boxer|trenir|bielizen|underwear|bra\b|内衣|内裤|文胸)/,
    genderAware: true,
    map: { w_: 'w_underwear', m_: 'm_underwear', kid_: 'kid_underwear', u_: 'w_underwear' },
  },
  {
    pattern: /(ponozk|pancuch|silonek|socks|袜)/,
    genderAware: true,
    map: { w_: 'w_socks', m_: 'm_socks', kid_: 'kid_socks', u_: 'u_socks' },
  },
  {
    pattern: /(slapky|papuce|sandal|slipper|拖鞋|凉鞋)/,
    fixedCode: 'u_slippers',
  },
  {
    pattern: /(obuv|tenisky|topanky|cizmy|mokasiny|boty|shoes|sneaker|鞋|靴)/,
    genderAware: true,
    map: { w_: 'w_shoes', m_: 'm_shoes', kid_: 'kid_shoes', u_: 'u_shoes' },
  },

  // Bags & Accessories
  { pattern: /(ruksak|batoh|backpack|双肩包|书包)/, fixedCode: 'acc_backpack' },
  { pattern: /(penazenk|wallet|钱包|卡包)/, fixedCode: 'acc_wallet' },
  { pattern: /(kabelk|taska|crossbody|bag\b|手提包|背包|包)/, fixedCode: 'acc_bag' },
  { pattern: /(opasok|opasky|belt|腰带|皮带)/, fixedCode: 'acc_belt' },
  { pattern: /(ciapk|siltovk|klobuk|cap\b|hat\b|帽)/, fixedCode: 'acc_hat' },
  { pattern: /(sal\b|saly|satk|scarf|围巾|丝巾)/, fixedCode: 'acc_scarf' },
  { pattern: /(rukavic|gloves|手套)/, fixedCode: 'acc_gloves' },
  { pattern: /(okuliar|sunglass|glasses|眼镜|墨镜)/, fixedCode: 'acc_glasses' },
  { pattern: /(dazdnik|umbrella|雨伞)/, fixedCode: 'acc_umbrella' },
  { pattern: /(nausnic|nahrdelnik|naramok|prsten|bizuter|sponk|gumick|饰品|耳环|项链)/, fixedCode: 'acc_jewelry' },

  // Beauty & Hygiene
  { pattern: /(parfum|toaletna voda|vona|perfume|香水)/, fixedCode: 'bea_perfume' },
  { pattern: /(ruz\b|mascara|makeup|tien|puder|lak na nechty|口红|粉底|彩妆|眉笔)/, fixedCode: 'bea_makeup' },
  { pattern: /(krem|serum|toner|plet|maska|skincare|面霜|精华|爽肤水|护肤|防晒)/, fixedCode: 'bea_skincare' },
  { pattern: /(sampon|sprchov|mydlo|pasta|zubna|deodorant|hygien|洗发|沐浴|牙膏|洗手液)/, fixedCode: 'bea_hygiene' },

  // Home & General
  { pattern: /(hracka|hracky|puzzle|lego|toy|玩具)/, fixedCode: 'home_toy' },
  { pattern: /(hrncek|pohar|tanier|pribor|miska|mug|cup|碗|杯|餐具|盘)/, fixedCode: 'home_tableware' },
  { pattern: /(kuchynsk|noz\b|noze|panvic|hrniec|doska|kitchen|刀|锅|铲|厨)/, fixedCode: 'home_kitchen' },
  { pattern: /(uterak|osusk|towel|毛巾|浴巾)/, fixedCode: 'home_towel' },
  { pattern: /(postel|oblieck|vankus|prikryvk|deka|bedding|被|枕|床单)/, fixedCode: 'home_bedding' },
  { pattern: /(cistic|jar\b|praci|avivaz|metla|mop|清洁|洗衣|扫把)/, fixedCode: 'home_clean' },
  { pattern: /(zosit|pero|ceruz|papier|kancelar|stationery|笔记本|笔|文具)/, fixedCode: 'home_stationery' },
  { pattern: /(narad|baterk|kabel|zarovk|elektr|tools|螺丝|灯泡|数据线|五金)/, fixedCode: 'home_hardware' },
  { pattern: /(sport|fitness|lopta|cink|运动|球|瑜伽)/, fixedCode: 'home_sport' },
  { pattern: /(pes\b|macka|krmivo|pet|宠物|猫|狗)/, fixedCode: 'home_pet' },
  { pattern: /(auto|moto|car\b|汽车|车载)/, fixedCode: 'home_auto' },
  { pattern: /(svieck|vaza|kosik|ramik|dekor|box\b|收纳|摆件|香薰)/, fixedCode: 'home_decor' },
  { pattern: /(napoj|voda|dzus|kava|caj|drink|水|茶|咖啡|饮料)/, fixedCode: 'food_drink' },
  { pattern: /(cokolad|cukrik|keks|snack|chip|食品|饼干|糖|零食)/, fixedCode: 'food_snack' },
];

/**
 * Matches a product title against ordered keyword rules (§5.3).
 * Returns category code or null if no rule hits (never guesses).
 */
export function matchCategoryByName(productName: string): string | null {
  const normalized = normalizeCategoryText(productName);
  if (!normalized) return null;

  const prefix = detectGenderPrefix(normalized);

  for (const rule of ORDERED_RULES) {
    if (rule.pattern.test(normalized)) {
      if (rule.fixedCode) return rule.fixedCode;
      if (rule.genderAware && rule.map) {
        return rule.map[prefix] || rule.map.u_ || null;
      }
    }
  }

  // Fallback for explicit kids clothing with no garment type keyword
  if (prefix === 'kid_') {
    return 'kid_general';
  }

  return null;
}
