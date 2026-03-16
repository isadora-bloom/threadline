export const UPLOAD_LIMITS = {
  maxSizeBytes: 50 * 1024 * 1024, // 50MB per file
  maxSizeLabel: '50MB',
  maxFiles: 10,
  acceptedTypes: {
    // Documents
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'text/plain': ['.txt'],
    'text/csv': ['.csv'],
    // Images
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'image/heic': ['.heic'],
    // Audio
    'audio/mpeg': ['.mp3'],
    'audio/mp4': ['.m4a'],
    'audio/wav': ['.wav'],
    'audio/ogg': ['.ogg'],
    'audio/webm': ['.weba'],
    // Video
    'video/mp4': ['.mp4'],
    'video/quicktime': ['.mov'],
    'video/webm': ['.webm'],
  },
} as const

export const ACCEPTED_MIME_TYPES = Object.keys(UPLOAD_LIMITS.acceptedTypes)
export const ACCEPTED_EXTENSIONS = Object.values(UPLOAD_LIMITS.acceptedTypes).flat()
