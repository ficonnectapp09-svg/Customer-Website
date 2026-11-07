import React, { useState, useEffect } from 'react';
import { Copy, Check, Tag, Gift, Plane, ShieldCheck, Utensils } from 'lucide-react';
import { getAdminBackendUrl } from '../../services/apiSetup';

export default function Offers() {
  const [copiedCode, setCopiedCode] = useState(null);
  const [liveOffers, setLiveOffers] = useState([]);

  useEffect(() => {
    const fetchOffers = async () => {
      try {
        const adminBase = getAdminBackendUrl();
        const targetUrl = adminBase ? `${adminBase}/api/admin/public/exclusive-offers` : '/api/admin/public/exclusive-offers';
        const res = await fetch(targetUrl).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setLiveOffers(data);
          }
        }
      } catch (err) {
        console.warn("Could not fetch live admin exclusive offers:", err);
      }
    };
    fetchOffers();
  }, []);

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    }).catch(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  const displayOffers = liveOffers.map((off, idx) => {
    const icons = [Tag, Utensils, Plane, ShieldCheck, Gift];
    const lightBgs = [
      'bg-[#fffbeb] dark:bg-[#1a1208]/40',
      'bg-[#f5f3ff] dark:bg-[#110c22]/40',
      'bg-[#ecfdf5] dark:bg-[#062015]/40',
      'bg-[#eff6ff] dark:bg-[#0b172a]/40',
      'bg-[#fff1f2] dark:bg-[#200a11]/40'
    ];
    const borderColors = [
      'border-[#fde68a] dark:border-[#38260e]/50',
      'border-[#ddd6fe] dark:border-[#22174d]/50',
      'border-[#a7f3d0] dark:border-[#134e35]/50',
      'border-[#bfdbfe] dark:border-[#1e3a8a]/50',
      'border-[#fecdd3] dark:border-[#881337]/50'
    ];
    const tagBgs = [
      'bg-gradient-to-r from-orange-500 to-orange-600',
      'bg-gradient-to-r from-violet-500 to-indigo-600',
      'bg-gradient-to-r from-emerald-500 to-teal-600',
      'bg-gradient-to-r from-blue-500 to-cyan-600',
      'bg-gradient-to-r from-rose-500 to-pink-600'
    ];
    const iconBgs = [
      'bg-[#ffedd5] dark:bg-[#341a0b] text-[#f97316]',
      'bg-[#e0e7ff] dark:bg-[#1a1738] text-[#6366f1]',
      'bg-[#d1fae5] dark:bg-[#064e3b] text-[#10b981]',
      'bg-[#dbeafe] dark:bg-[#1e3a8a] text-[#3b82f6]',
      'bg-[#ffe4e6] dark:bg-[#881337] text-[#f43f5e]'
    ];

    return {
      id: off._id || idx,
      title: off.title,
      discount: off.discount || 'Special Discount',
      code: off.code || 'CONNECT',
      desc: off.desc || off.description || 'Exclusive offer for active Connect members.',
      imageUrl: off.imageUrl || '',
      icon: icons[idx % icons.length],
      lightBg: lightBgs[idx % lightBgs.length],
      borderColor: borderColors[idx % borderColors.length],
      tagBg: tagBgs[idx % tagBgs.length],
      iconBg: iconBgs[idx % iconBgs.length]
    };
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8 text-left animate-fade-in text-slate-800 dark:text-slate-100">
      
      {/* Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-violet-50/50 via-indigo-50/25 to-white dark:from-slate-900/60 dark:via-slate-900/40 dark:to-slate-950 border border-slate-100 dark:border-slate-800/80 rounded-3xl p-5 sm:p-8 flex items-center justify-between shadow-3xs">
        <div className="flex items-center gap-3.5 sm:gap-4 relative z-10 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/25">
            <Gift className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">Privilege Offers</h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-bold mt-1">Exclusive discounts pre-applied for active Connect members</p>
          </div>
        </div>

        {/* Decorative Gift Box Illustration */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-4">
          <div className="relative w-16 h-16 animate-bounce" style={{ animationDuration: '3s' }}>
            {/* Bow */}
            <div className="absolute -top-3.5 left-5 w-5 h-4 bg-amber-400 rounded-full rotate-12 z-30"></div>
            <div className="absolute -top-3.5 left-8 w-5 h-4 bg-amber-400 rounded-full -rotate-12 z-30"></div>
            <div className="absolute -top-3 left-7 w-3 h-3 bg-amber-300 rounded-full z-40"></div>
            {/* Lid */}
            <div className="absolute top-0 left-2 w-13 h-4 bg-gradient-to-r from-violet-400 to-indigo-400 rounded shadow-md z-20"></div>
            {/* Box base */}
            <div className="absolute top-3 left-3.5 w-10.5 h-11 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-b-lg shadow-lg z-10">
              {/* Ribbon */}
              <div className="absolute top-0 left-4 w-2.5 h-full bg-amber-400"></div>
            </div>
            {/* Floating Tag */}
            <div className="absolute -right-1 top-4 bg-violet-600 text-white text-[9px] font-black py-0.5 px-1 rounded-md rotate-12 shadow-sm animate-pulse flex items-center justify-center">
              %
            </div>
          </div>
        </div>
      </div>

      {/* Offers Grid */}
      {displayOffers.length === 0 ? (
        <div className="p-8 sm:p-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl col-span-2">
          <Gift className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-black text-slate-700 dark:text-slate-300">No Exclusive Offers Available</p>
          <p className="text-xs text-slate-400 mt-1 font-semibold">Check back later for new promotional deals and discounts.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {displayOffers.map((off, idx) => {
          const Icon = off.icon;
          const isCopied = copiedCode === off.code;
          return (
            <div 
              key={off.title} 
              className={`relative overflow-hidden rounded-3xl border-2 ${off.borderColor} ${off.lightBg} p-5 sm:p-6 flex flex-col justify-between gap-5 sm:gap-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 group`}
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              {/* Illustration Background Graphic */}
              {off.illustration}
              
              {/* Top Section */}
              <div className="relative z-10 flex items-start gap-3.5 sm:gap-4">
                {off.imageUrl ? (
                  <img
                    src={off.imageUrl}
                    alt={off.title}
                    onError={(e) => { e.target.style.display = 'none'; }}
                    className="w-12 h-12 sm:w-14 sm:h-14 object-cover rounded-2xl shrink-0 border border-slate-200 dark:border-slate-800 shadow-2xs"
                  />
                ) : (
                  <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full ${off.iconBg} flex items-center justify-center shrink-0 shadow-2xs`}>
                    <Icon className="w-6 h-6 sm:w-6.5 sm:h-6.5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="text-base font-black text-slate-900 dark:text-white leading-tight break-words">{off.title}</h4>
                  <p className="text-xs text-slate-455 dark:text-slate-400 mt-1.5 leading-relaxed max-w-full font-medium">{off.desc}</p>
                </div>
              </div>

              {/* Bottom Section */}
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200/50 dark:border-slate-800/40">
                {/* Discount Tag */}
                <span className={`${off.tagBg} text-white text-xs font-extrabold px-3.5 sm:px-4.5 py-2 sm:py-2.5 rounded-full shadow-md shadow-slate-500/10 uppercase tracking-wide border-none`}>
                  {off.discount}
                </span>

                {/* Coupon Code Block */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Use Code</span>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl pl-3 sm:pl-4 pr-2 sm:pr-2.5 py-1.5 flex items-center gap-2.5 sm:gap-3 shadow-3xs">
                    <span className="font-mono text-xs font-black text-slate-700 dark:text-slate-200 tracking-wider">
                      {off.code}
                    </span>
                    <button
                      onClick={() => handleCopyCode(off.code)}
                      className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center cursor-pointer transition-all hover:bg-slate-100 dark:hover:bg-slate-700 border-none p-0 group/copy"
                    >
                      {isCopied ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-slate-400 group-hover/copy:text-indigo-500 transition-colors" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      )}

      {/* Footer Note */}
      <div className="bg-blue-50/20 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800 rounded-2xl py-3.5 px-6 flex items-center justify-center gap-2.5 shadow-3xs text-center">
        <ShieldCheck className="w-5 h-5 text-blue-500" />
        <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">
          Offers are auto-applied at checkout for eligible Connect members. <span className="text-blue-500 cursor-pointer hover:underline">Terms & conditions</span> apply.
        </p>
      </div>
    </div>
  );
}
