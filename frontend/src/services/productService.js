import { getBackendUrl, getVendorBackendUrl, isLocalHostname } from './apiSetup';

const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/â€¢/g, '•')
    .replace(/â˜…/g, '★')
    .replace(/Â°/g, '°')
    .replace(/ðŸ“…/g, '')
    .replace(/ðŸ“/g, '')
    .replace(/ðŸŒ™/g, '')
    .replace(/ðŸ› ï¸ /g, '')
    .replace(/ðŸ“ /g, '')
    .replace(/ðŸ‘¤/g, '')
    .replace(/ðŸ‘¥/g, '')
    .replace(/ðŸ‘ /g, '')
    .replace(/ðŸ›°ï¸ /g, '');
};

export const isRealVendorProduct = (p) => {
  if (!p) return false;

  // 1. Check Vendor Status
  if (p.vendorIsActive === false || p.isVendorSuspended === true || p.isSuspended === true) return false;
  const vStatus = (p.vendorStatus || p.vendor_status || '').toString().toLowerCase().trim();
  if (['suspended', 'inactive', 'rejected', 'deactivated', 'blocked'].includes(vStatus)) return false;

  // 2. Check Business Outlet Status
  if (p.businessIsActive === false || p.business_is_active === false) return false;
  const bStatus = (p.businessStatus || p.business_status || '').toString().toLowerCase().trim();
  if (['suspended', 'inactive', 'rejected', 'deactivated', 'blocked'].includes(bStatus)) return false;

  // 3. Check Listing Status
  if (p.isActive === false || p.isAvailable === false || p.listingIsActive === false) return false;
  const lStatus = (p.status || p.listingStatus || '').toString().toLowerCase().trim();
  if (['suspended', 'inactive', 'rejected', 'deactivated', 'blocked'].includes(lStatus)) return false;

  const vId = String(p.vendorId || p.vendor_id || '');
  const pId = String(p.id || p._id || '');

  // Exclude hardcoded demo/dump ID formats from initial seed data
  if (vId.includes('mqg7ni') || pId.includes('mqg7ni') || vId.includes('mqhms') || pId.includes('mqhms') || vId.includes('mqhn3') || pId.includes('mqhn3') || vId.includes('mqkqu') || pId.includes('mqkqu')) return false;

  // Exclude static baseline/dump item IDs
  if (pId.startsWith('base-') || pId === 'p1' || pId === 'p2' || pId === 'p3' || pId === 'p4') return false;

  // Real vendor products with valid ID or vendor name are valid
  if (pId || vId || p.vendorName || p.name) return true;

  return false;
};

const DEFAULT_BASELINE_PRODUCTS = [];

