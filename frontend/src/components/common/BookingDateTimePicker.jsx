import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Check } from 'lucide-react';

/**
 * Format a Date object to YYYY-MM-DD
 */
function toDateStr(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format YYYY-MM-DD to human friendly string: "Wed, 14 Oct 2026"
 */
function formatHumanDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  if (isNaN(d.getTime())) return dateStr;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdays[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Modern Date Input with functional Calendar Popup
 */
export function BookingDateInput({
  label = 'Date',
  value = '',
  onChange,
  minDate,
  maxDate,
  blockedDates = [],
  unavailableDates = [],
  accentColor = 'blue',
  placeholder = 'Select Date...',
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Initialize view date based on current value or today
  const [viewDate, setViewDate] = useState(() => {
    if (value && typeof value === 'string' && value.includes('-')) {
      const [y, m, d] = value.split('-').map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    return new Date();
  });

  // Keep viewDate in sync when value changes externally
  useEffect(() => {
    if (value && typeof value === 'string' && value.includes('-')) {
      const [y, m, d] = value.split('-').map(Number);
      if (y && m && d) {
        setViewDate(new Date(y, m - 1, d));
      }
    }
  }, [value]);

  // Click outside to close calendar
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handlePrevMonth = (e) => {
    e.stopPropagation();
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    setViewDate(new Date(year, month + 1, 1));
  };

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days = [];

    // Prev month padding days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const prevDate = new Date(year, month - 1, daysInPrevMonth - i);
      const dStr = toDateStr(prevDate);
      days.push({
        dayNumber: daysInPrevMonth - i,
        dateStr: dStr,
        isCurrentMonth: false,
        isDisabled: true
      });
    }

    // Current month days
    const todayStr = toDateStr(new Date());
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      const curDate = new Date(year, month, i);
      const dStr = toDateStr(curDate);
      let isDisabled = false;

      if (minDate && dStr < minDate) isDisabled = true;
      if (maxDate && dStr > maxDate) isDisabled = true;
      if (blockedDates?.includes(dStr)) isDisabled = true;
      if (unavailableDates?.includes(dStr)) isDisabled = true;

      days.push({
        dayNumber: i,
        dateStr: dStr,
        isCurrentMonth: true,
        isSelected: value === dStr,
        isToday: dStr === todayStr,
        isDisabled
      });
    }

    // Next month padding days to complete 35 or 42 grid cells
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        const nextDate = new Date(year, month + 1, i);
        const dStr = toDateStr(nextDate);
        days.push({
          dayNumber: i,
          dateStr: dStr,
          isCurrentMonth: false,
          isDisabled: true
        });
      }
    }

    return days;
  }, [year, month, value, minDate, maxDate, blockedDates, unavailableDates]);

  const displayDate = formatHumanDate(value);

  const isEmerald = accentColor === 'emerald';
  const accentClasses = {
    ring: isEmerald ? 'focus-within:ring-emerald-500/20 focus-within:border-emerald-500' : 'focus-within:ring-blue-500/20 focus-within:border-blue-500',
    iconColor: isEmerald ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400',
    iconBgHover: isEmerald ? 'hover:bg-emerald-50 dark:hover:bg-emerald-950/40' : 'hover:bg-blue-50 dark:hover:bg-blue-950/40',
    selectedBg: isEmerald ? 'bg-emerald-600 text-white font-black shadow-sm' : 'bg-blue-600 text-white font-black shadow-sm',
    hoverDay: isEmerald ? 'hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700 dark:hover:text-emerald-300' : 'hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-700 dark:hover:text-blue-300',
    todayRing: isEmerald ? 'border-emerald-500' : 'border-blue-500',
    todayDot: isEmerald ? 'bg-emerald-500' : 'bg-blue-500',
    todayText: isEmerald ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'
  };

  return (
    <div className={`text-left relative ${className}`} ref={containerRef}>
      {label && (
        <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1.5">
          {label}
        </label>
      )}

      {/* Modern Date Input Box */}
      <div className="relative">
        <input
          type="text"
          readOnly
          value={displayDate}
          onClick={() => setIsOpen(!isOpen)}
          placeholder={placeholder || 'Select Date...'}
          className={`w-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl py-2.5 pl-3.5 pr-10 text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 shadow-2xs cursor-pointer transition-all hover:border-slate-300 dark:hover:border-slate-700 focus:outline-none ${accentClasses.ring} ${
            isOpen ? (isEmerald ? 'ring-2 ring-emerald-500/20 border-emerald-500' : 'ring-2 ring-blue-500/20 border-blue-500') : ''
          }`}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg ${accentClasses.iconColor} ${accentClasses.iconBgHover} transition-colors border-none bg-transparent cursor-pointer`}
          title="Open calendar"
          aria-label="Open calendar"
        >
          <CalendarIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Calendar Popup */}
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/40 z-[104] sm:hidden"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }} 
          />
          <div className="fixed inset-x-3 top-1/2 -translate-y-1/2 sm:inset-auto sm:top-full sm:left-0 sm:translate-x-0 sm:translate-y-0 sm:absolute sm:mt-2 z-[105] bg-white dark:bg-[#0b1329] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-3.5 sm:p-4 w-[min(calc(100vw-1.5rem),330px)] select-none animate-scale-up max-h-[85vh] overflow-y-auto scrollbar-thin mx-auto">
          {/* Calendar Header */}
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border-none bg-transparent cursor-pointer"
              title="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs sm:text-sm font-black text-slate-800 dark:text-white">
              {monthNames[month]} {year}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border-none bg-transparent cursor-pointer"
              title="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Days of week header */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <span key={d} className="text-[10px] font-black uppercase text-slate-400">
                {d}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((item, idx) => {
              if (!item.isCurrentMonth) {
                return (
                  <div
                    key={`pad-${idx}`}
                    className="h-8 flex items-center justify-center text-[11px] text-slate-300 dark:text-slate-700"
                  >
                    {item.dayNumber}
                  </div>
                );
              }

              if (item.isDisabled) {
                return (
                  <div
                    key={`day-${item.dateStr}`}
                    className="h-8 flex items-center justify-center text-[11px] text-slate-300 dark:text-slate-700 cursor-not-allowed line-through"
                    title="Date not available"
                  >
                    {item.dayNumber}
                  </div>
                );
              }

              return (
                <button
                  key={`day-${item.dateStr}`}
                  type="button"
                  onClick={() => {
                    onChange?.(item.dateStr);
                    setIsOpen(false);
                  }}
                  className={`h-8 rounded-xl text-xs font-bold transition-all flex items-center justify-center border-none cursor-pointer relative ${
                    item.isSelected
                      ? accentClasses.selectedBg
                      : `text-slate-800 dark:text-slate-200 bg-transparent ${accentClasses.hoverDay}`
                  } ${item.isToday && !item.isSelected ? `border ${accentClasses.todayRing} font-black` : ''}`}
                >
                  <span>{item.dayNumber}</span>
                  {item.isToday && !item.isSelected && (
                    <span className={`absolute bottom-1 w-1 h-1 rounded-full ${accentClasses.todayDot}`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Bottom Quick Jump / Today Row */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                const todayStr = toDateStr(new Date());
                setViewDate(new Date());
                if (!minDate || todayStr >= minDate) {
                  onChange?.(todayStr);
                  setIsOpen(false);
                }
              }}
              className={`text-[11px] font-extrabold ${accentClasses.todayText} hover:underline border-none bg-transparent cursor-pointer p-0`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 border-none bg-transparent cursor-pointer p-0"
            >
              Close
            </button>
          </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Modern Time Input with functional Clock/Slot Popup
 */
export function BookingTimeInput({
  label = 'Time',
  value = '',
  onChange,
  availableSlots = [],
  selectedDate,
  isPastTimeFn,
  accentColor = 'blue',
  placeholder = 'Select Time...',
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Parse hour, minute, ampm from current value
  const parseCurrentTime = (timeStr) => {
    const match = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      return {
        hour: String(parseInt(match[1], 10)).padStart(2, '0'),
        minute: match[2],
        ampm: match[3].toUpperCase()
      };
    }
    return { hour: '12', minute: '00', ampm: 'PM' };
  };

  const [timeState, setTimeState] = useState(() => parseCurrentTime(value));

  // Sync internal custom time state when value prop updates
  useEffect(() => {
    if (value) {
      setTimeState(parseCurrentTime(value));
    }
  }, [value]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const isEmerald = accentColor === 'emerald';
  const accentClasses = {
    ring: isEmerald ? 'focus-within:ring-emerald-500/20 focus-within:border-emerald-500' : 'focus-within:ring-blue-500/20 focus-within:border-blue-500',
    iconColor: isEmerald ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400',
    iconBgHover: isEmerald ? 'hover:bg-emerald-50 dark:hover:bg-emerald-950/40' : 'hover:bg-blue-50 dark:hover:bg-blue-950/40',
    selectedBg: isEmerald ? 'bg-emerald-600 text-white font-black shadow-sm' : 'bg-blue-600 text-white font-black shadow-sm',
    hoverChip: isEmerald ? 'hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700' : 'hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-700',
    buttonBg: isEmerald ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white',
    badge: isEmerald ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-100 dark:border-emerald-900' : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border-blue-100 dark:border-blue-900',
    headerIcon: isEmerald ? 'text-emerald-500' : 'text-blue-500',
    activeAmPm: isEmerald ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'
  };

  // Predefined quick slots or passed slots
  const slotsList = useMemo(() => {
    if (Array.isArray(availableSlots) && availableSlots.length > 0) {
      return availableSlots.map(s => {
        if (typeof s === 'string') return { time: s, status: 'Available' };
        return { time: s.time, status: s.status || 'Available' };
      });
    }
    return [
      { time: '09:00 AM', status: 'Available' },
      { time: '10:00 AM', status: 'Available' },
      { time: '11:00 AM', status: 'Available' },
      { time: '12:00 PM', status: 'Available' },
      { time: '01:00 PM', status: 'Available' },
      { time: '02:00 PM', status: 'Available' },
      { time: '04:00 PM', status: 'Available' },
      { time: '06:00 PM', status: 'Available' }
    ];
  }, [availableSlots]);

  const handleApplyCustomTime = () => {
    const formatted = `${timeState.hour}:${timeState.minute} ${timeState.ampm}`;
    onChange?.(formatted);
    setIsOpen(false);
  };

  return (
    <div className={`text-left relative ${className}`} ref={containerRef}>
      {label && (
        <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1.5">
          {label}
        </label>
      )}

      {/* Modern Time Input Box */}
      <div className="relative">
        <input
          type="text"
          readOnly
          value={value}
          onClick={() => setIsOpen(!isOpen)}
          placeholder={placeholder || 'Select Time...'}
          className={`w-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl py-2.5 pl-3.5 pr-10 text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 shadow-2xs cursor-pointer transition-all hover:border-slate-300 dark:hover:border-slate-700 focus:outline-none select-none ${accentClasses.ring} ${
            isOpen ? (isEmerald ? 'ring-2 ring-emerald-500/20 border-emerald-500' : 'ring-2 ring-blue-500/20 border-blue-500') : ''
          }`}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg ${accentClasses.iconColor} ${accentClasses.iconBgHover} transition-colors border-none bg-transparent cursor-pointer`}
          title="Open time picker"
          aria-label="Open time picker"
        >
          <Clock className="w-4 h-4" />
        </button>
      </div>

      {/* Time Picker Popup */}
      {isOpen && (
        <>
          {/* Mobile Overlay Backdrop */}
          <div 
            className="fixed inset-0 bg-black/40 z-[104] sm:hidden"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }} 
          />

          <div className="fixed inset-x-3 top-1/2 -translate-y-1/2 sm:inset-auto sm:top-full sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0 sm:absolute sm:mt-2 z-[105] bg-white dark:bg-[#0b1329] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-3.5 sm:p-4 w-[min(calc(100vw-1.5rem),330px)] select-none animate-scale-up max-h-[85vh] flex flex-col mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-100 dark:border-slate-800/80 shrink-0">
              <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-1.5">
                <Clock className={`w-3.5 h-3.5 ${accentClasses.headerIcon}`} /> Select Time
              </span>
              <span className={`text-xs font-mono font-black px-2 py-0.5 rounded-lg border ${accentClasses.badge}`}>
                {value || `${timeState.hour}:${timeState.minute} ${timeState.ampm}`}
              </span>
            </div>

            {/* Scrollable Content Container */}
            <div className="overflow-y-auto min-h-0 flex-1 scrollbar-thin pr-0.5 space-y-3">
              {/* Time Selector (Hours : Minutes : AM/PM) */}
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block mb-2">
                  Custom Time Entry
                </span>

                <div className="flex items-center justify-between gap-1.5 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200/60 dark:border-slate-800">
                  {/* Hour Dropdown */}
                  <div className="flex-1">
                    <label className="text-[9px] font-bold text-slate-400 block mb-0.5 text-center">Hour</label>
                    <select
                      value={timeState.hour}
                      onChange={(e) => setTimeState(prev => ({ ...prev, hour: e.target.value }))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-1 px-1.5 text-xs font-bold text-slate-800 dark:text-white text-center cursor-pointer focus:outline-none"
                    >
                      {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <span className="font-bold text-slate-400 self-end mb-1">:</span>

                  {/* Minute Dropdown */}
                  <div className="flex-1">
                    <label className="text-[9px] font-bold text-slate-400 block mb-0.5 text-center">Minute</label>
                    <select
                      value={timeState.minute}
                      onChange={(e) => setTimeState(prev => ({ ...prev, minute: e.target.value }))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-1 px-1.5 text-xs font-bold text-slate-800 dark:text-white text-center cursor-pointer focus:outline-none"
                    >
                      {['00', '15', '30', '45'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  {/* AM/PM Selector */}
                  <div className="flex flex-col justify-end">
                    <label className="text-[9px] font-bold text-slate-400 block mb-0.5 text-center">Period</label>
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setTimeState(prev => ({ ...prev, ampm: 'AM' }))}
                        className={`px-2 py-1 text-[11px] font-black border-none cursor-pointer transition-colors ${
                          timeState.ampm === 'AM'
                            ? accentClasses.activeAmPm
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        AM
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimeState(prev => ({ ...prev, ampm: 'PM' }))}
                        className={`px-2 py-1 text-[11px] font-black border-none cursor-pointer transition-colors ${
                          timeState.ampm === 'PM'
                            ? accentClasses.activeAmPm
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        PM
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pinned Action Controls Footer */}
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 border-none bg-transparent cursor-pointer p-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyCustomTime}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shadow-sm cursor-pointer border-none flex items-center gap-1.5 ${accentClasses.buttonBg}`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Time</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
