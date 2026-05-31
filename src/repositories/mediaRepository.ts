import { isMediaFile, type MediaFile, type MediaType } from '../domain/contentSchemas';
import { writeToStorage } from './storage/localStorageStore';
import { normalizeCmsMedia } from '../utils/cmsMedia';

const MEDIA_STORAGE_KEY = 'smove_media_files';
const normalizeMedia = (file: MediaFile): MediaFile => {
  const normalized = normalizeCmsMedia(file);
  if (!normalized) {
    throw new Error('Invalid media file payload');
  }
  return normalized;
};


export interface MediaUploadInput {
  name: string;
  type: MediaType;
  file: File;
  uploadedBy: string;
  alt?: string;
  caption?: string;
  tags?: string[];
}

export interface MediaRepository {
  getAll(): MediaFile[];
  getById(id: string): MediaFile | undefined;
  save(file: MediaFile): void;
  delete(id: string): void;
  upload(data: MediaUploadInput): Promise<MediaFile>;
  getByType(type: MediaType): MediaFile[];
  search(query: string): MediaFile[];
  replaceAll(files: MediaFile[]): MediaFile[];
}


class LocalMediaRepository implements MediaRepository {
  private memoryFiles: MediaFile[] = [];

  private hasStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  private readStoredFiles(): unknown[] {
    if (!this.hasStorage()) return this.memoryFiles;

    try {
      const parsed = JSON.parse(window.localStorage.getItem(MEDIA_STORAGE_KEY) || '[]') as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  getAll(): MediaFile[] {
    const files = this.readStoredFiles();
    const normalized = files.map((file) => normalizeCmsMedia(file)).filter((file): file is MediaFile => Boolean(file));
    this.memoryFiles = normalized;
    if (this.hasStorage() && JSON.stringify(files) !== JSON.stringify(normalized)) {
      writeToStorage(MEDIA_STORAGE_KEY, normalized);
    }
    return normalized;
  }

  getById(id: string): MediaFile | undefined {
    return this.getAll().find((file) => file.id === id);
  }

  save(file: MediaFile): void {
    if (!isMediaFile(file)) {
      throw new Error('Invalid media file payload');
    }

    const trustedFile = normalizeMedia(file);
    const files = this.getAll();
    const index = files.findIndex((candidate) => candidate.id === trustedFile.id);

    if (index >= 0) {
      files[index] = trustedFile;
    } else {
      files.push(trustedFile);
    }

    this.memoryFiles = files;
    writeToStorage(MEDIA_STORAGE_KEY, files);
  }

  delete(id: string): void {
    const nextFiles = this.getAll().filter((file) => file.id !== id);
    this.memoryFiles = nextFiles;
    writeToStorage(MEDIA_STORAGE_KEY, nextFiles);
  }

  upload(data: MediaUploadInput): Promise<MediaFile> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        const encodedResult = event.target?.result;
        if (typeof encodedResult !== 'string') {
          reject(new Error('Encoded media payload is missing'));
          return;
        }

        const mediaFile: MediaFile = {
          id: Date.now().toString(),
          name: data.name,
          type: data.type,
          url: encodedResult,
          thumbnailUrl: encodedResult,
          size: data.file.size,
          filename: data.file.name || data.name,
          originalName: data.file.name || data.name,
          mimeType: data.file.type,
          uploadedDate: new Date().toISOString(),
          uploadedBy: data.uploadedBy,
          alt: data.alt || data.name,
          title: data.name,
          label: data.name,
          caption: data.caption || data.alt || data.name,
          tags: data.tags || [],
          source: 'local-upload',
          metadata: { mimeType: data.file.type },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (!isMediaFile(mediaFile)) {
          reject(new Error('Invalid uploaded media payload'));
          return;
        }

        this.save(mediaFile);
        resolve(mediaFile);
      };

      reader.onerror = () => {
        reject(new Error('Unable to read media file'));
      };

      reader.readAsDataURL(data.file);
    });
  }

  getByType(type: MediaType): MediaFile[] {
    return this.getAll().filter((file) => file.type === type);
  }

  search(query: string): MediaFile[] {
    const normalizedQuery = query.toLowerCase();

    return this.getAll().filter(
      (file) =>
        file.name.toLowerCase().includes(normalizedQuery) ||
        file.alt?.toLowerCase().includes(normalizedQuery) ||
        file.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
    );
  }

  replaceAll(files: MediaFile[]): MediaFile[] {
    const normalized = files.map((file) => normalizeCmsMedia(file)).filter((file): file is MediaFile => Boolean(file));
    this.memoryFiles = normalized;
    writeToStorage(MEDIA_STORAGE_KEY, normalized);
    return normalized;
  }
}

export const mediaRepository: MediaRepository = new LocalMediaRepository();
