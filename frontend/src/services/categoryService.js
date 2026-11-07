import { getBackendUrl, getAdminBackendUrl, isLocalHostname } from './apiSetup';

export const BASE_TAXONOMY = {
  "Services": {},
  "Products": {},
  "Daily Needs": {},
  "Food": {},
  "Stay": {},
  "Travel": {},
  "Jobs": {}
};

export const normalizeCategoryName = (rawName) => {
  if (!rawName) return '';
  const n = rawName.trim().toLowerCase();
  if (n === 'products' || n === 'product') return 'Products';
  if (n === 'stay') return 'Stay';
  if (n === 'food') return 'Food';
  if (n === 'daily need' || n === 'daily needs') return 'Daily Needs';
  if (n === 'job' || n === 'jobs') return 'Jobs';
  if (n === 'service' || n === 'services') return 'Services';
  if (n === 'travel') return 'Travel';
  return rawName.trim();
};

/**
 * Builds the active category tree STRICTLY based on Admin Category Management API records (dbCategories).
 * Removes hardcoded category memory override when admin deletes or deactivates categories/subcategories.
 */
export const buildActiveCategoryTree = (dbCategories = []) => {
  const catTree = {};

  // 1. Initialize empty taxonomy structure for canonical main categories
  const canonicalMains = ['Services', 'Products', 'Daily Needs', 'Food', 'Stay', 'Travel', 'Jobs'];
  canonicalMains.forEach(mainName => {
    catTree[mainName] = {
      name: mainName,
      isActive: true,
      subcategories: {}
    };
  });

  if (!Array.isArray(dbCategories) || dbCategories.length === 0) {
    return catTree;
  }

  // Helper to recursively flatten nested category arrays (e.g. backend roots with .children)
  const flattenCategories = (list) => {
    const flat = [];
    const walk = (c) => {
      if (!c) return;
      flat.push(c);
      if (Array.isArray(c.children)) {
        c.children.forEach(walk);
      }
    };
    (Array.isArray(list) ? list : []).forEach(walk);
    return flat;
  };

  const allFlat = flattenCategories(dbCategories);

  // 1. Build an ID Map of all valid category records across all levels
  const idMap = new Map();
  allFlat.forEach(c => {
    if (c && c._id && c.isActive !== false && !c.isDeleted && c.description !== 'DELETED_HIERARCHY_MARKER') {
      idMap.set(c._id.toString(), c);
    }
  });

  // Helper to safely append a subcategory & children to catTree
  const appendSub = (mainNameRaw, subNameRaw, childItems = []) => {
    if (!mainNameRaw || !subNameRaw) return;
    const mainName = normalizeCategoryName(mainNameRaw);
    const subName = subNameRaw.trim();
    if (!subName || subName === 'ALL_SUBCATEGORIES_DELETED_MARKER') return;
    if (normalizeCategoryName(subName) === mainName) return;

    if (!catTree[mainName]) {
      catTree[mainName] = { name: mainName, isActive: true, subcategories: {} };
    }

    // Match subcategory key case-insensitively to prevent duplicates like "Electronics" and "electronics"
    const existingSubKey = Object.keys(catTree[mainName].subcategories).find(
      k => k.trim().toLowerCase() === subName.toLowerCase()
    ) || subName;

    if (!catTree[mainName].subcategories[existingSubKey]) {
      catTree[mainName].subcategories[existingSubKey] = {
        name: existingSubKey,
        isActive: true,
        childCategories: []
      };
    }

    if (Array.isArray(childItems)) {
      childItems.forEach(ch => {
        if (!ch) return;
        const chName = (typeof ch === 'string' ? ch : ch.name || ch.subSubcategory || ch.title || '').trim();
        if (
          chName && 
          normalizeCategoryName(chName) !== mainName && 
          chName.toLowerCase() !== existingSubKey.toLowerCase() &&
          !catTree[mainName].subcategories[existingSubKey].childCategories.some(c => String(c).toLowerCase() === chName.toLowerCase())
        ) {
          catTree[mainName].subcategories[existingSubKey].childCategories.push(chName);
        }
      });
    }
  };

  // Helper to resolve root main category name walking up parentId chain if necessary
  const findMainCategoryName = (c) => {
    if (!c) return '';
    if (c.mainCategory) return normalizeCategoryName(c.mainCategory);
    if (c.main_category) return normalizeCategoryName(c.main_category);
    if (c.parentName && canonicalMains.includes(normalizeCategoryName(c.parentName))) {
      return normalizeCategoryName(c.parentName);
    }

    // Walk up parentId chain
    let curr = c;
    let depth = 0;
    while (curr && curr.parentId && depth < 5) {
      const parent = idMap.get(curr.parentId.toString());
      if (!parent) break;
      if (parent.mainCategory) return normalizeCategoryName(parent.mainCategory);
      if (parent.main_category) return normalizeCategoryName(parent.main_category);
      const parentNorm = normalizeCategoryName(parent.name);
      if (canonicalMains.includes(parentNorm) || parent.level === 'main' || parent.isMainCategory === true) {
        return parentNorm;
      }
      curr = parent;
      depth++;
    }

    const cNorm = normalizeCategoryName(c.name);
    if (canonicalMains.includes(cNorm) || c.level === 'main' || c.isMainCategory === true) {
      return cNorm;
    }
    return c.parentName ? normalizeCategoryName(c.parentName) : cNorm;
  };

  allFlat.forEach(c => {
    if (!c || c.isActive === false || c.isDeleted || c.description === 'DELETED_HIERARCHY_MARKER') return;

    const mainName = findMainCategoryName(c);
    let subName = (c.subcategory || '').trim();
    let childName = (c.subSubcategory || '').trim();

    // If level is explicitly subcategory
    if (!subName && (c.level === 'subcategory' || c.level === 'sub') && c.name) {
      subName = c.name.trim();
    }

    // If level is explicitly child or subSubcategory
    if (!childName && (c.level === 'child' || c.level === 'subSubcategory' || c.level === 'L3') && c.name) {
      childName = c.name.trim();
    }

    // If c has subcategory AND a distinct c.name, c.name is the child category
    if (subName && !childName && c.name && c.name.trim() !== subName && normalizeCategoryName(c.name) !== mainName) {
      childName = c.name.trim();
    }

    // Check parentId mapping
    if (c.parentId && idMap.has(c.parentId.toString())) {
      const parent = idMap.get(c.parentId.toString());
      const parentMain = findMainCategoryName(parent);
      const parentNorm = normalizeCategoryName(parent.name);
      const isParentMain = parent.level === 'main' || canonicalMains.includes(parentNorm);

      if (isParentMain) {
        if (!subName && c.name && normalizeCategoryName(c.name) !== parentMain) {
          subName = c.name.trim();
        }
      } else {
        const parentSub = (parent.subcategory || parent.name || '').trim();
        if (parentSub) {
          subName = parentSub;
          if (!childName && c.name && c.name.trim() !== parentSub) {
            childName = c.name.trim();
          }
        }
      }
    }

    // If subName is still empty but level is sub or subcategory
    if (!subName && (c.level === 'sub' || c.level === 'subcategory') && c.name && normalizeCategoryName(c.name) !== mainName) {
      subName = c.name.trim();
    }

    if (mainName && subName) {
      appendSub(mainName, subName, childName ? [childName] : (c.children || []));
    }

    // Check nested .children array
    if (Array.isArray(c.children) && c.children.length > 0) {
      c.children.forEach(subNode => {
        if (!subNode || subNode.isActive === false || subNode.isDeleted || subNode.description === 'DELETED_HIERARCHY_MARKER') return;
        const subNodeName = (subNode.subcategory || subNode.name || '').trim();
        if (subNodeName && mainName && normalizeCategoryName(subNodeName) !== mainName) {
          appendSub(mainName, subNodeName, subNode.children);
        }
      });
    }
  });

  return catTree;
};

