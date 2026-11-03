import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { authService, clearClientAuthState, clearAuthCookies } from '../services/authService';
import { socketService } from '../services/socketService';

export const AuthContext = createContext(null);

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const isValidCustomerId = (id) => {
  if (!id || typeof id !== 'string') return false;
  return /^FIC-CUS-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-[0-9]{4}-[0-9]{6}$/.test(id.trim());
};

export const getOrGenerateCustomerId = (userOrId, regDate = new Date()) => {
  if (typeof userOrId === 'object' && userOrId !== null) {
    if (userOrId.customerId && isValidCustomerId(userOrId.customerId)) {
      return userOrId.customerId;
    }
    if (userOrId.registrationId && isValidCustomerId(userOrId.registrationId)) {
      return userOrId.registrationId;
    }
    if (userOrId.customerId && !userOrId.customerId.startsWith('FIC-CUST-')) {
      return userOrId.customerId;
    }
  } else if (typeof userOrId === 'string' && isValidCustomerId(userOrId)) {
    return userOrId;
  }

  const d = regDate instanceof Date && !isNaN(regDate.getTime()) ? regDate : new Date();
  const mmm = MONTH_NAMES[d.getMonth()];
  const yyyy = d.getFullYear();

  let target = '';
  if (typeof userOrId === 'object' && userOrId !== null) {
    target = userOrId.email || userOrId.phone || userOrId.name || userOrId.id || '';
  } else {
    target = String(userOrId || '').trim();
  }

  let hash = 0;
  for (let i = 0; i < target.length; i++) {
    hash = ((hash << 5) - hash) + target.charCodeAt(i);
    hash |= 0;
  }
  const seq = String((Math.abs(hash) % 900000) + 1).padStart(6, '0');
  return `FIC-CUS-${mmm}-${yyyy}-${seq}`;
};

