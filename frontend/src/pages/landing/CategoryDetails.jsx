/*
Food
│
├ Restaurants
├ Fast Food
├ Cafes
├ South Indian
├ North Indian
├ Biryani
├ Healthy Food
├ Bakery
├ Beverages
├ International Cuisine
├ Non - Veg Specials
├ Vegetarian Specials
├ Home Food
├ Catering
├ Subscription Meals
└ Premium Dining
*/
import React, { useEffect, useState } from 'react';
import { productService, isRealVendorProduct } from '../../services/productService';
import { ArrowLeft, Star, ChevronRight, Compass, Search, RefreshCw, X } from 'lucide-react';
import saree1 from '../../assets/images/saree_1.png';
import saree2 from '../../assets/images/saree_2.png';
import saree3 from '../../assets/images/saree_3.png';
import saree4 from '../../assets/images/saree_4.png';

import { buildActiveCategoryTree, fetchAdminCategories, normalizeCategoryName } from '../../services/categoryService';

export default function CategoryDetails({ category, onBack, onSubCategoryClick }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  const [dbCategories, setDbCategories] = useState([]);

  useEffect(() => {
    fetchAdminCategories().then(data => {
      if (Array.isArray(data)) setDbCategories(data);
    });
  }, []);

  // Geolocation States
  const [userLocation, setUserLocation] = useState(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // Dynamic Vendor Products
  const [vendorProducts, setVendorProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProductForModal, setSelectedProductForModal] = useState(null);

  // Scroll to top when this details page is loaded
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [category]);

  useEffect(() => {
    let active = true;
    const fetchProducts = async () => {
      try {
        const res = await productService.getProducts();
        if (active && res && res.success && Array.isArray(res.products)) {
          setVendorProducts(res.products);
        }
      } catch (err) {
        console.warn("Failed to fetch products in CategoryDetails:", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchProducts();
    return () => { active = false; };
  }, [category]);

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      setIsGettingLocation(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ lat: latitude, lng: longitude });
          setIsGettingLocation(false);
          alert(`Location accessed! Latitude: ${latitude.toFixed(4)}, Longitude: ${longitude.toFixed(4)}`);
        },
        (error) => {
          setIsGettingLocation(false);
          alert("Unable to retrieve location: " + error.message);
        }
      );
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  };

  // Mega Menu Configurations (source of truth for sub-categories)
  const categoryData = {
    'Jobs': {
      tagline: 'Verified career opportunities across leading technology and enterprise sectors.',
      subCategories: [
        {
          title: 'IT',
          items: ['Data Analyst', 'Full Stack Developer', 'Cloud Engineer', 'DevOps Specialist']
        },
        {
          title: 'Non-IT',
          items: ['Data Associate', 'System Administrator', 'Operations Lead', 'Support Executive']
        }
      ],
      isProductGrid: true,
      products: []
    },
    'Services': {
      tagline: 'On-demand excellence delivered by verified industry professionals.',
      subCategories: [
        {
          title: 'IT Services',
          items: ['Web Development', 'App Development', 'Cloud Architecture', 'Cybersecurity Audit', 'IT Infrastructure']
        },
        {
          title: 'Non-IT',
          items: ['Office Housekeeping', 'Security Personnel', 'Delivery Logistics', 'Warehouse Management', 'Data Entry Support']
        },
        {
          title: 'Job Consulting',
          items: ['Resume Makeover', 'Interview Preparation', 'Executive Search', 'Recruitment Drives', 'Career Roadmap Planning']
        },
        {
          title: 'Business Consulting',
          items: ['Company Setup & Incorporation', 'Tax & Compliance Audit', 'Legal Drafts & Licensing', 'Pitch Deck Advisory', 'Financial Planning']
        }
      ],
      mockPartners: [
        { name: 'CloudAura Tech Labs', rating: 4.9, reviews: 142, desc: 'Enterprise custom web platforms and cloud deployment.', location: 'Bangalore & Remote' },
        { name: 'Nippon Security & Logistics', rating: 4.8, reviews: 98, desc: 'Premium corporate housekeeping and secure warehouse staffing.', location: 'Mumbai & Chennai' },
        { name: 'Connect Talent Advisors', rating: 5.0, reviews: 204, desc: 'Strategic recruitment drives and C-level executive search.', location: 'Mumbai & Delhi' }
      ]
    },
    'Products': {
      tagline: 'Exclusive pricing and access to world-renowned luxury brands.',
      subCategories: [
        {
          title: 'Fashion & Luxury',
          items: ['Analog & Smart Watches', 'Designer Wardrobes', 'Premium Leather Shoes', 'Handcrafted Accessories', 'Signature Eyewear']
        },
        {
          title: 'Electronics & Gadgets',
          items: ['Smart Home Systems', 'Audiophile Audio Systems', 'Active Noise Canceling Gear', 'Magnetic Charging Stations', 'Wellness Trackers']
        },
        {
          title: 'Home & Interiors',
          items: ['Modern Canvas Art', 'Architectural Lighting', 'Luxury Organic Bedding', 'Handmade Ceramic Tableware', 'Essential Oil Diffusers']
        }
      ],
      isProductGrid: true,
      products: [
        {
          id: 'p1',
          name: 'Adrika Alluring Sarees',
          price: '239',
          rating: '3.8',
          reviews: '22352',
          image: saree1,
          badge: '+10 More',
          type: 'reviews'
        },
        {
          id: 'p2',
          name: 'Banita Ensemble Sarees',
          price: '329',
          rating: '4.0',
          type: 'supplier',
          image: saree2,
          badge: null
        },
        {
          id: 'p3',
          name: 'Trendy Refined Sarees',
          price: '286',
          originalPrice: '310',
          discount: '8% off',
          rating: '3.9',
          reviews: '23430',
          image: saree3,
          badge: '+3 More',
          type: 'reviews'
        },
        {
          id: 'p4',
          name: 'Adrika Pretty Sarees',
          price: '334',
          originalPrice: '347',
          discount: '4% off',
          rating: '3.8',
          reviews: '70086',
          image: saree4,
          badge: '+10 More',
          type: 'reviews'
        }
      ]
    },
    'Daily Needs': {
      tagline: 'Artisanal, fresh, and immediate convenience essentials at your doorstep.',
      subCategories: [
        {
          title: 'Gourmet Food & Fresh',
          items: ['Certified Organic Greens', 'Imported Pantry Staples', 'Premium Farm Dairy', 'Daily Artisan Breads', 'Sparkling & Cold Brews']
        },
        {
          title: 'Personal Health',
          items: ['Dermatologist Skin Formulas', 'Vitamins & Health Supplements', 'Natural Care Products', 'Grooming & Shaving Kits', 'First-Aid & Wellness Care']
        },
        {
          title: 'Express Conveniences',
          items: ['Eco-friendly Dry Cleaning', 'Same-day Steam Laundry', 'Gourmet Pet Food Packages', 'Sensitive Baby Care Items', 'Stationery & Writing Tools']
        }
      ],
      mockPartners: [
        { name: 'Gourmet Pantry', rating: 4.9, reviews: 310, desc: 'Same-day delivery of organic greens & imported pantry delicacies.', location: 'Mumbai, Bangalore' },
        { name: 'Green Clean Dry Cleaners', rating: 4.6, reviews: 185, desc: 'Eco-safe premium garment care with free collection.', location: 'All Metros' }
      ]
    },
    'Food': {
      tagline: 'Culinary curation for refined palates, from Michelin guide dining to bistros.',
      subCategories: [
        {
          title: 'Luxury Dining',
          items: ['Michelin-star Partners', 'Five-Star Buffet Outlets', 'Premium Cocktail Bars', 'Rooftop Skylounge Bookings', 'Private Tasting Events']
        },
        {
          title: 'Casual & Cafes',
          items: ['Micro-Roasters & Cafes', 'Neapolitan Pizzerias', 'Artisanal Craft Breweries', 'Gourmet Sushi Platter Bars', 'Artisan Chocolates & Gelatos']
        },
        {
          title: 'Private Catering',
          items: ['Personal Chef-to-Home', 'Artisanal Meal Kits', 'Corporate Boardroom Catering', 'Midnight Gourmet Deliveries']
        }
      ],
      mockPartners: [
        { name: 'Celeste Dining Hall', rating: 4.9, reviews: 412, desc: 'Signature French-Italian fusion with priority tables.', location: 'Delhi, Mumbai' },
        { name: 'Bespoke Chefs Inc.', rating: 5.0, reviews: 56, desc: 'Michelin star chefs cooking in your home kitchen.', location: 'Mumbai & Goa' }
      ]
    },
    'Stay': {
      tagline: 'Curated escape vectors, from luxury beachfront villas to boutique escapes.',
      subCategories: [
        {
          title: 'Luxury Villas & Resorts',
          items: ['Private Cliffside Villas', 'All-Inclusive Beach Resorts', 'Alpine Ski Chalets', 'Holistic Ayurveda Retreats']
        },
        {
          title: 'Boutique Hoteliers',
          items: ['Heritage Palaces', 'Art Deco Business Lodges', 'Exclusive Executive Suites', 'Off-grid Eco Resorts']
        },
        {
          title: 'Unique Getaways',
          items: ['Luxury Forest Treehouses', 'Stargazing Geodesic Domes', 'Glamping Safari Tents', 'Lakeside Cabins & Docks']
        }
      ],
      mockPartners: [
        { name: 'Aura Villas & Estates', rating: 5.0, reviews: 34, desc: 'Exclusive private pool estates and beachfront villas.', location: 'Goa, Alibaug' },
        { name: 'The Art Deco Lodge', rating: 4.8, reviews: 92, desc: 'Curated heritage properties with executive privileges.', location: 'Mumbai' }
      ]
    },
    'Travel': {
      tagline: 'VIP travel logistics, private charters, and fast-track transit.',
      subCategories: [
        {
          title: 'Private & Business Class',
          items: ['International Business Deals', 'Private Jet Charters', 'Scenic Helicopter Charters', 'Superyacht Day Charters']
        },
        {
          title: 'Lounges & Fast-track',
          items: ['Global VIP Lounge Invites', 'Fast-Track Customs Passes', 'Airport Chauffeur Limos', 'Meet & Greet VIP Escorts']
        },
        {
          title: 'Bespoke Expeditions',
          items: ['African Safari Tours', 'Northern Lights Journeys', 'Private Vineyard Tours', 'Curated Historic Walks']
        }
      ],
      mockPartners: [
        { name: 'Apex Jets & Charters', rating: 4.9, reviews: 18, desc: 'Private jet charters and VIP helicopter transfers.', location: 'Global' },
        { name: 'VIP Transit Services', rating: 4.7, reviews: 63, desc: 'Fast-track airport clearance and limo pickups.', location: 'Major Airports' }
      ]
    }
  };

  // Dynamically construct data based on static templates and vendorProducts
  const getDynamicCategoryData = () => {
    const safeCat = category || 'Services';
    const catLower = safeCat.toLowerCase();
    const staticData = categoryData[safeCat] || categoryData['Services'];
    
    const matchingProducts = vendorProducts.filter(p => {
      if (!isRealVendorProduct(p)) return false;
      const subNav = (p.subNavbarCategory || '').toLowerCase();
      const cat = (p.category || '').toLowerCase();
      const subcat = (p.subcategory || '').toLowerCase();
      const mainCat = (p.mainCategory || '').toLowerCase();
      const tag = (p.tag || '').toLowerCase();
      const name = (p.name || '').toLowerCase();

      return subNav === catLower || cat === catLower || subcat === catLower || mainCat === catLower || tag === catLower ||
        subNav.includes(catLower) || cat.includes(catLower) || subcat.includes(catLower) || mainCat.includes(catLower) || tag.includes(catLower) || name.includes(catLower);
    });

    // If it's Products category or isProductGrid, return matching real vendor products only
    if (staticData.isProductGrid || safeCat === 'Products') {
      return {
        tagline: staticData.tagline || 'Explore exclusive luxury deals.',
        isProductGrid: true,
        products: matchingProducts
      };
    }

    // Combine active subcategories from Category Management tree with dynamic products
    const activeTree = buildActiveCategoryTree(dbCategories);
    const activeMainObj = activeTree[safeCat] || activeTree[normalizeCategoryName(safeCat)];

    const grouped = {};
    if (activeMainObj && activeMainObj.subcategories) {
      Object.keys(activeMainObj.subcategories).forEach(subName => {
        const subObj = activeMainObj.subcategories[subName];
        if (subObj && subObj.isActive !== false) {
          grouped[subName] = (subObj.childCategories || []).map(ch => (typeof ch === 'string' ? ch : ch.name));
        }
      });
    }

    matchingProducts.forEach(p => {
      const subcat = p.category || 'General';
      if (!grouped[subcat]) {
        grouped[subcat] = [];
      }
      if (p.name && !grouped[subcat].includes(p.name)) {
        grouped[subcat].push(p.name);
      }
    });

    const mergedSubCategories = Object.keys(grouped).map(subcat => ({
      title: subcat,
      items: grouped[subcat]
    }));

    // Build partner list merging static and vendor products
    const mergedPartners = [...(staticData.mockPartners || [])];
    const seenPartnerNames = new Set(mergedPartners.map(p => (p.name || '').toLowerCase()));
    
    matchingProducts.forEach(p => {
      if (p.vendorName && !seenPartnerNames.has(p.vendorName.toLowerCase())) {
        seenPartnerNames.add(p.vendorName.toLowerCase());
        mergedPartners.push({
          name: p.vendorName,
          rating: p.rating || 4.8,
          reviews: p.reviews || 120,
          desc: p.description || `${p.vendorName} is a verified premium partner offering ${p.name}.`,
          location: 'Available Area'
        });
      }
    });

    return {
      tagline: staticData.tagline || 'Audited partner catalog.',
      subCategories: mergedSubCategories,
      mockPartners: mergedPartners,
      products: matchingProducts
    };
  };

  const data = getDynamicCategoryData();

  // Filter subCategories based on search query
  let filteredSubCategories = data.subCategories || [];
  if (searchQuery.trim() !== '') {
    const q = searchQuery.toLowerCase();
    filteredSubCategories = filteredSubCategories.map(sub => {
      if (sub.title.toLowerCase().includes(q)) {
        return sub;
      }
      const filteredItems = sub.items.filter(item => item.toLowerCase().includes(q));
      if (filteredItems.length > 0) {
        return {
          ...sub,
          items: filteredItems
        };
      }
      return null;
    }).filter(Boolean);
  }

  // Filter mockPartners based on search query
  let filteredPartners = data.mockPartners || [];
  if (searchQuery.trim() !== '') {
    const q = searchQuery.toLowerCase();
    filteredPartners = filteredPartners.filter(partner =>
      partner.name.toLowerCase().includes(q) ||
      partner.desc.toLowerCase().includes(q) ||
      partner.location.toLowerCase().includes(q)
    );
  }

  // Filter and Sort Logic for Products
  let displayedProducts = [];
  if (data.products && Array.isArray(data.products) && data.products.length > 0) {
    displayedProducts = [...data.products];

    // 1. Search Query Filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      displayedProducts = displayedProducts.filter((p) =>
        p.name.toLowerCase().includes(q)
      );
    }

    // 2. Category Type Filter
    if (categoryFilter !== 'all') {
      displayedProducts = displayedProducts.filter((p) => p.type === categoryFilter);
    }

    // 3. Sorting Options
    if (sortBy === 'price-asc') {
      displayedProducts.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    } else if (sortBy === 'price-desc') {
      displayedProducts.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    } else if (sortBy === 'rating-desc') {
      displayedProducts.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
    }
  }

  const getProductHighlights = (product) => {
    if (!product) return [];
    if (product.specifications && Object.keys(product.specifications).length > 0) {
      return Object.entries(product.specifications)
        .filter(([k, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`);
    }
    if (product.customFields && Object.keys(product.customFields).length > 0) {
      return Object.entries(product.customFields)
        .filter(([k, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`);
    }
    if (product.description) {
      const lines = product.description
        .split('\n')
        .map(line => line.trim().replace(/^[\s\-\*\u2022\u25E6\u2023\u2043\u25CB\u25C9\u25A0\u25A1\u2714\u2713]+/g, '').trim())
        .filter(Boolean);
      if (lines.length > 0) {
        return lines;
      }
    }
    return [];
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 text-slate-900 dark:text-slate-100 pt-6 sm:pt-10 pb-20 px-3.5 sm:px-6 md:px-12 lg:px-20 transition-colors duration-300">
      {/* Dynamic Background Light */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-gold/5 dark:bg-brand-gold/2 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full relative z-10">

        {/* Header: Back Button, Title, Search Bar & Location Compass */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 pb-5 border-b border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-350 dark:hover:border-slate-700 hover:shadow-xs transition-all cursor-pointer shrink-0 group"
              aria-label="Back to Home"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            </button>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-sans leading-none">
              {category}
            </h1>
          </div>

          {/* Search and Location Input Controls */}
          <div className="flex items-center space-x-3 w-full md:w-auto">
            {/* Search Input Box */}
            <div className="relative flex-grow md:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={`Search inside ${category}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full focus:outline-hidden focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-550 shadow-sm"
              />
            </div>

            {/* Locator Compass Button */}
            <button
              onClick={handleGetLocation}
              disabled={isGettingLocation}
              className={`inline-flex items-center justify-center w-9.5 h-9.5 rounded-full bg-white dark:bg-slate-900 border text-slate-500 dark:text-slate-400 hover:text-brand-gold hover:border-brand-gold dark:hover:text-brand-gold dark:hover:border-brand-gold transition-all cursor-pointer shrink-0 group relative ${isGettingLocation ? 'animate-spin' : ''} ${userLocation ? 'border-brand-gold/60 text-brand-gold dark:border-brand-gold/65 bg-brand-gold/5' : 'border-slate-200 dark:border-slate-800'}`}
              title={userLocation ? `Location: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : "Get current location"}
            >
              <Compass className={`w-4.5 h-4.5 transition-transform ${isGettingLocation ? 'animate-pulse' : 'group-hover:rotate-45'}`} />
            </button>
          </div>
        </div>

        {/* Categories Section */}
        {filteredSubCategories.length > 0 && (
          <div className="mb-16">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-6 pb-2 border-b border-slate-200 dark:border-slate-800">
              Available Categories & Types
            </h2>

            {filteredSubCategories.length > 0 ? (
              <div className={`grid grid-cols-1 gap-8 ${filteredSubCategories.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3'
                }`}>
                {filteredSubCategories.map((sub, index) => (
                  <div
                    key={sub.title}
                    onClick={() => {
                      if (onSubCategoryClick) {
                        onSubCategoryClick(sub.title);
                      }
                    }}
                    className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-100 dark:border-slate-800/80 shadow-sm shadow-slate-100/50 hover:shadow-lg hover:border-brand-gold/30 hover:-translate-y-1 transition-all duration-300 relative group overflow-hidden cursor-pointer"
                  >
                    {/* Gold corner accent */}
                    <div className="absolute top-0 right-0 w-12 h-12 bg-brand-gold/5 dark:bg-brand-gold/2 rounded-bl-full group-hover:bg-brand-gold/10 transition-colors" />

                    <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4 tracking-tight border-b border-slate-50 dark:border-slate-800 pb-2">
                      {sub.title}
                    </h3>

                    <ul className="space-y-3">
                      {sub.items.map((item, idx) => (
                        <li key={idx} className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-350">
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-gold shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8">
                <p className="text-slate-400 text-sm">No sub-categories or services match your search query.</p>
              </div>
            )}
          </div>
        )}

        {/* Featured Partners / Products Section */}
        <div>
          {displayedProducts.length > 0 ? (
            <>
              {/* Interactive Filter Bar */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 mb-8 flex flex-col md:flex-row md:items-center md:justify-end gap-4 shadow-sm shadow-slate-100/50">
                {/* Filters & Sort */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Category Type Dropdown */}
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all text-slate-600 dark:text-slate-300 font-medium cursor-pointer"
                  >
                    <option value="all">All Types</option>
                    <option value="reviews">With Reviews</option>
                    <option value="supplier">Direct Supplier</option>
                  </select>

                  {/* Sort By Dropdown */}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all text-slate-600 dark:text-slate-300 font-medium cursor-pointer"
                  >
                    <option value="default">Sort By: Relevance</option>
                    <option value="price-asc">Price: Low to High</option>
                    <option value="price-desc">Price: High to Low</option>
                    <option value="rating-desc">Rating: High to Low</option>
                  </select>
                </div>
              </div>

              {/* Product Grid Render */}
              {displayedProducts.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                  {displayedProducts.map((product) => (
                    <div
                      key={product.id}
                      onClick={() => setSelectedProductForModal(product)}
                      className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col group hover:-translate-y-1 hover:border-brand-gold/45 hover:shadow-md transition-all duration-300 cursor-pointer"
                    >
                      {/* Product Image Container */}
                      <div className="relative aspect-square w-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        {product.badge && (
                          <span className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-xs text-white text-[9px] font-semibold px-2 py-0.5 rounded select-none">
                            {product.badge}
                          </span>
                        )}
                      </div>

                      {/* Product Details */}
                      <div className="p-3 flex flex-col flex-grow justify-between bg-white dark:bg-slate-900">
                        <div>
                          <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate leading-tight" title={product.name}>
                            {product.name}
                          </h3>

                          {/* Price Section */}
                          <div className="flex items-baseline space-x-1 mt-1">
                            <span className="text-base font-bold text-slate-900 dark:text-white">
                              ₹{product.price}
                            </span>
                            {product.originalPrice && (
                              <>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 line-through">
                                  ₹{product.originalPrice}
                                </span>
                                <span className="text-[10px] text-emerald-600 font-semibold">
                                  {product.discount}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Rating and Metadata Section */}
                        <div className="mt-2.5 flex items-center space-x-1.5 text-xs">
                          {product.type === 'reviews' ? (
                            <>
                              <span className="inline-flex items-center space-x-0.5 text-white bg-emerald-600 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                <span>{product.rating}</span>
                                <Star className="w-2.5 h-2.5 fill-white stroke-none" />
                              </span>
                              <span className="text-slate-400 text-[10px]">
                                {parseInt(product.reviews).toLocaleString()} Reviews
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="inline-flex items-center space-x-0.5 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                <span>{product.rating}</span>
                                <Star className="w-2.5 h-2.5 fill-blue-600 stroke-none" />
                              </span>
                              <span className="text-slate-400 text-[10px]">
                                Supplier
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 flex flex-col items-center justify-center">
                  <p className="text-slate-400 text-sm">No products found matching your filters.</p>
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setCategoryFilter('all');
                      setSortBy('default');
                    }}
                    className="mt-4 text-xs font-semibold text-brand-gold hover:text-brand-gold-dark border border-brand-gold/30 hover:border-brand-gold px-3.5 py-1.5 rounded-md transition-all cursor-pointer flex items-center space-x-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Clear Filters</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            filteredPartners.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {filteredPartners.map((partner) => (
                  <div
                    key={partner.name}
                    className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-150 dark:border-slate-800 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start">
                        <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                          {partner.name}
                        </h3>
                        <div className="flex items-center space-x-1 text-xs font-semibold text-brand-gold-dark bg-yellow-50 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                          <Star className="w-3.5 h-3.5 fill-brand-gold text-brand-gold" />
                          <span>{partner.rating} ({partner.reviews})</span>
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                        {partner.desc}
                      </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-50 dark:border-slate-800 flex justify-between items-center text-xs text-slate-400">
                      <span>Coverage: {partner.location}</span>
                      <a
                        href="#pricing"
                        className="inline-flex items-center text-xs font-semibold text-slate-700 dark:text-slate-350 hover:text-brand-gold-dark dark:hover:text-brand-gold transition-colors"
                      >
                        <span>Request Privilege</span>
                        <ChevronRight className="w-3 h-3 ml-0.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-150 dark:border-slate-800/60 p-8">
                <p className="text-slate-450 dark:text-slate-400 text-sm">No partner outlets found matching your search query.</p>
              </div>
            )
          )}
        </div>
        {/* Product Details Modal Overlay */}
        {selectedProductForModal && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4 animate-fade-in text-slate-800 dark:text-slate-200"
            onClick={() => setSelectedProductForModal(null)}
          >
            <div 
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-6 shadow-2xl max-w-lg w-full overflow-y-auto max-h-[85vh] text-left transition-all relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button 
                onClick={() => setSelectedProductForModal(null)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center justify-center cursor-pointer border-none transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Category Tag */}
              <span className="inline-block bg-[#0b1e36] dark:bg-brand-gold/10 text-white dark:text-brand-gold text-[9px] font-black px-2.5 py-0.5 rounded uppercase tracking-wider mb-3">
                {selectedProductForModal.category || 'Verified Deal'}
              </span>

              {/* Image display */}
              <div className="aspect-video w-full bg-slate-50 dark:bg-slate-950 rounded-2xl overflow-hidden mb-5 border border-slate-150 dark:border-slate-850 flex items-center justify-center p-4">
                <img 
                  src={selectedProductForModal.image} 
                  alt={selectedProductForModal.name} 
                  className="w-full h-full object-contain max-h-[220px]"
                />
              </div>

              {/* Name and Vendor */}
              <h2 className="text-lg font-black text-slate-900 dark:text-white leading-tight mb-1.5">
                {selectedProductForModal.name}
              </h2>
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                <span>Partner:</span>
                <span className="text-[#0b1e36] dark:text-brand-gold font-extrabold">{selectedProductForModal.vendorName || 'Verified Partner'}</span>
              </div>

              {/* Price */}
              <div className="flex items-baseline gap-2.5 mb-5 border-t border-b border-slate-100 dark:border-slate-800/80 py-3">
                <span className="text-2xl font-black text-slate-900 dark:text-white">₹{parseFloat(selectedProductForModal.price).toLocaleString()}</span>
                {selectedProductForModal.originalPrice && (
                  <>
                    <span className="text-sm text-slate-400 line-through">₹{parseFloat(selectedProductForModal.originalPrice).toLocaleString()}</span>
                    <span className="text-xs font-black text-amber-500">{selectedProductForModal.discount || 'Special Deal'}</span>
                  </>
                )}
              </div>

              {/* Description */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Description</h4>
                  <p className="text-xs sm:text-sm text-slate-650 dark:text-slate-300 leading-relaxed">
                    {selectedProductForModal.description || `${selectedProductForModal.name} is a high-quality product/service curated and verified by our partner team. Claim your member privilege today to get the best pricing, priority bookings, and fast-track support.`}
                  </p>
                </div>

                {/* Dynamic Product Specifications */}
                {(() => {
                  const specs = selectedProductForModal.specifications || selectedProductForModal.customFields || {};
                  const entries = Object.entries(specs).filter(([k, v]) => v && String(v).trim());
                  if (entries.length > 0) {
                    return (
                      <div>
                        <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Product Specifications</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                          {entries.map(([key, val]) => (
                            <div key={key} className="flex justify-between items-center text-xs py-1.5 px-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800">
                              <span className="font-semibold text-slate-400">{key}:</span>
                              <span className="font-bold text-slate-800 dark:text-slate-100">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  const highlights = getProductHighlights(selectedProductForModal);
                  if (highlights.length > 0) {
                    return (
                      <div>
                        <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Specifications</h4>
                        <div className="space-y-2.5">
                          {highlights.map((hl, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-xs text-slate-650 dark:text-slate-350">
                              <div className="w-4 h-4 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                <svg className="w-2.5 h-2.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                              </div>
                              <span>{hl}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
