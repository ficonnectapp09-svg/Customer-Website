/**
 * Role Authorization and Approval Enforcement Module
 *
 * Centralized, configuration-driven security utility for multi-website ecosystems.
 * Enforces:
 *  1. Strict role isolation per application context.
 *  2. Admin approval enforcement before protected access.
 *  3. Cross-role login prevention (e.g. manager cannot log into customer app).
 *  4. Status verification (active vs pending vs suspended/rejected).
 */

export interface RoleAuthConfig {
  appContext: string;
  allowedRoles: string[];
  rolesRequiringApproval: string[];
}

/**
 * Discover the current application's role configuration from environment or repository identity.
 */
export function getAppRoleConfig(): RoleAuthConfig {
  // 1. Explicit environment variable override
  const rawContext = (process.env.APP_CONTEXT || process.env.APP_ROLE || '').toLowerCase().trim();
  const rawAllowed = (process.env.AUTHORIZED_ROLES || process.env.ALLOWED_ROLES || '').toLowerCase().trim();

  // Default context for Connect App is 'customer'
  const appContext = rawContext || 'customer';

  let allowedRoles: string[];
  if (rawAllowed) {
    allowedRoles = rawAllowed.split(',').map((r: string) => r.trim().toLowerCase()).filter(Boolean);
  } else {
    // Default allowed roles based on discovered appContext
    switch (appContext) {
      case 'admin':
        allowedRoles = ['admin', 'superadmin'];
        break;
      case 'vendor':
        allowedRoles = ['vendor', 'merchant'];
        break;
      case 'manager':
        allowedRoles = ['manager', 'connect_manager'];
        break;
      case 'agent':
        allowedRoles = ['agent', 'state_agent', 'district_agent', 'divisional_agent', 'pincode_agent'];
        break;
      case 'delivery':
        allowedRoles = ['delivery', 'rider', 'delivery_partner'];
        break;
      case 'customer':
      default:
        // Customer portal permits customer role only
        allowedRoles = ['customer'];
        break;
    }
  }

  // Roles that strictly require explicit administrative approval
  // Vendors, Managers, and Agents require admin review/approval lifecycle
  const rolesRequiringApproval = ['vendor', 'agent', 'state_agent', 'district_agent', 'divisional_agent', 'pincode_agent', 'manager', 'delivery'];

  return {
    appContext,
    allowedRoles,
    rolesRequiringApproval
  };
}

export type ApprovalState = 'APPROVED' | 'PENDING' | 'SUSPENDED' | 'REJECTED' | 'INVALID';

export interface AccountApprovalCheck {
  isApproved: boolean;
  isPending: boolean;
  isSuspended: boolean;
  isRejected: boolean;
  state: ApprovalState;
  statusCode: number;
  message: string;
}

/**
 * Normalized check for account approval and active status.
 * Fails closed: any unrecognized or missing status for approval-required accounts is treated as unapproved.
 */
