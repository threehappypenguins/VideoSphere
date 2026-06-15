import type { VimeoVideoLicense } from '@/types';

/** Creative Commons license row from `GET /creativecommons`. */
export interface VimeoLicenseOption {
  code: VimeoVideoLicense;
  name: string;
}

const VIMEO_VIDEO_LICENSES = new Set<VimeoVideoLicense>([
  'by',
  'by-nc',
  'by-nc-nd',
  'by-nc-sa',
  'by-nd',
  'by-sa',
  'cc0',
]);

/**
 * Returns whether a license code is supported for Vimeo video uploads.
 * @param code - License code from the Vimeo API.
 * @returns True when the code maps to {@link VimeoVideoLicense}.
 */
export function isVimeoVideoLicenseCode(code: string): code is VimeoVideoLicense {
  return VIMEO_VIDEO_LICENSES.has(code as VimeoVideoLicense);
}
