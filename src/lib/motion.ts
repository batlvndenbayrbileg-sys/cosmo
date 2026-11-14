/**
 * Shared framer-motion layout id. The check-in stage and the dashboard dock both wrap their Cosmo
 * element in <motion.div layoutId={COSMO_LAYOUT_ID}> so Cosmo glides from the full-screen stage
 * into the docked corner widget when the conversation turns into the dashboard.
 */
export const COSMO_LAYOUT_ID = "cosmo-avatar" as const;
