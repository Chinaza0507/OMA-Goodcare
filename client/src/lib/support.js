// Where patients send problem reports. PLACEHOLDER: change to the real ỌMA support email before launch.
export const SUPPORT_EMAIL = 'support@oma.ng'
export const supportMailto = (subject) => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
