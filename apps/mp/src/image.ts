import { MAX_UPLOAD_BYTES } from "@scope/shared/schema";

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageProcessingApi {
  getImageInfo(src: string): Promise<ImageDimensions>;
  compressImage(options: {
    src: string;
    quality: number;
    compressedWidth: number;
    compressedHeight: number;
  }): Promise<string>;
}

export interface PreparedImage {
  path: string;
  compressed: boolean;
}

export function fitWithinMaxEdge(
  dimensions: ImageDimensions,
  maxEdge = 1024,
): ImageDimensions {
  if (
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new Error("E_FORMAT: 图片尺寸无效");
  }
  const ratio = Math.min(
    1,
    maxEdge / Math.max(dimensions.width, dimensions.height),
  );
  return {
    width: Math.max(1, Math.round(dimensions.width * ratio)),
    height: Math.max(1, Math.round(dimensions.height * ratio)),
  };
}

export async function prepareImageForUpload(
  path: string,
  originalSize: number,
  api: ImageProcessingApi,
): Promise<PreparedImage> {
  try {
    const dimensions = fitWithinMaxEdge(await api.getImageInfo(path));
    const compressedPath = await api.compressImage({
      src: path,
      quality: 85,
      compressedWidth: dimensions.width,
      compressedHeight: dimensions.height,
    });
    if (!compressedPath.trim()) throw new Error("压缩接口没有返回文件路径");
    return { path: compressedPath, compressed: true };
  } catch {
    if (!Number.isSafeInteger(originalSize) || originalSize <= 0) {
      throw new Error("E_FORMAT: 无法读取原图大小且压缩失败，请重新选择图片");
    }
    if (originalSize > MAX_UPLOAD_BYTES) {
      throw new Error(
        "E_SIZE: 图片压缩失败且原图超过 5MB，请重试或换一张较小的图片",
      );
    }
    return { path, compressed: false };
  }
}
