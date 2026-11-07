const formatUrl = (url) => {
  if (!url) return '';
  let cleaned = String(url).trim().replace(/\/+$/, '');
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = `https://${cleaned}`;
  }
  // Strip trailing /api so callers doing `${getBackendUrl()}/api` don't create double /api/api
  if (cleaned.endsWith('/api')) {
    cleaned = cleaned.slice(0, -4);
  }
  return cleaned;
};

export const isLocalHostname = (hostname) => {
  return (
    !hostname || 
    hostname === 'localhost' || 
    hostname === '127.0.0.1' || 
    hostname.startsWith('192.168.') || 
    hostname.startsWith('10.') ||
    hostname.startsWith('172.')
  );
};

const resolveConfiguredBackendUrl = () => {
  const envUrl = 
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_API_URL;

  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return formatUrl(envUrl);
  }

  // Graceful fallback to current origin if in browser context and no env variable was provided
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  return '';
};

export const getBackendUrl = () => {
  return resolveConfiguredBackendUrl();
};

export const getVendorBackendUrl = () => {
  if (import.meta.env.VITE_VENDOR_BACKEND_URL && typeof import.meta.env.VITE_VENDOR_BACKEND_URL === 'string') {
    return formatUrl(import.meta.env.VITE_VENDOR_BACKEND_URL);
  }
  return getBackendUrl();
};

export const getAdminBackendUrl = () => {
  if (import.meta.env.VITE_ADMIN_BACKEND_URL && typeof import.meta.env.VITE_ADMIN_BACKEND_URL === 'string') {
    return formatUrl(import.meta.env.VITE_ADMIN_BACKEND_URL);
  }
  return getBackendUrl();
};

export const getSocketUrl = () => {
  if (import.meta.env.VITE_SOCKET_URL && typeof import.meta.env.VITE_SOCKET_URL === 'string') {
    return formatUrl(import.meta.env.VITE_SOCKET_URL);
  }
  return getBackendUrl();
};
