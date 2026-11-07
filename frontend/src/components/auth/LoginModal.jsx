import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Mail, Lock, Eye, EyeOff, LogIn, Check, 
  Phone, ShieldCheck, AlertCircle, RefreshCw, KeyRound, CheckCircle2, ArrowLeft 
} from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import { sanitizeMobileInput, validateMobile } from '../../utils/validation';
import { getBackendUrl } from '../../services/apiSetup';
import logoImg from '../../assets/images/forge india logo.jpg';

export default function LoginModal({ isOpen, onClose, onLoginSuccess, onNavigateToJoinNow }) {
  const { login } = useAuth();
  const [loginMethod, setLoginMethod] = useState('password'); // 'password' | 'otp'
  
  // Password Mode States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  
  // OTP Mode States
  const [otpTarget, setOtpTarget] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [generatedOtpCode, setGeneratedOtpCode] = useState('');
  const [otpSuccessMsg, setOtpSuccessMsg] = useState('');
  
  // Security States
  const [requireCaptcha, setRequireCaptcha] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isNotRegistered, setIsNotRegistered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Centralized API Base URL
  const getApiBase = () => {
    const base = getBackendUrl();
    return base ? `${base}/api` : '/api';
  };

  // OTP Resend Cooldown Countdown Timer
  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  // Handler for Password Login
  const handlePasswordSubmit = async (e) => {
    e?.preventDefault();
    setErrorMsg('');
    setIsNotRegistered(false);

    if (requireCaptcha && !captchaVerified) {
      setErrorMsg('Please complete the Captcha security check to continue.');
      return;
    }

    if (isSubmitting) return;
    if (!email.trim() || !password) {
      setErrorMsg('Please enter both email/phone and password.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`${getApiBase()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          phone: email.trim(),
          password,
          role: 'customer'
        })
      }).catch(() => null);

      if (!res) {
        setIsSubmitting(false);
        setErrorMsg('Unable to connect to server. Please check your internet connection.');
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setIsSubmitting(false);
        if (res.status === 403 || data.code === 'ACCOUNT_INACTIVE') {
          setErrorMsg(data.message || 'Your account is inactive or suspended. Please contact support.');
        } else if (res.status === 429 || data.code === 'RATE_LIMIT_EXCEEDED') {
          setErrorMsg(data.message || 'Too many attempts. Please try again later.');
        } else if (data.notRegistered || data.code === 'ACCOUNT_NOT_FOUND') {
          setIsNotRegistered(true);
          setErrorMsg(data.message || 'Please register first to access the Customer website.');
        } else {
          setErrorMsg(data.message || 'Invalid email/mobile number or password. Please check your credentials and try again.');
        }
        return;
      }

      // Success authenticated strictly by backend DB
      setIsSubmitting(false);
      setSuccess(true);

      const loggedUser = data.user || { email: email.trim(), role: 'customer' };
      login({ ...loggedUser, _isExplicitAuth: true }, 'customer', (finalUser) => {
        setTimeout(() => {
          setSuccess(false);
          if (onLoginSuccess) onLoginSuccess(finalUser);
          onClose();
        }, 600);
      });

    } catch (err) {
      setIsSubmitting(false);
      setErrorMsg('Authentication error. Please try again.');
    }
  };

  // Handler for OTP Generation with Database Registration Check
  const handleSendOtp = async () => {
    const target = otpTarget.trim();
    if (!target) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }

    setErrorMsg('');
    setIsNotRegistered(false);
    setOtpSuccessMsg('');
    setIsSubmitting(true);

    try {
      const res = await fetch(`${getApiBase()}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: target,
          mobileNumber: target,
          mobileOrEmail: target
        })
      }).catch(() => null);

      if (!res || !res.ok) {
        const data = res ? await res.json().catch(() => ({})) : {};
        const errMsg = data.message || data.msg || data.error || data.details || '';

        if (res && res.status === 404) {
          setIsSubmitting(false);
          setIsNotRegistered(true);
          setErrorMsg('Please register first to access the Customer website.');
          return;
        }

        if (res && res.status === 403) {
          setIsSubmitting(false);
          setErrorMsg(errMsg || 'Your account is inactive or suspended. Please contact support.');
          return;
        }

        if (res && res.status === 429) {
          setIsSubmitting(false);
          setErrorMsg(errMsg || 'Please wait before requesting another OTP.');
          return;
        }

        setIsSubmitting(false);
        setErrorMsg(errMsg || 'Failed to send OTP. Please try again.');
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (data.status === 'success' || data.success) {
        setIsSubmitting(false);
        const issuedCode = data.devOtpPreview || data.otp || '';
        setGeneratedOtpCode(issuedCode);
        setIsOtpSent(true);
        setResendCooldown(data.cooldownSeconds || 30);
        setOtpSuccessMsg(issuedCode ? `OTP Sent Successfully! Security Code: ${issuedCode}` : 'OTP Sent Successfully!');
        return;
      } else {
        setIsSubmitting(false);
        const errMsg = data.message || data.msg || data.error || '';
        if (res.status === 404 || data.notRegistered || data.code === 'MOBILE_NOT_REGISTERED') {
          setIsNotRegistered(true);
          setErrorMsg('Please register first to access the Customer website.');
        } else {
          setErrorMsg(errMsg || 'Failed to send OTP. Please try again.');
        }
        return;
      }
    } catch (err) {
      setIsSubmitting(false);
      setErrorMsg('Network error. Please try again.');
    }
  };

  // Handler for OTP Verification
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (!otpInput || otpInput.length < 6) {
      setErrorMsg('Please enter the full 6-digit OTP code.');
      return;
    }

    setErrorMsg('');
    setOtpSuccessMsg('');
    setIsSubmitting(true);

    const inputClean = otpInput.trim();

    try {
      const res = await fetch(`${getApiBase()}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: otpTarget,
          mobileNumber: otpTarget,
          mobileOrEmail: otpTarget,
          otp: inputClean
        })
      }).catch(() => null);

      if (!res || !res.ok) {
        const data = res ? await res.json().catch(() => ({})) : {};
        setIsSubmitting(false);
        if (res && res.status === 404 || data.notRegistered) {
          setIsNotRegistered(true);
          setErrorMsg('Please register first to access the Customer website.');
        } else {
          setErrorMsg(data.message || 'Invalid or expired OTP code. Please try again.');
        }
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data.status === 'success' && data.user) {
        setIsSubmitting(false);
        setSuccess(true);
        login({ ...data.user, _isExplicitAuth: true }, 'customer', (finalUser) => {
          setTimeout(() => {
            setSuccess(false);
            if (onLoginSuccess) onLoginSuccess(finalUser);
            onClose();
          }, 600);
        });
      } else {
        setIsSubmitting(false);
        setErrorMsg(data.message || 'Verification failed. Please register to continue.');
      }
    } catch (err) {
      setIsSubmitting(false);
      setErrorMsg('Network error verifying OTP. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/65 backdrop-blur-xs animate-fade-in text-slate-800 dark:text-slate-200 select-none">
      
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Content Box */}
      <div className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto bg-white dark:bg-[#0b1329] border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 sm:p-8 z-10 animate-scale-up text-left">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all cursor-pointer border-none bg-transparent"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top Logo Header */}
        <div className="flex items-center gap-3 mb-4 pr-8">
          <img 
            src={logoImg} 
            alt="Forge India Connect Logo" 
            className="w-10 h-10 object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs" 
          />
          <div>
            <h2 className="text-base font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-1 leading-none uppercase">
              Connect <span className="text-[#FFC107]">App</span>
            </h2>
            <p className="text-[9.5px] font-bold text-slate-400 tracking-wide uppercase mt-0.5">Enterprise DevSecOps Login</p>
          </div>
        </div>

        {success ? (
          <div className="text-center py-8 animate-scale-up space-y-3">
            <div className="w-14 h-14 bg-amber-100 dark:bg-amber-950/60 text-[#FFC107] rounded-full flex items-center justify-center mx-auto border border-amber-300 dark:border-amber-700 shadow-lg animate-bounce">
              <Check className="w-7 h-7 stroke-[3]" />
            </div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white">Authenticated!</h3>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              JWT Token issued & session recorded securely.
            </p>
          </div>
        ) : (
          <>
            {/* Login Method Switcher Tabs */}
            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl mb-4">
              <button
                type="button"
                onClick={() => { setLoginMethod('password'); setErrorMsg(''); setOtpSuccessMsg(''); }}
                className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer border-none ${
                  loginMethod === 'password'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white bg-transparent'
                }`}
              >
                Password Login
              </button>
              <button
                type="button"
                onClick={() => { setLoginMethod('otp'); setErrorMsg(''); setOtpSuccessMsg(''); }}
                className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer border-none ${
                  loginMethod === 'otp'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white bg-transparent'
                }`}
              >
                OTP Instant Login
              </button>
            </div>

            {/* Error Alert Box */}
            {errorMsg && (
              <div className="mb-3.5 p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs font-bold rounded-2xl flex flex-col gap-2.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  <span className="flex-1">{errorMsg}</span>
                </div>
                {isNotRegistered && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onNavigateToJoinNow) onNavigateToJoinNow();
                    }}
                    className="w-full py-2.5 px-4 bg-[#FFB800] hover:bg-[#E5A700] text-slate-950 font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 border-none active:scale-[0.98]"
                  >
                    <span>Register Now</span>
                    <span className="text-sm">→</span>
                  </button>
                )}
              </div>
            )}

            {/* OTP Success Info Box */}
            {otpSuccessMsg && (
              <div className="mb-3.5 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-xl flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                <span>{otpSuccessMsg}</span>
              </div>
            )}

            {/* 1. PASSWORD LOGIN FORM */}
            {loginMethod === 'password' ? (
              <form onSubmit={handlePasswordSubmit} autoComplete="off" className="space-y-3.5">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                    Email Address or Phone Number
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      autoComplete="off"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errorMsg) setErrorMsg('');
                        if (isNotRegistered) setIsNotRegistered(false);
                      }}
                      placeholder="Enter email or 10-digit mobile"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 pl-10 pr-4 text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#FFC107] focus:ring-2 focus:ring-[#FFC107]/20 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errorMsg) setErrorMsg('');
                        if (isNotRegistered) setIsNotRegistered(false);
                      }}
                      placeholder="Enter password"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 pl-10 pr-10 text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#FFC107] focus:ring-2 focus:ring-[#FFC107]/20 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg border-none bg-transparent cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Google reCAPTCHA v3 / Security Checkbox */}
                {requireCaptcha && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between">
                    <label className="flex items-center gap-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input 
                        type="checkbox"
                        checked={captchaVerified}
                        onChange={(e) => setCaptchaVerified(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-[#FFC107] accent-[#FFC107] cursor-pointer"
                      />
                      <span>I'm not a robot (Security Verification)</span>
                    </label>
                    <ShieldCheck className="w-5 h-5 text-blue-500" />
                  </div>
                )}

                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-[#FFC107] accent-[#FFC107] cursor-pointer"
                    />
                    <span>Remember this device</span>
                  </label>

                  <a 
                    href="/login?mode=forgot" 
                    onClick={(e) => {
                      e.preventDefault();
                      if (onClose) onClose();
                      window.location.href = '/login?mode=forgot';
                    }} 
                    className="text-xs font-extrabold text-[#003B95] dark:text-[#FFC107] hover:underline cursor-pointer"
                  >
                    Forgot Password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-6 bg-[#FFC107] hover:bg-amber-500 text-slate-950 font-black text-xs uppercase tracking-widest rounded-2xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 border-none active:scale-[0.99] disabled:opacity-75 disabled:cursor-not-allowed mt-2"
                >
                  {isSubmitting ? <span>Authenticating...</span> : <><LogIn className="w-4 h-4" /><span>Login</span></>}
                </button>
              </form>
            ) : (
              /* 2. OTP INSTANT LOGIN FORM */
              <div className="space-y-3.5">
                {!isOtpSent ? (
                  (() => {
                    const isDigitsOnly = /^\d*$/.test(otpTarget);
                    const mobileVal = isDigitsOnly && otpTarget.length > 0 ? validateMobile(otpTarget) : null;
                    const otpButtonDisabled = isSubmitting || !otpTarget.trim() || (isDigitsOnly && otpTarget.length > 0 && !mobileVal?.isValid);
                    return (
                  <>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300">
                          Mobile Number (10 Digits)
                        </label>
                        {mobileVal?.isValid && (
                          <span className="text-emerald-500 text-[10px] font-bold flex items-center gap-0.5"><CheckCircle2 size={12} /> Valid</span>
                        )}
                      </div>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          value={otpTarget}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (/^\d*$/.test(raw) || raw === '') {
                              setOtpTarget(sanitizeMobileInput(raw));
                            } else {
                              setOtpTarget(raw);
                            }
                          }}
                          placeholder="Enter mobile number starting with 6, 7, 8 or 9"
                          className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-2xl py-2.5 pl-10 pr-4 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-[#FFC107] ${
                            mobileVal && !mobileVal.isValid ? 'border-rose-400' : 'border-slate-200 dark:border-slate-800'
                          }`}
                        />
                      </div>
                      {mobileVal && !mobileVal.isValid && (
                        <p className="text-[10px] text-rose-500 font-bold mt-1">{mobileVal.error}</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={otpButtonDisabled}
                      className={`w-full py-3 px-6 font-black text-xs uppercase tracking-widest rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 border-none mt-2 ${
                        otpButtonDisabled
                          ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
                          : 'bg-[#FFC107] hover:bg-amber-500 text-slate-950 cursor-pointer'
                      }`}
                    >
                      {isSubmitting ? (
                        <span>Generating OTP...</span>
                      ) : (
                        <>
                          <KeyRound className="w-4 h-4" />
                          <span>Send 6-Digit Security OTP</span>
                        </>
                      )}
                    </button>
                  </>
                  );
                  })()
                ) : (
                  <form onSubmit={handleVerifyOtp} className="space-y-3.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsOtpSent(false);
                        setOtpInput('');
                        setErrorMsg('');
                        setOtpSuccessMsg('');
                      }}
                      className="flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-900 dark:hover:text-white border-none bg-transparent cursor-pointer mb-1 transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Back to Mobile Number</span>
                    </button>

                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                        Enter 6-Digit Security OTP
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        value={otpInput}
                        onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="• • • • • •"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 text-center tracking-[0.5em] text-lg font-black text-slate-900 dark:text-white focus:outline-none focus:border-[#FFC107]"
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                      <span>OTP valid for 5 mins</span>
                      {resendCooldown > 0 ? (
                        <span>Resend in {resendCooldown}s</span>
                      ) : (
                        <button type="button" onClick={handleSendOtp} className="text-[#003B95] dark:text-amber-400 hover:underline border-none bg-transparent cursor-pointer font-bold flex items-center gap-1">
                          <RefreshCw size={12} /> Resend OTP
                        </button>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting || otpInput.length < 6}
                      className="w-full py-3 px-6 bg-[#FFC107] hover:bg-amber-500 text-slate-950 font-black text-xs uppercase tracking-widest rounded-2xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 border-none disabled:opacity-60"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Verify & Login</span>
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Bottom Signup Prompt */}
            <div className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400 pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onNavigateToJoinNow) onNavigateToJoinNow();
                }}
                className="font-extrabold text-[#003B95] dark:text-[#FFC107] hover:underline bg-transparent border-none p-0 inline cursor-pointer"
              >
                Sign Up
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