export const getDynamicMenuData = (dbCategories = []) => {
  const catTree = buildActiveCategoryTree(dbCategories);
  const menuData = {};

  Object.keys(catTree).forEach(mainName => {
    menuData[mainName] = {};
    const subs = catTree[mainName].subcategories || {};
    Object.keys(subs).forEach(subName => {
      menuData[mainName][subName] = {
        items: (subs[subName].childCategories || []).map(ch => typeof ch === 'string' ? ch : ch.name)
      };
    });
  });

  return menuData;
};

export const getActiveMainCategories = (dbCategories = []) => {
  const catTree = buildActiveCategoryTree(dbCategories);
  const activeKeys = Object.keys(catTree).filter(k => catTree[k] && catTree[k].isActive !== false);

  const canonicalMains = ['Services', 'Products', 'Daily Needs', 'Food', 'Stay', 'Travel', 'Jobs'];
  
  const sorted = [];
  canonicalMains.forEach(m => {
    if (activeKeys.includes(m)) sorted.push(m);
  });
  
  // Include any custom Level 1 main categories explicitly created by Admin
  activeKeys.forEach(k => {
    if (!sorted.includes(k) && k) {
      const isExplicitMain = Array.isArray(dbCategories) && dbCategories.some(c => 
        c && (c.level === 'main' || c.isMainCategory === true) && normalizeCategoryName(c.name) === k
      );
      if (isExplicitMain) sorted.push(k);
    }
  });

  return sorted.length > 0 ? sorted : canonicalMains;
};

let memoryCategoryCache = null;
let activeFetchCategoriesPromise = null;

export const invalidateCategoryCache = () => {
  memoryCategoryCache = null;
  activeFetchCategoriesPromise = null;
};

export const fetchAdminCategories = async (forceRefresh = false) => {
  if (!forceRefresh && Array.isArray(memoryCategoryCache) && memoryCategoryCache.length > 0) {
    return memoryCategoryCache;
  }

  if (activeFetchCategoriesPromise && !forceRefresh) {
    return activeFetchCategoriesPromise;
  }

  activeFetchCategoriesPromise = (async () => {
    const backendUrl = getBackendUrl();
    const adminUrl = getAdminBackendUrl();
    const urlsToTry = [
      backendUrl ? `${backendUrl}/api/public/categories` : '/api/public/categories',
      adminUrl && adminUrl !== backendUrl ? `${adminUrl}/api/admin/categories` : null
    ];

    const uniqueUrls = [...new Set(urlsToTry.filter(Boolean))];

    for (const baseUrl of uniqueUrls) {
      try {
        const url = forceRefresh ? `${baseUrl}?refresh=true` : baseUrl;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(url, { signal: controller.signal }).catch(() => null);
        clearTimeout(timeoutId);

        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          const list = Array.isArray(data) ? data : (data?.categories || []);
          if (Array.isArray(list) && list.length > 0) {
            memoryCategoryCache = list;
            activeFetchCategoriesPromise = null;
            return list;
          }
        }
      } catch (e) {}
    }

    activeFetchCategoriesPromise = null;
    return memoryCategoryCache || [];
  })();

  return activeFetchCategoriesPromise;
};
