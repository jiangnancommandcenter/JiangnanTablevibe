// BACKEND-03: the 5 system roles and their permission matrix.
// This is the SAME source of truth the app's UI reads to show/hide controls, but it is
// never what actually authorizes a write — firestore.rules (driven by Custom Claims) is
// the only place authorization is enforced. Treat this file as UX convenience only.

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  BRANCH_MANAGER: 'branch_manager',
  STAFF: 'staff',
  VIEWER: 'viewer',
});

export const PERMISSIONS = Object.freeze({
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  BRANCH_MANAGE: 'branch.manage',
  EMPLOYEE_MANAGE: 'employee.manage',
  SURVEY_MANAGE: 'survey.manage',
  QR_GENERATE: 'qr.generate',
  FEEDBACK_VIEW: 'feedback.view',
  FEEDBACK_RESOLVE: 'feedback.resolve',
  FEEDBACK_REPLY: 'feedback.reply',
  REWARD_MANAGE: 'reward.manage',
  REWARD_REDEEM: 'reward.redeem',
  REPORT_GENERATE: 'report.generate',
  DATA_EXPORT: 'data.export',
  GOOGLE_INTEGRATION_MANAGE: 'integration.google.manage',
  AUDIT_LOG_VIEW: 'audit.view',
  SYSTEM_SETTINGS_MANAGE: 'system.settings.manage',
});

const { USER_MANAGE, ROLE_MANAGE, BRANCH_MANAGE, EMPLOYEE_MANAGE, SURVEY_MANAGE,
  QR_GENERATE, FEEDBACK_VIEW, FEEDBACK_RESOLVE, FEEDBACK_REPLY, REWARD_MANAGE,
  REWARD_REDEEM, REPORT_GENERATE, DATA_EXPORT, GOOGLE_INTEGRATION_MANAGE,
  AUDIT_LOG_VIEW, SYSTEM_SETTINGS_MANAGE } = PERMISSIONS;

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [ROLES.ADMIN]: [
    USER_MANAGE, BRANCH_MANAGE, EMPLOYEE_MANAGE, SURVEY_MANAGE, QR_GENERATE,
    FEEDBACK_VIEW, FEEDBACK_RESOLVE, FEEDBACK_REPLY, REWARD_MANAGE, REWARD_REDEEM,
    REPORT_GENERATE, DATA_EXPORT, GOOGLE_INTEGRATION_MANAGE, AUDIT_LOG_VIEW,
  ],
  [ROLES.BRANCH_MANAGER]: [
    EMPLOYEE_MANAGE, SURVEY_MANAGE, QR_GENERATE, FEEDBACK_VIEW, FEEDBACK_RESOLVE,
    FEEDBACK_REPLY, REWARD_MANAGE, REWARD_REDEEM, REPORT_GENERATE, DATA_EXPORT,
  ],
  [ROLES.STAFF]: [
    FEEDBACK_VIEW, FEEDBACK_RESOLVE, FEEDBACK_REPLY, REWARD_REDEEM,
  ],
  [ROLES.VIEWER]: [
    FEEDBACK_VIEW, REPORT_GENERATE,
  ],
});

export function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

export function can(user, permission) {
  if (!user || !user.role) return false;
  return hasPermission(user.role, permission);
}