const inferSubNavbarCategory = (p) => {
  if (!p) return 'Products';

  const rawSubNav = String(p.subNavbarCategory || '').trim();
  const rawMainCat = String(p.mainCategory || p.main_category || '').trim();
  const rawCat = String(p.category || '').trim();
  const rawSubCat = String(p.subcategory || '').trim();
  const rawSubSubCat = String(p.subSubcategory || '').trim();
  const rawTag = String(p.tag || '').trim();
  const rawType = String(p.type || p.jobType || p.workType || '').trim();
  const rawName = String(p.name || p.title || p.jobTitle || '').trim();

  const matchMainCat = (str) => {
    if (!str) return null;
    const lower = str.toLowerCase();

    // Exact or direct main category matches
    if (['services', 'service'].includes(lower)) return 'Services';
    if (['food', 'foods', 'dining', 'restaurant', 'restaurants'].includes(lower)) return 'Food';
    if (['stay', 'stays', 'hotel', 'hotels', 'homestay', 'resort', 'resorts'].includes(lower)) return 'Stay';
    if (['travel', 'travels', 'cab', 'cabs', 'bus', 'flight'].includes(lower)) return 'Travel';
    if (['jobs', 'job', 'hiring', 'career', 'recruitment'].includes(lower)) return 'Jobs';
    if (['daily needs', 'daily need', 'daily-needs', 'dailyneeds', 'grocery', 'groceries'].includes(lower)) return 'Daily Needs';
    if (['products', 'product'].includes(lower)) return 'Products';

    // Subcategory matches
    if (['doctor', 'clinic', 'hospital', 'physiotherapy', 'home service', 'repair', 'plumbing', 'electrician', 'cleaning', 'salon', 'spa', 'consulting', 'fitness', 'gym', 'automobile', 'car service', 'recharge', 'education', 'tutoring', 'photography', 'event management', 'laundry', 'carpentry', 'painter', 'pest control', 'legal', 'financial', 'insurance', 'maintenance'].some(k => lower === k || lower.includes(k))) return 'Services';
    if (['parotta', 'biryani', 'biriyani', 'dosa', 'idli', 'thali', 'pizza', 'burger', 'fast food', 'south indian', 'north indian', 'bakery', 'beverages', 'catering', 'home food', 'tiramisu', 'cafe', 'salad', 'sweets', 'ice cream', 'dessert', 'snack'].some(k => lower === k || lower.includes(k))) return 'Food';
    if (['villa', 'pg', 'hostel', 'apartment', 'lodge', 'room', 'accommodation', 'suite'].some(k => lower === k || lower.includes(k))) return 'Stay';
    if (['taxi', 'sleeper', 'train', 'car rental', 'bike rental', 'tour package', 'ticket', 'transport'].some(k => lower === k || lower.includes(k))) return 'Travel';
    if (['full time', 'part time', 'full stack', 'developer', 'software engineer', 'it jobs', 'non-it jobs', 'bpo jobs', 'opening', 'vacancy', 'employment'].some(k => lower === k || lower.includes(k))) return 'Jobs';
    if (['rice', 'egg', 'eggs', 'fruits', 'vegetables', 'dairy', 'milk', 'supermarket', 'pharmacy', 'medicine', 'organic', 'staples', 'provisions'].some(k => lower === k || lower.includes(k))) return 'Daily Needs';
    if (['saree', 'fashion', 'electronics', 'mobile', 'mobiles', 'smartphone', 'laptop', 'watch', 'jewellery', 'jewelry', 'furniture', 'appliance', 'jean', 'jeans', 'shoes', 'footwear', 'clothing', 'shirt', 'headphone', 'phone'].some(k => lower === k || lower.includes(k))) return 'Products';

    return null;
  };

  // 1. Check explicit canonical fields first (subNavbarCategory & mainCategory)
  const subNavMatch = matchMainCat(rawSubNav);
  if (subNavMatch) return subNavMatch;

  const mainCatMatch = matchMainCat(rawMainCat);
  if (mainCatMatch) return mainCatMatch;

  // Disambiguation: Genuine Food keywords (never rely on p.foodType alone as Mongoose schema defaults it to 'Veg' for all collections)
  const isActualFoodKeyword = ['parotta', 'biryani', 'biriyani', 'dosa', 'idli', 'idly', 'thali', 'pizza', 'burger', 'fast food', 'south indian meals', 'meals'].some(k => 
    rawName.toLowerCase().includes(k) || rawSubCat.toLowerCase().includes(k) || rawSubSubCat.toLowerCase().includes(k)
  );

  if (isActualFoodKeyword || (p.businessType && String(p.businessType).toLowerCase() === 'food')) {
    return 'Food';
  }

  const catMatch = matchMainCat(rawCat);
  if (catMatch) return catMatch;

  const subCatMatch = matchMainCat(rawSubCat);
  if (subCatMatch) return subCatMatch;

  const subSubCatMatch = matchMainCat(rawSubSubCat);
  if (subSubCatMatch) return subSubCatMatch;

  const tagMatch = matchMainCat(rawTag);
  if (tagMatch) return tagMatch;

  const typeMatch = matchMainCat(rawType);
  if (typeMatch) return typeMatch;

  // 2. Check for Jobs specific indicators (jobTitle, jobLocation, salary)
  if (!isActualFoodKeyword && (p.jobTitle || p.jobLocation || p.experienceRequired || p.minExperience || rawType.toLowerCase().includes('job') || rawType.toLowerCase().includes('full-time') || rawType.toLowerCase().includes('part-time'))) {
    return 'Jobs';
  }

  // 3. Check product name/title
  const nameMatch = matchMainCat(rawName);
  if (nameMatch) return nameMatch;

  return rawSubNav || rawMainCat || 'Products';
};

