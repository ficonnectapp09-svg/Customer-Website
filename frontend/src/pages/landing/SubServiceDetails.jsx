import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, Compass, Clock, ShieldCheck, Sparkles, ExternalLink, Globe, Laptop, Layers,
  MapPin, Phone, Star, Search, Calendar, Heart, AlertCircle, Check, X, ShieldAlert, Activity
} from 'lucide-react';
import { productService } from '../../services/productService';
import { apiFetch } from '../../services/api';
import hotelMockup from '../../assets/images/hotel_shubha_sai_actual.png';
import skMockup from '../../assets/images/sk_technologies_mockup.png';
import luxury3dMockup from '../../assets/images/luxury_3d_design.png';

// Mock Hospitals Data
const hospitalsData = [
  {
    id: 'hosp-apollo',
    vendorId: '2l64elf7emqhm2o0m',
    name: 'Apollo Hospitals',
    address: 'Bannerghatta Road, Bangalore',
    rating: 4.8,
    reviews: 1840,
    phone: '+91 80 2630 4050',
    emergency: '1066',
    specialities: ['Cardiology', 'Oncology', 'Neurology', 'Nephrology'],
    amenities: ['24/7 Emergency', 'ICU Facility', 'Ambulance Service', 'In-house Pharmacy'],
    image: 'https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?w=800&auto=format&fit=crop&q=80',
    doctors: [
      { name: 'Dr. Sandeep Kumar', dept: 'Cardiology', experience: '18 Yrs Exp', fee: 800 },
      { name: 'Dr. Priya Sharma', dept: 'Neurology', experience: '15 Yrs Exp', fee: 900 },
      { name: 'Dr. R. C. Mishra', dept: 'Oncology', experience: '22 Yrs Exp', fee: 1000 },
      { name: 'Dr. Anil Kumar', dept: 'Nephrology', experience: '12 Yrs Exp', fee: 750 }
    ]
  },
  {
    id: 'hosp-manipal',
    vendorId: '2l64elf7emqhm2o0m',
    name: 'Manipal Hospital',
    address: 'HAL Airport Road, Bangalore',
    rating: 4.7,
    reviews: 1532,
    phone: '+91 80 2502 4444',
    emergency: '080-2222-2222',
    specialities: ['Orthopedics', 'Cardiology', 'Pediatrics', 'Gastroenterology'],
    amenities: ['ICU Facility', 'Ambulance Service', 'Diagnostics Lab', '24/7 Pharmacy'],
    image: 'https://images.unsplash.com/photo-1586773860418-d3b3da966367?w=800&auto=format&fit=crop&q=80',
    doctors: [
      { name: 'Dr. Rajesh Iyer', dept: 'Orthopedics', experience: '20 Yrs Exp', fee: 850 },
      { name: 'Dr. Meera Nair', dept: 'Pediatrics', experience: '12 Yrs Exp', fee: 700 },
      { name: 'Dr. Sunil D\'Souza', dept: 'Cardiology', experience: '15 Yrs Exp', fee: 800 },
      { name: 'Dr. V. K. Gupta', dept: 'Gastroenterology', experience: '16 Yrs Exp', fee: 900 }
    ]
  },
  {
    id: 'hosp-fortis',
    vendorId: '2l64elf7emqhm2o0m',
    name: 'Fortis Hospital',
    address: 'Cunningham Road, Bangalore',
    rating: 4.9,
    reviews: 980,
    phone: '+91 80 4199 4444',
    emergency: '105010',
    specialities: ['Cardiology', 'Urology', 'Orthopedics', 'Pulmonology'],
    amenities: ['24/7 Emergency', 'ICU Facility', 'Blood Bank', 'Diagnostics Lab'],
    image: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800&auto=format&fit=crop&q=80',
    doctors: [
      { name: 'Dr. Amit Verma', dept: 'Cardiology', experience: '16 Yrs Exp', fee: 900 },
      { name: 'Dr. Shalini Rao', dept: 'Urology', experience: '14 Yrs Exp', fee: 800 },
      { name: 'Dr. Vivek Jawali', dept: 'Cardiology', experience: '30 Yrs Exp', fee: 1200 },
      { name: 'Dr. H. P. Radhika', dept: 'Pulmonology', experience: '11 Yrs Exp', fee: 750 }
    ]
  },
  {
    id: 'hosp-narayana',
    vendorId: '2l64elf7emqhm2o0m',
    name: 'Narayana Health',
    address: 'Bommasandra Industrial Area, Bangalore',
    rating: 4.8,
    reviews: 2240,
    phone: '+91 80 7122 2222',
    emergency: '080-7111-2345',
    specialities: ['Cardiology', 'Oncology', 'Nephrology', 'Neurology'],
    amenities: ['24/7 Emergency', 'Organ Transplant', 'Ambulance Service', 'ICU Facility'],
    image: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&auto=format&fit=crop&q=80',
    doctors: [
      { name: 'Dr. Devi Prasad Shetty', dept: 'Cardiology', experience: '35 Yrs Exp', fee: 1000 },
      { name: 'Dr. Kiran Mazumdar', dept: 'Oncology', experience: '25 Yrs Exp', fee: 1200 },
      { name: 'Dr. Srinath Rao', dept: 'Nephrology', experience: '19 Yrs Exp', fee: 800 },
      { name: 'Dr. S. K. Gupta', dept: 'Neurology', experience: '16 Yrs Exp', fee: 900 }
    ]
  }
];