export const normalizeAddressStr = (addr) => {
  if (!addr) return '';
  if (typeof addr === 'string') return addr.trim().toLowerCase().replace(/\s+/g, ' ');
  
  const name = String(addr.name || addr.receiverName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const phone = String(addr.phone || addr.mobileNumber || addr.mobile || '').replace(/\D/g, '').slice(-10);
  const pincode = String(addr.pincode || addr.zip || '').replace(/\D/g, '').slice(0, 6);
  const locality = String(addr.locality || addr.area || addr.sector || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const street = String(addr.address || addr.street || addr.houseNo || addr.flat || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const city = String(addr.city || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const state = String(addr.state || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const parts = [name, phone, pincode, locality, street, city, state];
  return parts.filter(Boolean).join('|');
};

export const deduplicateAddresses = (addrList) => {
  if (!Array.isArray(addrList)) return [];
  const seen = new Set();
  const result = [];
  for (const item of addrList) {
    if (!item) continue;
    const key = normalizeAddressStr(item);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
};

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('connect_current_user');
    if (saved) {
      try {
        const u = JSON.parse(saved);
        if (!u.customerId) {
          if (u.registrationId) {
            u.customerId = u.registrationId;
          } else if (u.id || u._id) {
            u.customerId = u.id || u._id;
          } else {
            u.customerId = getOrGenerateCustomerId(u);
          }
        }
        if (!u.registrationId) {
          u.registrationId = u.customerId;
        }
        const regAddressStr = u.address || u.registeredAddress || '';
        if ((!u.addresses || !Array.isArray(u.addresses) || u.addresses.length === 0) && regAddressStr.trim()) {
          u.addresses = [{
            id: 'addr_reg_' + (u.id || Date.now()),
            name: u.name || 'Connect Member',
            phone: (u.phone || '').replace('+91', '').trim(),
            pincode: u.pincode || '',
            locality: u.city || '',
            address: regAddressStr,
            city: u.city || '',
            state: u.state || '',
            landmark: '',
            altPhone: '',
            type: 'Home',
            isRegistrationAddress: true
          }];
        }
        u.addresses = deduplicateAddresses(u.addresses || []);
        const existingStoredToken = (typeof localStorage !== 'undefined' && (localStorage.getItem('connect_token') || localStorage.getItem('token') || localStorage.getItem('accessToken'))) || '';
        const tokenToSave = (existingStoredToken && !existingStoredToken.startsWith('token_'))
          ? existingStoredToken
          : (u.token || u.accessToken || existingStoredToken || `token_${u.customerId || Date.now()}`);
        if (!localStorage.getItem('connect_token') || (localStorage.getItem('connect_token').startsWith('token_') && tokenToSave && !tokenToSave.startsWith('token_'))) {
          localStorage.setItem('connect_token', tokenToSave);
        }
        localStorage.setItem('connect_current_user', JSON.stringify(u));
        if (u.customerId) {
          localStorage.setItem('connect_customer_id', u.customerId);
        }
        if (u.id || u._id || u.customerId) {
          localStorage.setItem('connect_user_id', u.id || u._id || u.customerId);
        }
        return u;
      } catch (err) {
        console.warn("Failed to parse connect_current_user from localStorage:", err);
      }
    }
    return null;
  });

  const lastLogoutRef = useRef(0);

  const login = (userInfo, role = 'customer', callback) => {
    let inputUser = {};
    if (typeof userInfo === 'object' && userInfo !== null) {
      inputUser = { ...userInfo };
    } else if (typeof userInfo === 'string') {
      inputUser = { email: userInfo };
    }

    // If a logout occurred recently and this is not an explicit user login, block automatic resurrection
    if (lastLogoutRef.current > 0 && (Date.now() - lastLogoutRef.current < 2500) && !inputUser?._isExplicitAuth) {
      console.warn("Ignoring background session restore right after logout");
      return;
    }

    const extractValidMobile = (val) => {
      if (!val) return '';
      const digits = String(val).replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : '';
    };

    const validMobile = extractValidMobile(inputUser.phone) || extractValidMobile(typeof userInfo === 'string' ? userInfo : '');

    let finalName = inputUser.name;
    if (!finalName || finalName === 'OTP Verified Member' || /^\d+$/.test(finalName)) {
      const emailPrefix = inputUser.email ? inputUser.email.split('@')[0] : '';
      if (emailPrefix && !/^\d+$/.test(emailPrefix)) {
        finalName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
      } else {
        finalName = 'Connect Member';
      }
    }

    const regAddressStr = inputUser.address || inputUser.registeredAddress || '';
    const initialAddresses = Array.isArray(inputUser.addresses) && inputUser.addresses.length > 0
      ? inputUser.addresses
      : (regAddressStr.trim() ? [{
          id: 'addr_reg_' + Date.now(),
          name: finalName,
          phone: validMobile,
          pincode: inputUser.pincode || '',
          locality: inputUser.city || '',
          address: regAddressStr,
          city: inputUser.city || '',
          state: inputUser.state || '',
          landmark: '',
          altPhone: '',
          type: 'Home',
          isRegistrationAddress: true
        }] : []);

    const custId = inputUser.customerId || inputUser.registrationId || inputUser.id || inputUser._id || getOrGenerateCustomerId(inputUser);

    const existingStoredToken = (typeof localStorage !== 'undefined' && (localStorage.getItem('connect_token') || localStorage.getItem('token') || localStorage.getItem('accessToken'))) || '';
    const userToken = inputUser.token || inputUser.accessToken || (existingStoredToken && !existingStoredToken.startsWith('token_') ? existingStoredToken : null) || existingStoredToken || `token_${custId}`;

    const finalAddresses = deduplicateAddresses(initialAddresses);

    const finalUser = {
      ...inputUser,
      name: finalName,
      email: inputUser.email || (validMobile ? `${validMobile}@connect.app` : 'customer@connect.app'),
      phone: validMobile,
      aadhaar: inputUser.aadhaar || inputUser.aadhaarNumber || inputUser.rawAadhaar || '',
      rawAadhaar: inputUser.rawAadhaar || inputUser.aadhaar || inputUser.aadhaarNumber || '',
      avatar: inputUser.avatar || inputUser.photo || '',
      photo: inputUser.avatar || inputUser.photo || '',
      address: inputUser.address || '',
      city: inputUser.city || '',
      pincode: inputUser.pincode || '',
      state: inputUser.state || '',
      role: role || inputUser.role || 'customer',
      customerId: custId,
      token: userToken,
      addresses: finalAddresses
    };

    setCurrentUser(finalUser);
    localStorage.setItem('connect_current_user', JSON.stringify(finalUser));
    localStorage.setItem('connect_token', userToken);
    localStorage.setItem('connect_customer_id', custId);
    localStorage.setItem('connect_user_id', finalUser.id || finalUser._id || custId);
    if (callback) callback(finalUser);
  };

  const logout = useCallback(async () => {
    lastLogoutRef.current = Date.now();

    // 1. Capture current token before clearing for backend session revocation
    const token = (typeof localStorage !== 'undefined' && (localStorage.getItem('connect_token') || localStorage.getItem('token'))) || '';

    // 2. Reset currentUser in memory immediately
    setCurrentUser(null);

    // 3. Synchronously wipe all customer auth & session storage keys IMMEDIATELY
    clearClientAuthState();

    // 4. Clear client-side auth cookies immediately
    clearAuthCookies();

    // 5. Disconnect websocket immediately
    try {
      socketService.disconnect();
    } catch (e) {}

    // 6. Perform backend session revocation and cookie clearing
    try {
      if (authService && typeof authService.logout === 'function') {
        await authService.logout(token);
      }
    } catch (err) {
      console.warn("Backend session revocation error:", err);
    }
  }, []);

  const register = (formData, role, callback) => {
    let displayName = formData.name;
    if (role === 'vendor') {
      displayName = formData.businessName || 'Elite Vendor';
    }

    const regAddressStr = formData.address || '';
    const initialAddresses = regAddressStr.trim() ? [{
      id: 'addr_reg_' + Date.now(),
      name: displayName || 'Connect Member',
      phone: (formData.phone || formData.phoneNumber || '').replace('+91', '').trim(),
      pincode: formData.pincode || '',
      locality: formData.city || '',
      address: regAddressStr,
      city: formData.city || '',
      state: formData.state || '',
      landmark: '',
      altPhone: '',
      type: 'Home',
      isRegistrationAddress: true
    }] : [];

    const custId = (formData.customerId && isValidCustomerId(formData.customerId))
      ? formData.customerId
      : (formData.registrationId && isValidCustomerId(formData.registrationId)
          ? formData.registrationId
          : getOrGenerateCustomerId(formData.email || formData.phone || displayName));
    const existingStoredToken = (typeof localStorage !== 'undefined' && (localStorage.getItem('connect_token') || localStorage.getItem('token') || localStorage.getItem('accessToken'))) || '';
    const userToken = formData.token || formData.accessToken || (existingStoredToken && !existingStoredToken.startsWith('token_') ? existingStoredToken : null) || existingStoredToken || `token_${custId}`;

    const user = {
      name: displayName || 'Connect Member',
      email: formData.email,
      phone: formData.phone || formData.phoneNumber || '',
      address: formData.address || '',
      city: formData.city || '',
      pincode: formData.pincode || '',
      state: formData.state || '',
      aadhaar: formData.aadhaarNumber || '',
      pan: formData.panNumber || '',
      role: role || 'customer',
      customerId: custId,
      token: userToken,
      addresses: initialAddresses
    };

    setCurrentUser(user);
    localStorage.setItem('connect_current_user', JSON.stringify(user));
    localStorage.setItem('connect_token', userToken);
    localStorage.setItem('connect_customer_id', custId);
    localStorage.setItem('connect_user_id', user.id || user._id || custId);
    if (callback) callback(user);
  };

  return (
    <AuthContext.Provider value={{ currentUser, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  );
}