const isDeadImageUrl = (u) => {
  if (!u || typeof u !== 'string') return true;
  const lower = u.trim().toLowerCase();
  return !lower || lower === 'null' || lower === 'undefined' || lower.includes('connect-vendor.onrender.com') || lower.includes('.onrender.com');
};

const extractRawImage = (p) => {
  if (!p) return '';

  const allCandidates = [];
  if (typeof p.image === 'string') allCandidates.push(p.image);
  if (typeof p.imageUrl === 'string') allCandidates.push(p.imageUrl);
  if (typeof p.imageURL === 'string') allCandidates.push(p.imageURL);
  if (typeof p.imgUrl === 'string') allCandidates.push(p.imgUrl);
  if (typeof p.secure_url === 'string') allCandidates.push(p.secure_url);
  if (Array.isArray(p.images) && p.images.length > 0) {
    p.images.forEach(img => {
      const u = typeof img === 'string' ? img : (img?.secure_url || img?.url || img?.src || img?.path || img?.imageUrl || img?.imageURL || '');
      if (u) allCandidates.push(u);
    });
  }
  if (Array.isArray(p.imageUrls) && p.imageUrls.length > 0) {
    p.imageUrls.forEach(u => { if (typeof u === 'string') allCandidates.push(u); });
  }
  if (typeof p.photo === 'string') allCandidates.push(p.photo);
  if (Array.isArray(p.photos) && p.photos.length > 0) {
    p.photos.forEach(img => {
      const u = typeof img === 'string' ? img : (img?.secure_url || img?.url || img?.src || '');
      if (u) allCandidates.push(u);
    });
  }
  if (typeof p.productImage === 'string') allCandidates.push(p.productImage);
  if (typeof p.serviceImage === 'string') allCandidates.push(p.serviceImage);
  if (typeof p.catalogImage === 'string') allCandidates.push(p.catalogImage);
  if (typeof p.thumbnailUrl === 'string') allCandidates.push(p.thumbnailUrl);
  if (typeof p.thumbnailURL === 'string') allCandidates.push(p.thumbnailURL);
  if (typeof p.mediaUrl === 'string') allCandidates.push(p.mediaUrl);
  if (typeof p.mediaURL === 'string') allCandidates.push(p.mediaURL);
  if (typeof p.media === 'string') allCandidates.push(p.media);
  if (typeof p.picture === 'string') allCandidates.push(p.picture);
  if (typeof p.thumbnail === 'string') allCandidates.push(p.thumbnail);
  if (typeof p.coverImage === 'string') allCandidates.push(p.coverImage);
  if (typeof p.bannerImage === 'string') allCandidates.push(p.bannerImage);

  // 1. Explicit primary fields take first priority (imageUrl, image, imageURL, secure_url)
  // Ensures newly uploaded S3 images or edited products are NOT overridden by stale candidates
  const primaryFieldCandidates = [p.imageUrl, p.image, p.imageURL, p.secure_url, p.imgUrl]
    .filter(u => typeof u === 'string' && !isDeadImageUrl(u));
  if (primaryFieldCandidates.length > 0) {
    return primaryFieldCandidates[0].trim();
  }

  // 2. Product images array
  if (Array.isArray(p.images) && p.images.length > 0) {
    for (const img of p.images) {
      const u = typeof img === 'string' ? img : (img?.secure_url || img?.url || img?.src || img?.path || img?.imageUrl || '');
      if (u && typeof u === 'string' && !isDeadImageUrl(u)) {
        return u.trim();
      }
    }
  }

  // 3. Product imageUrls array
  if (Array.isArray(p.imageUrls) && p.imageUrls.length > 0) {
    for (const u of p.imageUrls) {
      if (u && typeof u === 'string' && !isDeadImageUrl(u)) {
        return u.trim();
      }
    }
  }

  // 4. Any remaining valid candidate (Cloudinary, S3, or external)
  const validCandidate = allCandidates.find(u => typeof u === 'string' && !isDeadImageUrl(u));
  if (validCandidate) return validCandidate.trim();

  return '';
};

