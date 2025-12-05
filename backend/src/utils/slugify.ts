/**
 * Slugify utility for organization names
 * Converts "DBS Services" → "dbs-services"
 */

/**
 * Convert organization name to URL-safe slug
 * @param name - Organization name (e.g., "DBS Services")
 * @returns URL-safe slug (e.g., "dbs-services")
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')          // Spaces to hyphens
    .replace(/-+/g, '-')           // Multiple hyphens to single
    .replace(/^-|-$/g, '');        // Trim leading/trailing hyphens
}

/**
 * Validate that a string is a valid slug format
 * @param slug - Slug to validate
 * @returns true if valid slug format
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length >= 2;
}

/**
 * Convert input to slug format (handles both names with spaces and existing slugs)
 * @param input - Either a name ("DBS Services") or slug ("dbs-services")
 * @returns Valid slug or null if invalid
 */
export function toSlug(input: string): string | null {
  if (!input || input.trim() === '') {
    return null;
  }
  
  const slug = slugify(input);
  
  if (!isValidSlug(slug)) {
    return null;
  }
  
  return slug;
}

