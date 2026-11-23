export const OFFICE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const OFFICE_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type OfficePhotoMimeType = (typeof OFFICE_PHOTO_MIME_TYPES)[number];

export function detectOfficePhotoMimeType(bytes: Uint8Array): OfficePhotoMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10") return "image/png";
  if (bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