export const NEUTRAL_NO_IMAGE_PLACEHOLDER = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="%23f8fafc"><rect width="400" height="300" fill="%23f8fafc"/><g transform="translate(170,110)" fill="%23cbd5e1"><path d="M5 0h50a5 5 0 0 1 5 5v40a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5zm45 40V10H10v30h40zM17 22l8 10 6-6 12 14H17z"/><circle cx="20" cy="18" r="4"/></g><text x="200" y="185" font-family="sans-serif" font-size="13" font-weight="700" fill="%2394a3b8" text-anchor="middle">No image available</text></svg>`;

export const CATEGORY_IMAGE_COLLECTIONS = {
  Food: [
    'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=800&auto=format&fit=crop&q=80', // Biryani / Rice
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format&fit=crop&q=80', // Meal
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&auto=format&fit=crop&q=80'  // Dishes
  ],
  Products: [
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80', // Watch
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80', // Headphones
    'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80'  // Fashion / Clothing
  ],
  Services: [
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&auto=format&fit=crop&q=80', // Tech / Hardware repair
    'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800&auto=format&fit=crop&q=80'  // Maintenance
  ],
  Stay: [
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80', // Luxury hotel room
    'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&auto=format&fit=crop&q=80'  // Resort villa
  ],
  Travel: [
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=800&auto=format&fit=crop&q=80'  // Bus travel
  ],
  'Daily Needs': [
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&auto=format&fit=crop&q=80', // Grocery
    'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?w=800&auto=format&fit=crop&q=80'  // Dairy / Fresh
  ]
};

export const getCategoryFallbackImage = (pContext) => {
  if (!pContext) return CATEGORY_IMAGE_COLLECTIONS.Products[0];
  const cat = (pContext.subNavbarCategory || pContext.mainCategory || pContext.tag || pContext.category || '').toString();
  const name = (pContext.name || pContext.title || '').toLowerCase();
  
  if (name.includes('rice') || name.includes('biryani') || name.includes('pongal') || name.includes('idly') || name.includes('dosa') || name.includes('chicken') || name.includes('food') || name.includes('meals') || name.includes('sambar') || name.includes('naan')) {
    return 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=800&auto=format&fit=crop&q=80';
  }
  if (name.includes('lehenga') || name.includes('saree') || name.includes('t shirt') || name.includes('shirt') || name.includes('dress') || name.includes('fashion')) {
    return 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80';
  }
  if (name.includes('service') || name.includes('mother board') || name.includes('chill') || name.includes('cam') || name.includes('repair')) {
    return 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&auto=format&fit=crop&q=80';
  }
  if (name.includes('hotel') || name.includes('retreat') || name.includes('villa') || name.includes('moonlight') || name.includes('stay')) {
    return 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80';
  }
  if (name.includes('fan') || name.includes('celling') || name.includes('ceiling') || name.includes('electronics') || name.includes('cooler') || name.includes('dell') || name.includes('laptop') || name.includes('phone') || name.includes('mobile')) {
    return 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&auto=format&fit=crop&q=80';
  }

  for (const [key, imgs] of Object.entries(CATEGORY_IMAGE_COLLECTIONS)) {
    if (cat.toLowerCase().includes(key.toLowerCase())) {
      return imgs[0];
    }
  }
  return CATEGORY_IMAGE_COLLECTIONS.Products[0];
};

export const sanitizeImageUrl = (imgUrl, pContext = null) => {
  if (!imgUrl || typeof imgUrl !== 'string') return getCategoryFallbackImage(pContext);
  let url = imgUrl.trim();
  if (!url || url === 'null' || url === 'undefined' || url === 'false' || url === 'none') return getCategoryFallbackImage(pContext);

  if (url.startsWith('data:')) {
    return url;
  }
  if (url.startsWith('blob:')) {
    try {
      if (typeof window !== 'undefined' && url.includes(window.location.host)) {
        return url;
      }
    } catch (e) {}
    return getCategoryFallbackImage(pContext);
  }

  // Prevent loading assets from dead domains or ephemeral upload instances
  if (
    url.includes('api.ficapp.in') ||
    url.includes('vendor.ficapp.in') ||
    url.includes('/uploads/img_') ||
    url.includes('uploads/img_') ||
    url.includes('connect-vendor.onrender.com') ||
    (url.includes('.onrender.com') && !url.includes('connect-app-ukpk.onrender.com'))
  ) {
    return getCategoryFallbackImage(pContext);
  }

  // Route legacy/relative vendor uploads through backend upload handler
  if (url.includes('/uploads/')) {
    const cleanPath = url.substring(url.indexOf('/uploads/'));
    const baseBackend = typeof getBackendUrl === 'function' ? getBackendUrl() : '';
    if (baseBackend) {
      return `${baseBackend.replace(/\/+$/, '')}${cleanPath}`;
    }
    return cleanPath;
  }

  if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    const baseBackend = typeof getBackendUrl === 'function' ? getBackendUrl() : '';
    if (baseBackend && !cleanPath.startsWith('http')) {
      return `${baseBackend.replace(/\/+$/, '')}${cleanPath}`;
    }
    return cleanPath;
  }

  // Canonical backend media S3 endpoint
  if (url.includes('/api/media/s3/') || url.includes('/api/uploads/s3/')) {
    if (url.includes('ficapp.in')) {
      return getCategoryFallbackImage(pContext);
    }
    const cleanPath = url.substring(url.indexOf('/api/'));
    const baseBackend = typeof getBackendUrl === 'function' ? getBackendUrl() : '';
    if (baseBackend && !url.startsWith('http')) {
      return `${baseBackend.replace(/\/+$/, '')}${cleanPath}`;
    }
    return url;
  }

  // Raw S3 object key passed directly (e.g. products/1729...jpg)
  if (/^[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp|gif|avif|pdf|svg)$/i.test(url)) {
    const baseBackend = typeof getBackendUrl === 'function' ? getBackendUrl() : '';
    return `${baseBackend.replace(/\/+$/, '')}/api/media/s3/${url.replace(/^\/+/, '')}`;
  }

  // Permanent Cloudinary CDN URLs - fully preserved
  if (url.startsWith('https://res.cloudinary.com/')) {
    return url;
  }

  // CloudFront & S3 URLs
  if (url.includes('.cloudfront.net') || url.includes('.amazonaws.com')) {
    return url;
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  return getCategoryFallbackImage(pContext);
};

const sanitizeProduct = (p) => {
  if (!p) return p;
  const updated = { ...p };

  // Standardize ID
  updated.id = p.id || p._id || p.productId || `vendor-prod-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

  // Standardize Name / Title
  updated.name = p.name || p.title || p.productName || p.serviceName || p.jobTitle || 'Vendor Listing';

  // Standardize Price & Offer Price
  const rawPrice = p.price !== undefined && p.price !== null ? p.price : (p.offerPrice || p.mrp || p.rate || p.amount || p.cost || 0);
  updated.price = typeof rawPrice === 'number' ? rawPrice : (parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) || 0);

  if (p.offerPrice || p.originalPrice || p.mrp) {
    const rawOrig = p.originalPrice || p.mrp || p.price;
    updated.originalPrice = typeof rawOrig === 'number' ? rawOrig : (parseFloat(String(rawOrig).replace(/[^0-9.]/g, '')) || 0);
    const rawOffer = p.offerPrice || p.price;
    updated.offerPrice = typeof rawOffer === 'number' ? rawOffer : (parseFloat(String(rawOffer).replace(/[^0-9.]/g, '')) || 0);
  }

  // Standardize Vendor Name / Brand
  updated.vendorName = p.vendorName || p.brand || p.companyName || p.company || p.vendor_name || 'Verified Vendor';

  // Standardize Rating & Reviews
  updated.rating = p.rating ? Number(p.rating) : 4.5;
  updated.reviews = p.reviews ? Number(p.reviews) : 12;

  // Infer category context first for fallback selection if needed
  updated.subNavbarCategory = inferSubNavbarCategory(updated);

  // Extract raw vendor uploaded image
  const rawImg = extractRawImage(p);
  updated.image = sanitizeImageUrl(rawImg, updated);

  const rawImagesList = [];
  if (rawImg) rawImagesList.push(rawImg);

  const extractUrlFromItem = (item) => {
    if (!item) return '';
    if (typeof item === 'string') return item.trim();
    if (typeof item === 'object') {
      return (item.secure_url || item.url || item.src || item.path || item.imageUrl || item.imageURL || item.location || '').toString().trim();
    }
    return '';
  };

  if (Array.isArray(p.images) && p.images.length > 0) {
    p.images.forEach(img => {
      const url = extractUrlFromItem(img);
      if (url) rawImagesList.push(url);
    });
  }
  if (Array.isArray(p.photos) && p.photos.length > 0) {
    p.photos.forEach(img => {
      const url = extractUrlFromItem(img);
      if (url) rawImagesList.push(url);
    });
  }
  if (Array.isArray(p.imageUrls) && p.imageUrls.length > 0) {
    p.imageUrls.forEach(img => {
      const url = extractUrlFromItem(img);
      if (url) rawImagesList.push(url);
    });
  }

  // Sanitize all image URLs first, then deduplicate exact sanitized URLs
  const sanitizedList = rawImagesList.map(imgStr => sanitizeImageUrl(imgStr, updated)).filter(Boolean);
  const uniqueSanitized = Array.from(new Set(sanitizedList));

  if (uniqueSanitized.length > 0) {
    updated.images = uniqueSanitized.map(img => typeof img === 'string' ? { url: img } : img);
    updated.imageUrls = uniqueSanitized.map(img => typeof img === 'string' ? img : img.url);
    if (!updated.image || updated.image.includes('unsplash.com')) {
      const validFirst = uniqueSanitized.find(img => {
        const u = typeof img === 'string' ? img : img?.url;
        return u && !u.includes('unsplash.com');
      }) || uniqueSanitized[0];
      const validUrl = typeof validFirst === 'string' ? validFirst : validFirst?.url;
      if (validUrl) {
        updated.image = validUrl;
      }
    }
  } else {
    updated.images = updated.image ? [{ url: updated.image }] : [];
    updated.imageUrls = updated.image ? [updated.image] : [];
  }
  updated.imageUrl = updated.image;

  for (const key in updated) {
    if (typeof updated[key] === 'string') {
      updated[key] = sanitizeString(updated[key]);
    } else if (Array.isArray(updated[key])) {
      updated[key] = updated[key].map(item => typeof item === 'string' ? sanitizeString(item) : item);
    }
  }

  return updated;
};