export function checkAccountApproval(user: any): AccountApprovalCheck {
  if (!user || typeof user !== 'object') {
    return {
      isApproved: false,
      isPending: false,
      isSuspended: false,
      isRejected: false,
      state: 'INVALID',
      statusCode: 401,
      message: 'Invalid or missing user account.'
    };
  }

  const role = (user.role || 'customer').toString().toLowerCase().trim();
  const rawStatus = (user.status || user.approvalStatus || user.verificationStatus || '').toString().toLowerCase().trim();
  const isActive = user.isActive !== false && user.active !== false;

  // 1. Explicitly Suspended or Inactive or Blocked
  const suspendedKeywords = ['suspended', 'inactive', 'blocked', 'deactivated', 'terminated', 'disabled'];
  if (suspendedKeywords.includes(rawStatus) || !isActive) {
    return {
      isApproved: false,
      isPending: false,
      isSuspended: true,
      isRejected: false,
      state: 'SUSPENDED',
      statusCode: 403,
      message: 'Your account is suspended or inactive. Please contact support.'
    };
  }

  // 2. Explicitly Rejected
  const rejectedKeywords = ['rejected', 'declined', 'denied', 'revoked'];
  if (rejectedKeywords.includes(rawStatus)) {
    return {
      isApproved: false,
      isPending: false,
      isSuspended: false,
      isRejected: true,
      state: 'REJECTED',
      statusCode: 403,
      message: 'Your registration application was not approved. Please contact administrative support.'
    };
  }

  // 3. Explicitly Pending / Under Verification
  const pendingKeywords = [
    'pending',
    'pending_approval',
    'pending approval',
    'under_verification',
    'under verification',
    'in_review',
    'in review',
    'pending_verification',
    'requested',
    'draft',
    'awaiting_approval'
  ];
  if (pendingKeywords.includes(rawStatus)) {
    return {
      isApproved: false,
      isPending: true,
      isSuspended: false,
      isRejected: false,
      state: 'PENDING',
      statusCode: 403,
      message: 'Your account is currently awaiting administrative approval. Access to protected features will be granted once your application is reviewed and approved.'
    };
  }

  // 4. Check if role requires explicit approval
  const config = getAppRoleConfig();
  const requiresApproval = config.rolesRequiringApproval.includes(role);

  const approvedKeywords = ['active', 'approved', 'verified', 'completed'];
  const hasApprovedStatus = approvedKeywords.includes(rawStatus);

  if (requiresApproval && !hasApprovedStatus) {
    // Fail closed: role requires approval, but status is neither active nor approved
    return {
      isApproved: false,
      isPending: true,
      isSuspended: false,
      isRejected: false,
      state: 'PENDING',
      statusCode: 403,
      message: 'Your account is currently awaiting administrative approval. Access will be granted once reviewed.'
    };
  }

  // For customer role, default status is Active unless placed in Pending/Suspended
  if (role === 'customer') {
    // If status is blank or Active, customer is approved
    return {
      isApproved: true,
      isPending: false,
      isSuspended: false,
      isRejected: false,
      state: 'APPROVED',
      statusCode: 200,
      message: 'Account is active and approved.'
    };
  }

  // For admin and superadmin roles, default status is Active unless suspended/inactive
  if (role === 'admin' || role === 'superadmin') {
    return {
      isApproved: true,
      isPending: false,
      isSuspended: false,
      isRejected: false,
      state: 'APPROVED',
      statusCode: 200,
      message: 'Admin account is active and approved.'
    };
  }

  // For other roles, must have active/approved status
  if (hasApprovedStatus) {
    return {
      isApproved: true,
      isPending: false,
      isSuspended: false,
      isRejected: false,
      state: 'APPROVED',
      statusCode: 200,
      message: 'Account is active and approved.'
    };
  }

  // Fail closed
  return {
    isApproved: false,
    isPending: true,
    isSuspended: false,
    isRejected: false,
    state: 'PENDING',
    statusCode: 403,
    message: 'Your account status does not permit dashboard access. Please contact support.'
  };
}

/**
 * Verify whether a user's authoritative database role is permitted to log in or access this application.
 */
export function verifyRoleAuthorizedForApp(role: string, targetAppContext?: string): { authorized: boolean; reason?: string } {
  const config = getAppRoleConfig();
  const context = (targetAppContext || config.appContext).toLowerCase();
  const normalizedRole = (role || '').toLowerCase().trim();

  if (!normalizedRole) {
    return {
      authorized: false,
      reason: 'User account has no assigned role.'
    };
  }

  // Admin role is universally permitted for administrative areas, but not customer areas unless configured
  if (normalizedRole === 'admin' && context === 'admin') {
    return { authorized: true };
  }

  if (config.allowedRoles.includes(normalizedRole)) {
    return { authorized: true };
  }

  // Format a clear error message that explains the cross-role mismatch
  const roleDisplayNames: Record<string, string> = {
    manager: 'Connect Manager',
    vendor: 'Vendor',
    agent: 'Field Agent',
    delivery: 'Delivery Partner',
    admin: 'Administrator',
    customer: 'Customer'
  };

  const appDisplayNames: Record<string, string> = {
    customer: 'Customer Website',
    vendor: 'Vendor Portal',
    manager: 'Manager Portal',
    agent: 'Agent Directory / Portal',
    admin: 'Admin Portal'
  };

  const roleName = roleDisplayNames[normalizedRole] || normalizedRole;
  const appName = appDisplayNames[context] || `${context} application`;

  return {
    authorized: false,
    reason: `Access denied: An account registered as "${roleName}" is not authorized to access the ${appName}. Please log in through your designated portal.`
  };
}