const specialtiesList = ['All Specialties', 'Cardiology', 'Oncology', 'Neurology', 'Nephrology', 'Orthopedics', 'Pediatrics', 'Urology', 'Gastroenterology'];

export default function SubServiceDetails({ title, onBack }) {
  const [activeTab, setActiveTab] = useState('website'); // 'website' | 'application' | '3d-design'
  
  // Hospital-specific search & filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('All Specialties');
  
  // Appointment modal states
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [bookingDepartment, setBookingDepartment] = useState('');
  const [bookingDoctor, setBookingDoctor] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState('');

  // Generic purchase modal states
  const [selectedItemForPurchase, setSelectedItemForPurchase] = useState(null);
  const [purchaseName, setPurchaseName] = useState('Dhanush Kumar');
  const [purchasePhone, setPurchasePhone] = useState('+91 98765 43210');
  const [purchaseAddress, setPurchaseAddress] = useState('Koramangala, 5th Block, Bangalore');
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');

  // Dynamic Vendor Products
  const [vendorProducts, setVendorProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProductForModal, setSelectedProductForModal] = useState(null);

  // Auto-scroll to top on component load
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [title]);

  useEffect(() => {
    let active = true;
    const fetchProducts = async () => {
      try {
        const res = await productService.getProducts();
        if (active && res && res.success && Array.isArray(res.products)) {
          setVendorProducts(res.products);
        }
      } catch (err) {
        console.warn("Failed to fetch products in SubServiceDetails:", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchProducts();
    return () => { active = false; };
  }, [title]);

  const isITServices = (title || '') === 'IT Services';
  const isHospitals = (title || '') === 'Hospitals' || (title || '') === 'Healthcare';

  // Group vendor products belonging to category 'Hospitals' by vendorName
  const getDynamicHospitals = () => {
    const hospitalProducts = vendorProducts.filter(p => 
      (p.category || '').toLowerCase() === 'hospitals'
    );

    const groupedHospitals = {};
    hospitalProducts.forEach(p => {
      const vName = p.vendorName || 'General Hospital Partner';
      const vId = p.vendorId || 'v_hosp_temp';
      if (!groupedHospitals[vId]) {
        groupedHospitals[vId] = {
          id: `hosp-${vId}`,
          vendorId: vId,
          name: vName,
          address: 'Koramangala, Bangalore (Verified Area)',
          rating: 4.8,
          reviews: 124,
          phone: '+91 80 4455 6677',
          emergency: '1066',
          specialities: [],
          amenities: ['24/7 Emergency', 'ICU Facility', 'Ambulance Service', 'In-house Pharmacy'],
          image: p.image || 'https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?w=800&auto=format&fit=crop&q=80',
          doctors: []
        };
      }

      let deptName = 'General Medicine';
      const lowerName = (p.name || '').toLowerCase();
      if (lowerName.includes('cardiologist') || lowerName.includes('cardio')) {
        deptName = 'Cardiology';
      } else if (lowerName.includes('pediatrician') || lowerName.includes('pediat')) {
        deptName = 'Pediatrics';
      } else if (lowerName.includes('neurologist') || lowerName.includes('neuro')) {
        deptName = 'Neurology';
      } else if (lowerName.includes('oncologist') || lowerName.includes('onco')) {
        deptName = 'Oncology';
      } else if (lowerName.includes('nephrologist') || lowerName.includes('nephro')) {
        deptName = 'Nephrology';
      } else if (lowerName.includes('orthopedics') || lowerName.includes('ortho')) {
        deptName = 'Orthopedics';
      } else if (lowerName.includes('urologist') || lowerName.includes('uro')) {
        deptName = 'Urology';
      } else if (lowerName.includes('gastro') || lowerName.includes('gastroenterologist')) {
        deptName = 'Gastroenterology';
      }

      if (!groupedHospitals[vId].specialities.includes(deptName)) {
        groupedHospitals[vId].specialities.push(deptName);
      }

      groupedHospitals[vId].doctors.push({
        id: p.id,
        name: p.name,
        dept: deptName,
        experience: '15 Yrs Exp',
        fee: p.price
      });
    });

    const dynamicList = [...hospitalsData];
    Object.values(groupedHospitals).forEach(h => {
      if (!dynamicList.some(item => (item.name || '').toLowerCase() === (h.name || '').toLowerCase())) {
        dynamicList.push(h);
      }
    });

    return dynamicList;
  };

  const dynamicHospitals = getDynamicHospitals();

  // Filter vendor products belonging to this sub-category/type with fallback
  const getSubServiceProducts = () => {
    const t = (title || '').toLowerCase();
    const matches = vendorProducts.filter(p => {
      const cat = (p.category || '').toLowerCase();
      const subNav = (p.subNavbarCategory || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      return cat.includes(t) || subNav.includes(t) || (cat && t.includes(cat)) || name.includes(t);
    });

    if (matches.length > 0) return matches;

    // Rich fallback items for subcategories
    return [
      {
        id: `fb-${t}-1`,
        name: `${title || 'Exclusive'} Signature Privilege Package`,
        vendorName: 'Connect Certified Partner',
        category: title || 'Premium Privilege',
        description: `Verified luxury privileges and priority booking for ${title || 'members'}. Includes member perks and dedicated manager assistance.`,
        price: '499',
        originalPrice: '1299',
        image: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=600&auto=format&fit=crop&q=80',
        badge: 'Member Special'
      },
      {
        id: `fb-${t}-2`,
        name: `Elite ${title || 'Partner'} Reservation & Access Pass`,
        vendorName: 'Connect Group Enterprise',
        category: title || 'Exclusive Deal',
        description: `Instant voucher access with zero convenience fees. Valid across participating partner outlets in major metro cities.`,
        price: '799',
        originalPrice: '1999',
        image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&auto=format&fit=crop&q=80',
        badge: 'Trending'
      },
      {
        id: `fb-${t}-3`,
        name: `VIP ${title || 'Service'} Audit & Privilege Deal`,
        vendorName: 'Verified Alliance Partner',
        category: title || 'VIP Service',
        description: `Handpicked partner listing audited for quality, security, and top operational standards. Dedicated helpline support included.`,
        price: '999',
        originalPrice: '2499',
        image: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&auto=format&fit=crop&q=80',
        badge: 'Verified'
      }
    ];
  };

  const matchedVendorProducts = getSubServiceProducts();

  const availableDoctors = selectedHospital
    ? selectedHospital.doctors.filter(doc => doc.dept === bookingDepartment)
    : [];

  // Portfolio items data source
  const portfolioProjects = [
    {
      id: 'p-hotel',
      category: 'website',
      title: 'Hotel Shubha Sai',
      subtitle: 'Hospitality & Room Booking Portal',
      icon: Globe,
      image: hotelMockup,
      desc: 'A premium hotel website featuring interactive reservation queries, luxury suite showcases, virtual amenity tours, and high-performance booking configurations.',
      tech: ['React', 'TailwindCSS', 'Vite', 'SEO Optimized'],
      url: 'https://www.hotelshubhasai.com/'
    },
    {
      id: 'p-sk',
      category: 'application',
      title: 'SK Technologies',
      subtitle: 'Enterprise Software & Consulting',
      icon: Laptop,
      image: skMockup,
      desc: 'A sleek technology services portal introducing cloud migrations, digital audits, customized SaaS application architecture, and a modern product landing page.',
      tech: ['Next.js', 'TailwindCSS', 'Cloud Architect', 'SaaS'],
      url: 'https://www.sktechnology.services/'
    },
    {
      id: 'p-3d',
      category: '3d-design',
      title: 'Connect Luxury Villas',
      subtitle: '3D Architectural Renders',
      icon: Layers,
      image: luxury3dMockup,
      desc: 'Interactive 3D real estate visualization, photorealistic living space renders, lighting studies, and virtual interior architecture models for marketing.',
      tech: ['Blender', 'V-Ray', 'Architectural Renders', '3D Design'],
      url: '#'
    }
  ];

  const filteredProjects = portfolioProjects.filter(p => p.category === activeTab);

  // Hospital filter logic
  const filteredHospitals = dynamicHospitals.filter(hosp => {
    const matchesSearch = (hosp.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (hosp.address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (hosp.specialities || []).some(spec => (spec || '').toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesSpecialty = selectedSpecialty === 'All Specialties' ||
                            (hosp.specialities || []).includes(selectedSpecialty);
    
    return matchesSearch && matchesSpecialty;
  });

  const handleOpenBooking = (hospital) => {
    setSelectedHospital(hospital);
    setBookingDepartment((hospital.specialities && hospital.specialities[0]) || 'General Medicine');
    const firstDoc = hospital.doctors.find(doc => doc.dept === ((hospital.specialities && hospital.specialities[0]) || 'General Medicine'));
    setBookingDoctor(firstDoc ? firstDoc.name : '');
    setBookingDate('');
    setBookingTime('');
    setBookingSuccess(false);
    setBookingError('');
    setBookingModalOpen(true);
  };

  const handleDepartmentChange = (deptName) => {
    setBookingDepartment(deptName);
    if (selectedHospital) {
      const doctorsInDept = selectedHospital.doctors.filter(d => d.dept === deptName);
      setBookingDoctor(doctorsInDept.length > 0 ? doctorsInDept[0].name : '');
    }
  };

  const handleConfirmBooking = async (e) => {
    e.preventDefault();
    if (!bookingDate) {
      setBookingError('Please select a date for your appointment.');
      return;
    }
    if (!bookingTime) {
      setBookingError('Please select a preferred time slot for your appointment.');
      return;
    }

    const docObj = selectedHospital?.doctors?.find(d => d.name === bookingDoctor);
    const productId = docObj?.id || 'v_prod_mock';
    const fee = docObj?.fee || 800;

    try {
      const res = await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          vendor_id: selectedHospital?.vendorId || '',
          customer_name: 'Dhanush Kumar',
          customer_phone: '+91 98765 43210',
          customer_address: 'Koramangala, 5th Block, Bangalore',
          customer_latitude: 12.9498,
          customer_longitude: 77.6289,
          product_details: `Appointment with ${bookingDoctor} at ${selectedHospital?.name}`,
          amount: fee,
          type: 'Appointment',
          appointmentDate: bookingDate,
          appointmentTimeSlot: bookingTime,
          doctorName: bookingDoctor,
          items: [{
            productId: productId,
            name: `Appointment with ${bookingDoctor}`,
            price: fee,
            quantity: 1
          }]
        })
      });

      if (res.status === 'success') {
        setBookingError('');
        setBookingSuccess(true);
      } else {
        setBookingError(res.message || 'Failed to place booking.');
      }
    } catch (err) {
      console.error('[SubServiceDetails]: Confirm booking failed:', err);
      setBookingError('Server connection issue placing appointment.');
    }
  };

  const handleConfirmPurchase = async (e) => {
    e.preventDefault();
    if (!selectedItemForPurchase) return;

    try {
      const res = await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          vendor_id: selectedItemForPurchase.vendorId || '',
          customer_name: purchaseName,
          customer_phone: purchasePhone,
          customer_address: purchaseAddress,
          customer_latitude: 12.9498,
          customer_longitude: 77.6289,
          product_details: `${selectedItemForPurchase.name} x 1`,
          amount: selectedItemForPurchase.price,
          items: [{
            productId: selectedItemForPurchase.id,
            name: selectedItemForPurchase.name,
            price: selectedItemForPurchase.price,
            quantity: 1
          }]
        })
      });

      if (res.status === 'success') {
        setPurchaseSuccess(true);
        setPurchaseError('');
      } else {
        setPurchaseError(res.message || 'Failed to complete order.');
      }
    } catch (err) {
      console.error('Failed generic purchase:', err);
      setPurchaseError('Server connection issue placing order.');
    }
  };

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
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 text-slate-900 dark:text-slate-100 pt-6 sm:pt-10 pb-20 px-3.5 sm:px-6 md:px-12 lg:px-20 relative overflow-hidden transition-colors duration-300">
      {/* Background glowing effects */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-gold/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-50/10 dark:bg-slate-900/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full relative z-10 py-6">

        {/* Unified Single-line Header: Back Button and Title (Left-aligned) */}
        <div className="flex items-center justify-start space-x-4 mb-10 pb-5 border-b border-slate-200/60 dark:border-slate-800">
          <button
            onClick={onBack}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-350 dark:hover:border-slate-700 hover:shadow-xs transition-all cursor-pointer shrink-0 group"
            aria-label="Back to Home"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          </button>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-sans leading-none">
            {isHospitals ? 'Elite Hospital Network' : (title || 'Services')}
          </h1>
        </div>

        {isHospitals ? (
          /* ==================== HOSPITALS DIRECTORY VIEW ==================== */
          <div>
            {/* Header section with description */}
            <div className="max-w-3xl mb-12 text-left">
              <span className="text-[#FFC107] font-bold text-xs uppercase tracking-widest flex items-center gap-1.5 mb-2.5">
                <Activity className="w-4.5 h-4.5 animate-pulse" />
                <span>Forge India Verified Partners</span>
              </span>
              <p className="text-slate-500 dark:text-slate-400 text-xs md:text-sm leading-relaxed">
                Connect App members enjoy <strong>priority appointments, zero waiting times,</strong> and cash-free billing integrations at these leading healthcare institutions. Select a hospital to book your instant consultation slot.
              </p>
            </div>

            {/* Filters Bar: Search & Specialities */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 mb-8 shadow-xs flex flex-col gap-5">
              {/* Search box */}
              <div className="relative flex items-center border border-slate-350 dark:border-slate-800 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 rounded-xl px-3.5 py-2.5 focus-within:border-[#FFC107] transition-all">
                <Search className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                <input 
                  type="text"
                  placeholder="Search hospitals by name, specialty, or area..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs md:text-sm bg-transparent focus:outline-hidden text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>

              {/* Speciality Pills */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                {specialtiesList.map((spec) => {
                  const isActive = selectedSpecialty === spec;
                  return (
                    <button
                      key={spec}
                      onClick={() => setSelectedSpecialty(spec)}
                      className={`text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-full border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-[#0b1e36] text-white border-[#0b1e36] dark:bg-[#FFC107] dark:text-[#0b1e36] dark:border-[#FFC107] shadow-xs'
                          : 'bg-slate-50/20 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {spec}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hospitals Grid */}
            {filteredHospitals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {filteredHospitals.map((hosp) => (
                  <div 
                    key={hosp.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/70 rounded-2xl overflow-hidden shadow-xs hover:shadow-lg transition-all duration-300 flex flex-col md:flex-row group"
                  >
                    {/* Hospital Image */}
                    <div className="md:w-5/12 aspect-[4/3] md:aspect-auto overflow-hidden relative border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-850">
                      <img 
                        src={hosp.image} 
                        alt={hosp.name} 
                        className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500"
                      />
                      <div className="absolute top-3 left-3 bg-[#0b1e36]/80 backdrop-blur-xs text-white text-[9px] font-black px-2 py-0.5 rounded uppercase flex items-center gap-1 border border-white/10">
                        <Star className="w-3.5 h-3.5 fill-[#FFC107] text-[#FFC107]" />
                        <span>{hosp.rating} ({hosp.reviews})</span>
                      </div>
                    </div>

                    {/* Hospital Details */}
                    <div className="md:w-7/12 p-5 md:p-6 flex flex-col justify-between text-left">
                      <div className="space-y-3">
                        <div>
                          <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight leading-tight group-hover:text-[#FFC107] transition-colors">
                            {hosp.name}
                          </h3>
                          <div className="flex items-start gap-1 text-[10px] text-slate-400 mt-1">
                            <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                            <span className="font-semibold leading-normal">{hosp.address}</span>
                          </div>
                        </div>

                        {/* Specialities list */}
                        <div className="flex flex-wrap gap-1">
                          {hosp.specialities.map((spec) => (
                            <span key={spec} className="bg-blue-500/10 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider border border-blue-500/10 dark:border-blue-900/30">
                              {spec}
                            </span>
                          ))}
                        </div>

                        {/* Emergency Helpline */}
                        <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl px-3 py-2 flex items-center justify-between text-[9px]">
                          <span className="font-extrabold text-rose-500 uppercase tracking-widest flex items-center gap-1 shrink-0">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            <span>Emergency Helpline:</span>
                          </span>
                          <span className="font-black text-rose-600 dark:text-rose-400 font-mono">{hosp.emergency}</span>
                        </div>

                        {/* Amenities List */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {hosp.amenities.map((amenity) => (
                            <span key={amenity} className="text-[9px] text-slate-400 dark:text-slate-500 font-bold flex items-center gap-1 leading-none">
                              <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span>{amenity}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Contact and Booking action */}
                      <div className="border-t border-slate-100 dark:border-slate-800/60 pt-4 mt-5 flex items-center gap-3">
                        <a 
                          href={`tel:${hosp.phone.replace(/\s+/g, '')}`} 
                          className="w-9 h-9 rounded-full bg-slate-100 hover:bg-[#FFC107]/20 text-slate-600 hover:text-[#0b1e36] dark:bg-slate-800 dark:hover:bg-[#FFC107]/25 dark:text-slate-350 dark:hover:text-[#FFC107] flex items-center justify-center shrink-0 transition-colors cursor-pointer border border-slate-200/40 dark:border-slate-800"
                          title="Call Hospital Contact Desk"
                        >
                          <Phone className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => handleOpenBooking(hosp)}
                          className="flex-grow py-2.5 px-4 bg-[#FFC107] hover:bg-amber-500 hover:scale-[1.01] text-[#0b1e36] hover:shadow-md text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                        >
                          Book Priority Slot
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 max-w-md mx-auto flex flex-col items-center justify-center shadow-xs">
                <div className="w-14 h-14 bg-rose-50 dark:bg-slate-800 text-rose-500 rounded-full flex items-center justify-center mb-4 border border-rose-100 dark:border-slate-700">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-black text-slate-850 dark:text-slate-200 uppercase tracking-wider mb-2">No Hospitals Found</h4>
                <p className="text-slate-400 text-xs leading-relaxed mb-6">
                  We couldn't find any hospitals in this network matching "{searchQuery}" or the "{selectedSpecialty}" filter.
                </p>
                <button
                  onClick={() => { setSearchQuery(''); setSelectedSpecialty('All Specialties'); }}
                  className="text-xs font-bold text-[#FFC107] hover:text-amber-600 underline cursor-pointer"
                >
                  Clear search filters
                </button>
              </div>
            )}
          </div>
        ) : matchedVendorProducts.length > 0 ? (
          /* ==================== DYNAMIC VENDOR CATALOG VIEW ==================== */
          <div>
            <div className="max-w-3xl mb-12 text-left animate-fade-in">
              <span className="text-brand-gold font-bold text-xs uppercase tracking-widest flex items-center gap-1.5 mb-2.5">
                <Sparkles className="w-4.5 h-4.5 text-brand-gold animate-pulse" />
                <span>Forge India Partner Catalog</span>
              </span>
              <p className="text-slate-500 dark:text-slate-400 text-xs md:text-sm leading-relaxed">
                Connect members enjoy exclusive negotiated rates on all partner deals. Instant reservations are directly synced with our partner dashboards.
              </p>
            </div>

            <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-4 md:gap-6 animate-fade-in text-left">
              {matchedVendorProducts.map((product) => (
                <div
                  key={product.id}
                  onClick={() => setSelectedProductForModal(product)}
                  className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col group hover:-translate-y-1 hover:border-brand-gold/45 hover:shadow-md transition-all duration-300 rounded-2xl cursor-pointer"
                >
                  {/* Product Image Container */}
                  <div className="relative aspect-square w-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <span className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-xs text-white text-[9px] font-semibold px-2 py-0.5 rounded select-none">
                      {product.vendorName || 'Verified Partner'}
                    </span>
                  </div>

                  {/* Product Details */}
                  <div className="p-4 flex flex-col flex-grow justify-between bg-white dark:bg-slate-900">
                    <div>
                      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        {product.category || 'Deal'}
                      </h3>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug group-hover:text-brand-gold-dark dark:group-hover:text-brand-gold transition-colors" title={product.name}>
                        {product.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        {product.description || 'No description available.'}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-850 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 line-through block leading-none">
                          ₹{product.originalPrice}
                        </span>
                        <span className="text-base font-extrabold text-slate-900 dark:text-white mt-1 block">
                          ₹{product.price}
                        </span>
                      </div>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItemForPurchase(product);
                          setPurchaseSuccess(false);
                          setPurchaseError('');
                        }}
                        className="py-2 px-3 bg-brand-gold hover:bg-brand-gold-dark text-slate-955 text-[10px] font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer border-none"
                      >
                        Claim Privilege
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ==================== GENERAL PLACEHOLDER VIEW ==================== */
          <div>
            {/* Content Box */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-2xl p-8 md:p-12 shadow-xl shadow-slate-100/40 max-w-2xl mx-auto relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-brand-gold via-yellow-400 to-amber-600" />
              
              <div className="w-16 h-16 bg-amber-50 dark:bg-slate-800 text-brand-gold-dark dark:text-brand-gold rounded-full flex items-center justify-center mx-auto mb-6 border border-amber-100 dark:border-slate-700">
                <Clock className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-3 font-sans">
                Under Curation & Verification
              </h3>
              
              <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base leading-relaxed mb-8">
                Our audit team is currently verifying the credentials and operational standards of elite partners in the <strong>{title || 'Selected'}</strong> sector. Vetted listings and custom integration features will be active here shortly.
              </p>

              {/* Quick list of trust factors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left max-w-md mx-auto border-t border-slate-100 dark:border-slate-800 pt-6">
                <div className="flex items-start space-x-2.5 text-xs text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>100% Background-checked Suppliers</span>
                </div>
                <div className="flex items-start space-x-2.5 text-xs text-slate-500 dark:text-slate-400">
                  <Sparkles className="w-4 h-4 text-brand-gold shrink-0" />
                  <span>Exclusive Member-only Corporate Rates</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Appointment Booking Modal */}
      {bookingModalOpen && selectedHospital && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          {/* Backdrop click to close */}
          <div className="fixed inset-0" onClick={() => setBookingModalOpen(false)} />
          
          {/* Modal Container */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl relative z-10 overflow-hidden text-left animate-scale-up">
            
            {/* Header banner */}
            <div className="bg-[#0b1e36] text-white p-6 relative">
              <button 
                onClick={() => setBookingModalOpen(false)}
                className="absolute top-4 right-4 p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close booking modal"
              >
                <X className="w-5 h-5" />
              </button>
              <span className="text-[9px] font-black uppercase tracking-widest text-[#FFC107] block mb-1">Priority Pass Active</span>
              <h2 className="text-lg font-black tracking-tight leading-tight">
                {selectedHospital.name} Appointment
              </h2>
              <p className="text-[10px] text-slate-400 leading-normal mt-1">
                Verified member privilege scheduling with premium fast-track check-in.
              </p>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {!bookingSuccess ? (
                /* Booking Form */
                <form onSubmit={handleConfirmBooking} className="space-y-4">
                  {bookingError && (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex items-start gap-2 text-rose-600 text-xs">
                      <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                      <span className="font-semibold leading-normal">{bookingError}</span>
                    </div>
                  )}

                  {/* Speciality/Dept dropdown */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Department / Specialty</label>
                    <select
                      value={bookingDepartment}
                      onChange={(e) => handleDepartmentChange(e.target.value)}
                      className="w-full text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 focus:outline-hidden focus:border-[#FFC107] text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      {selectedHospital.specialities.map(spec => (
                        <option key={spec} value={spec}>{spec}</option>
                      ))}
                    </select>
                  </div>

                  {/* Doctor select */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Consulting Specialist</label>
                    <select
                      value={bookingDoctor}
                      onChange={(e) => setBookingDoctor(e.target.value)}
                      className="w-full text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 focus:outline-hidden focus:border-[#FFC107] text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      {availableDoctors.map(doc => (
                        <option key={doc.name} value={doc.name}>{doc.name} ({doc.dept} - {doc.experience})</option>
                      ))}
                    </select>
                  </div>

                  {/* Date Input */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Preferred Date</label>
                    <div className="relative">
                      <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input 
                        type="date"
                        value={bookingDate}
                        onChange={(e) => setBookingDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 pl-10 focus:outline-hidden focus:border-[#FFC107] text-slate-800 dark:text-slate-100"
                        required
                      />
                    </div>
                  </div>

                  {/* Time slot picker */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Preferred Time Slot</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        'Morning (09:00 AM - 12:00 PM)',
                        'Afternoon (12:00 PM - 04:00 PM)',
                        'Evening (04:00 PM - 08:00 PM)'
                      ].map((slot) => {
                        const isSelected = bookingTime === slot;
                        const label = slot.split(' ')[0];
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setBookingTime(slot)}
                            className={`py-2 px-1 text-[9px] font-black uppercase rounded-xl border text-center transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-blue-500/10 text-blue-650 dark:text-blue-400 border-blue-500 dark:bg-blue-900/25'
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Booking fee details and submit */}
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60 mt-4 flex items-center justify-between gap-4">
                    <div>
                      <span className="block text-[8px] text-slate-400 font-extrabold uppercase tracking-widest leading-none">Connect Pricing</span>
                      <span className="text-base font-black text-slate-900 dark:text-white mt-1 block leading-none">
                        ₹0 <span className="text-[10px] text-emerald-500 font-extrabold uppercase tracking-wide bg-emerald-500/10 border border-emerald-500/10 px-1.5 py-0.5 rounded ml-1">Free Priority Booking</span>
                      </span>
                    </div>
                    
                    <button
                      type="submit"
                      className="py-3 px-6 bg-[#FFC107] hover:bg-amber-500 text-[#0b1e36] text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer hover:shadow-md flex items-center gap-1.5 shadow-sm"
                    >
                      <span>Confirm Appointment</span>
                      <Check className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </form>
              ) : (
                /* Success Message Dialog */
                <div className="text-center py-6 space-y-6 animate-scale-up">
                  {/* Big Check circle */}
                  <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-xs">
                    <Check className="w-8 h-8 stroke-[3]" />
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">Appointment Confirmed!</h3>
                    <p className="text-[10px] text-slate-400 font-bold max-w-sm mx-auto">
                      Your fast-track consult ticket is active. Present this digital ticket at the front office to bypass regular queues.
                    </p>
                  </div>

                  {/* Summary ticket card */}
                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-2xl p-4 text-xs font-semibold text-slate-600 dark:text-slate-400 space-y-2.5 max-w-xs mx-auto border-dashed text-left">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400">Hospital:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-right">{selectedHospital.name}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400">Specialty:</span>
                      <span className="font-bold text-slate-850 dark:text-slate-200">{bookingDepartment}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400">Specialist:</span>
                      <span className="font-bold text-slate-850 dark:text-slate-200">{bookingDoctor}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 border-t border-slate-200/50 dark:border-slate-800/60 pt-2">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400">Date:</span>
                      <span className="font-bold text-blue-600 dark:text-blue-400">{new Date(bookingDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400">Time Slot:</span>
                      <span className="font-bold text-blue-650 dark:text-blue-400">{bookingTime ? bookingTime.split(' ')[0] : 'Not Selected'}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 border-t border-slate-200/50 dark:border-slate-800/60 pt-2">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400">Member Pass ID:</span>
                      <span className="font-bold font-mono text-[#FFC107]">CONN-8812-0495</span>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      onClick={() => setBookingModalOpen(false)}
                      className="w-full py-3 bg-[#0b1e36] text-white hover:bg-slate-800 dark:bg-[#FFC107] dark:text-[#0b1e36] dark:hover:bg-amber-500 text-xs font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer text-center"
                    >
                      Close & Go Back
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Generic Item Purchase Modal */}
      {selectedItemForPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          {/* Backdrop click to close */}
          <div className="fixed inset-0" onClick={() => setSelectedItemForPurchase(null)} />
          
          {/* Modal Container */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl relative z-10 overflow-hidden text-left animate-scale-up">
            
            {/* Header banner */}
            <div className="bg-[#0b1e36] text-white p-6 relative">
              <button 
                onClick={() => setSelectedItemForPurchase(null)}
                className="absolute top-4 right-4 p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close purchase modal"
              >
                <X className="w-5 h-5" />
              </button>
              <span className="text-[9px] font-black uppercase tracking-widest text-brand-gold block mb-1">Instant Privileges Active</span>
              <h2 className="text-lg font-black tracking-tight leading-tight">
                Privilege Order Form
              </h2>
              <p className="text-[10px] text-slate-400 leading-normal mt-1">
                Order directly from our audited luxury and convenience network.
              </p>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {!purchaseSuccess ? (
                /* Purchase Form */
                <form onSubmit={handleConfirmPurchase} className="space-y-4">
                  {purchaseError && (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex items-start gap-2 text-rose-600 text-xs">
                      <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                      <span className="font-semibold leading-normal">{purchaseError}</span>
                    </div>
                  )}

                  {/* Summary card of item being purchased */}
                  <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl p-4 border border-slate-200/50 dark:border-slate-850 flex gap-4 text-left">
                    <img 
                      src={selectedItemForPurchase.image} 
                      alt={selectedItemForPurchase.name} 
                      className="w-16 h-16 object-cover rounded-lg border dark:border-slate-800"
                    />
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{selectedItemForPurchase.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">{selectedItemForPurchase.vendorName}</p>
                      <span className="text-xs font-black text-brand-gold-dark mt-1 block">₹{selectedItemForPurchase.price}</span>
                    </div>
                  </div>

                  {/* Name field */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Contact Name</label>
                    <input 
                      type="text"
                      value={purchaseName}
                      onChange={(e) => setPurchaseName(e.target.value)}
                      className="w-full text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 focus:outline-hidden focus:border-brand-gold text-slate-800 dark:text-slate-100"
                      required
                    />
                  </div>

                  {/* Phone field */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Phone Number</label>
                    <input 
                      type="text"
                      value={purchasePhone}
                      onChange={(e) => setPurchasePhone(e.target.value)}
                      className="w-full text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 focus:outline-hidden focus:border-brand-gold text-slate-800 dark:text-slate-100"
                      required
                    />
                  </div>

                  {/* Address textarea */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Delivery / Service Address</label>
                    <textarea 
                      value={purchaseAddress}
                      onChange={(e) => setPurchaseAddress(e.target.value)}
                      className="w-full text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 focus:outline-hidden focus:border-brand-gold text-slate-800 dark:text-slate-100"
                      rows={2}
                      required
                    />
                  </div>

                  {/* Pricing and submit */}
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60 mt-4 flex items-center justify-between gap-4">
                    <div>
                      <span className="block text-[8px] text-slate-400 font-extrabold uppercase tracking-widest leading-none">Total Amount</span>
                      <span className="text-base font-black text-slate-900 dark:text-white mt-1 block leading-none">
                        ₹{selectedItemForPurchase.price}
                      </span>
                    </div>
                    
                    <button
                      type="submit"
                      className="py-3 px-6 bg-brand-gold hover:bg-brand-gold-dark text-slate-950 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer hover:shadow-md flex items-center gap-1.5 shadow-sm"
                    >
                      <span>Place Privilege Order</span>
                      <Check className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </form>
              ) : (
                /* Success Message Dialog */
                <div className="text-center py-6 space-y-6 animate-scale-up">
                  {/* Big Check circle */}
                  <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-xs">
                    <Check className="w-8 h-8 stroke-[3]" />
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">Order Confirmed!</h3>
                    <p className="text-[10px] text-slate-400 font-bold max-w-sm mx-auto">
                      Your premium reservation has been accepted and directly synced with {selectedItemForPurchase.vendorName}.
                    </p>
                  </div>

                  <div className="pt-4">
                    <button
                      onClick={() => setSelectedItemForPurchase(null)}
                      className="w-full py-3 bg-[#0b1e36] text-white hover:bg-slate-800 dark:bg-brand-gold dark:text-slate-950 dark:hover:bg-brand-gold-dark text-xs font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer text-center"
                    >
                      Close Window
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

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
              <div className="aspect-video w-full bg-slate-50 dark:bg-slate-950 rounded-2xl overflow-hidden mb-5 border border-slate-150 dark:border-slate-855 flex items-center justify-center p-4">
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
  );
}