let activeGetProductsPromise = null;
let memoryProductCache = null;
let lastProductsFetchTime = 0;
const CACHE_FRESH_MS = 20000;

try {
  if (typeof window !== 'undefined') {
    const saved = window.sessionStorage?.getItem('cached_vendor_products') || window.localStorage?.getItem('cached_vendor_products');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryProductCache = parsed;
        lastProductsFetchTime = Date.now();
      }
    }
  }
} catch (e) {}

export const productService = {
  clearCache: () => {
    activeGetProductsPromise = null;
    memoryProductCache = null;
    lastProductsFetchTime = 0;
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.removeItem('cached_vendor_products');
        window.localStorage?.removeItem('cached_vendor_products');
      }
    } catch (e) {}
  },

  getCachedProducts: () => {
    return memoryProductCache || [];
  },

  getProducts: async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && Array.isArray(memoryProductCache) && memoryProductCache.length > 0) {
      if (now - lastProductsFetchTime >= CACHE_FRESH_MS && !activeGetProductsPromise) {
        productService.getProducts(true).catch(() => {});
      }
      return { success: true, products: memoryProductCache, source: 'cache' };
    }

    if (activeGetProductsPromise) {
      return activeGetProductsPromise;
    }

    activeGetProductsPromise = (async () => {
      try {
        const filterVendorAddedOnly = (fetchedList) => {
          const sanitized = Array.isArray(fetchedList) ? fetchedList.map(sanitizeProduct) : [];
          return sanitized.filter(isRealVendorProduct);
        };

        const baseVendorUrl = getVendorBackendUrl();
        const baseUrl = getBackendUrl();
        const endpoints = [
          baseUrl ? `${baseUrl}/api/public/products` : '/api/public/products',
          baseVendorUrl && baseVendorUrl !== baseUrl ? `${baseVendorUrl}/api/public/products` : null
        ];
        const uniqueEndpoints = [...new Set(endpoints.filter(Boolean))];

        const fetchEndpoint = (endpoint) => {
          return new Promise(async (resolve, reject) => {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 12000);

              const fetchUrl = forceRefresh ? `${endpoint}?refresh=true` : endpoint;
              const res = await fetch(fetchUrl, { 
                signal: controller.signal
              }).catch(() => null);
              clearTimeout(timeoutId);

              if (res && res.ok) {
                const data = await res.json().catch(() => null);
                const rawList = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : (data && Array.isArray(data.data) ? data.data : []));
                if (Array.isArray(rawList)) {
                  const vendorProducts = filterVendorAddedOnly(rawList);
                  if (vendorProducts.length > 0) {
                    return resolve(vendorProducts);
                  }
                }
              }
              reject(new Error(`Failed endpoint ${endpoint}`));
            } catch (err) {
              reject(err);
            }
          });
        };

        try {
          const fastestProducts = await Promise.any(uniqueEndpoints.map(ep => fetchEndpoint(ep)));
          if (Array.isArray(fastestProducts) && fastestProducts.length > 0) {
            memoryProductCache = fastestProducts;
            lastProductsFetchTime = Date.now();
            try {
              if (typeof window !== 'undefined') {
                window.sessionStorage?.setItem('cached_vendor_products', JSON.stringify(fastestProducts));
                window.localStorage?.setItem('cached_vendor_products', JSON.stringify(fastestProducts));
              }
            } catch (e) {}
            return { success: true, products: fastestProducts, source: 'live' };
          }
        } catch (raceErr) {
          for (const endpoint of uniqueEndpoints) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 12000);

              const fetchUrl = forceRefresh ? `${endpoint}?refresh=true` : endpoint;
              const res = await fetch(fetchUrl, { 
                signal: controller.signal
              }).catch(() => null);
              clearTimeout(timeoutId);

              if (res && res.ok) {
                const data = await res.json().catch(() => null);
                const rawList = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : (data && Array.isArray(data.data) ? data.data : []));
                if (Array.isArray(rawList)) {
                  const vendorProducts = filterVendorAddedOnly(rawList);
                  if (vendorProducts.length > 0) {
                    memoryProductCache = vendorProducts;
                    lastProductsFetchTime = Date.now();
                    try {
                      if (typeof window !== 'undefined') {
                        window.sessionStorage?.setItem('cached_vendor_products', JSON.stringify(vendorProducts));
                        window.localStorage?.setItem('cached_vendor_products', JSON.stringify(vendorProducts));
                      }
                    } catch (e) {}
                    return { success: true, products: vendorProducts, source: 'live' };
                  }
                }
              }
            } catch (err) {}
          }
        }

        if (Array.isArray(memoryProductCache) && memoryProductCache.length > 0) {
          return { success: true, products: memoryProductCache, source: 'cache_fallback' };
        }

        return { success: true, products: [], source: 'empty' };
      } finally {
        activeGetProductsPromise = null;
      }
    })();

    return activeGetProductsPromise;
  },

  deleteAllProducts: async () => {
    try {
      const res = await fetch(`${getVendorBackendUrl()}/api/public/products/delete-all`, {
        method: 'DELETE'
      });
      if (res.ok) {
        return await res.json();
      }
      return { success: false, message: 'Failed to delete products' };
    } catch (err) {
      console.warn("Failed to delete products:", err);
      return { success: false, message: 'Server error' };
    }
  },

  uploadImage: async (imageFileOrBase64, folder = 'products') => {
    try {
      const baseUrl = getBackendUrl();
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageFileOrBase64, folder })
      });
      if (res.ok) {
        return await res.json();
      }
      return { success: false, error: 'Upload failed' };
    } catch (err) {
      console.error('Error in uploadImage:', err);
      return { success: false, error: err.message };
    }
  },

  createProduct: async (productData) => {
    try {
      const baseUrl = getBackendUrl();
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
      if (res.ok) {
        const data = await res.json();
        productService.clearCache();
        return data;
      }
      return { success: false, error: 'Failed to create product' };
    } catch (err) {
      console.error('Error creating product:', err);
      return { success: false, error: err.message };
    }
  },

  updateProduct: async (id, updateData) => {
    try {
      const baseUrl = getBackendUrl();
      const res = await fetch(`${baseUrl}/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      if (res.ok) {
        const data = await res.json();
        productService.clearCache();
        return data;
      }
      return { success: false, error: 'Failed to update product' };
    } catch (err) {
      console.error('Error updating product:', err);
      return { success: false, error: err.message };
    }
  },

  deleteProduct: async (id) => {
    try {
      const baseUrl = getBackendUrl();
      const res = await fetch(`${baseUrl}/api/products/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json();
        productService.clearCache();
        return data;
      }
      return { success: false, error: 'Failed to delete product' };
    } catch (err) {
      console.error('Error deleting product:', err);
      return { success: false, error: err.message };
    }
  },

  getProductById: async (id) => {
    if (!id) return null;
    const cleanId = String(id).trim();

    // 1. Check in-memory/cached products
    const cached = productService.getCachedProducts();
    if (Array.isArray(cached) && cached.length > 0) {
      const match = cached.find(p => String(p.id) === cleanId || String(p._id) === cleanId || (p.name && p.name.toLowerCase() === cleanId.toLowerCase()));
      if (match) return match;
    }

    // 2. Fetch directly from backend endpoints
    const baseUrl = getBackendUrl();
    const vendorUrl = getVendorBackendUrl();
    const endpoints = [
      `${baseUrl}/api/public/products/${encodeURIComponent(cleanId)}`,
      `${vendorUrl}/api/public/products/${encodeURIComponent(cleanId)}`,
      `${baseUrl}/api/products/${encodeURIComponent(cleanId)}`
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (res.ok) {
          const data = await res.json();
          const raw = data?.product || data?.data || data;
          if (raw && (raw.id || raw._id || raw.name)) {
            return sanitizeProduct(raw);
          }
        }
      } catch (_) {}
    }

    // 3. Fallback: try fetching all products fresh if not yet loaded
    const res = await productService.getProducts(true);
    if (res && res.success && Array.isArray(res.products)) {
      const match = res.products.find(p => String(p.id) === cleanId || String(p._id) === cleanId || (p.name && p.name.toLowerCase() === cleanId.toLowerCase()));
      if (match) return match;
    }

    return null;
  }
};
