const EXCLUDED_AUTOMATIC_OPPORTUNITY_PATTERNS: readonly RegExp[] = [
  /\b(?:casino|sports betting|bookmaker|online betting|prediction market)\b/i,
  /\b(?:firearm|firearms|gun|guns|ammunition|silencer|switchblade|taser)\b/i,
  /\b(?:cannabis|marijuana|thc|cocaine|heroin|methamphetamine|psychedelic|magic mushrooms)\b/i,
  /\b(?:vape|vaping|nicotine|cigarette|tobacco)\b/i,
  /\b(?:beer|wine|liquor|spirits|alcohol delivery|alcohol subscription)\b/i,
  /\b(?:pornography|pornographic|adult content|adult entertainment)\b/i,
  /\b(?:dangerous challenge|stunt challenge|extreme stunt)\b/i,
];

/**
 * Automatic framing is intentionally narrower than passive evidence storage.
 *
 * Radar may observe public discussion for many reasons, but the autonomous
 * system must not convert age-restricted or inherently dangerous material into
 * a business recommendation. This gate runs before a problem cluster can be
 * promoted automatically. Manual moderation can evolve independently without
 * weakening the autonomous boundary.
 */
export function isEligibleForAutomaticOpportunityFraming(text: string): boolean {
  return !EXCLUDED_AUTOMATIC_OPPORTUNITY_PATTERNS.some((pattern) => pattern.test(text));
}
