import type { ApiPhotoDetail, PhotoDevelopmentItem, PhotoPostItem } from "@omoide/core";
import { formatLocalTime } from "~/lib/format";

export const ORIGINAL_VARIANT = "original";

export function versionLabel({ format, label }: Pick<PhotoDevelopmentItem, "format" | "label">) {
  return `${format.toUpperCase()} · ${label}`;
}

/**
 * What to call each version on screen. Format and label don't have to be unique: a re-export under
 * the same filename is a second version, and nothing else on the row tells the two apart. So those
 * alone gain the shortest of their date, their time or their hash that separates them.
 */
export function versionLabels(developments: readonly PhotoDevelopmentItem[]): Map<string, string> {
  const namesakes = new Map<string, PhotoDevelopmentItem[]>();
  for (const development of developments) {
    const name = versionLabel(development);
    namesakes.set(name, [...(namesakes.get(name) ?? []), development]);
  }

  const labels = new Map<string, string>();
  for (const [name, group] of namesakes) {
    const distinguish = distinguisherFor(group);
    for (const development of group) {
      labels.set(development.id, distinguish ? `${name} · ${distinguish(development)}` : name);
    }
  }
  return labels;
}

function distinguisherFor(group: readonly PhotoDevelopmentItem[]) {
  if (group.length === 1) return null;
  const separates = (read: (d: PhotoDevelopmentItem) => string) =>
    new Set(group.map(read)).size === group.length;
  const date = (d: PhotoDevelopmentItem) => formatLocalTime(d.developedAt).slice(0, 10);
  const time = (d: PhotoDevelopmentItem) => formatLocalTime(d.developedAt);
  if (separates(date)) return date;
  if (separates(time)) return time;
  return (d: PhotoDevelopmentItem) => d.sha256.slice(0, 7);
}

/** Adds or replaces a version, in the newest-first order the detail endpoint returns. */
export function withDevelopment(
  detail: ApiPhotoDetail,
  development: PhotoDevelopmentItem,
): ApiPhotoDetail {
  const developments = [
    ...detail.developments.filter((d) => d.id !== development.id),
    development,
  ].sort((a, b) => b.developedAt - a.developedAt);
  return { ...detail, developments, developmentsCount: developments.length };
}

/** Removes a deleted version. Its posts stay, under the name the server kept for them. */
export function withoutDevelopment(
  detail: ApiPhotoDetail,
  developmentId: string,
  deletedVersionLabel: string,
): ApiPhotoDetail {
  const developments = detail.developments.filter((d) => d.id !== developmentId);
  return {
    ...detail,
    developments,
    developmentsCount: developments.length,
    posts: detail.posts.map((p) =>
      p.developmentId === developmentId ? { ...p, developmentId: null, deletedVersionLabel } : p,
    ),
  };
}

export function withDevelopmentFavorite(
  detail: ApiPhotoDetail,
  developmentId: string,
  isFavorite: boolean,
): ApiPhotoDetail {
  return {
    ...detail,
    developments: detail.developments.map((d) =>
      d.id === developmentId ? { ...d, isFavorite } : d,
    ),
  };
}

export function withPosts(detail: ApiPhotoDetail, posts: PhotoPostItem[]): ApiPhotoDetail {
  return {
    ...detail,
    posts,
    postsCount: posts.length,
    platforms: Array.from(new Set(posts.map((p) => p.platform))),
  };
}

export function countPostsByDevelopment(posts: readonly PhotoPostItem[]) {
  const counts = new Map<string, number>();
  for (const { developmentId } of posts) {
    if (developmentId) counts.set(developmentId, (counts.get(developmentId) ?? 0) + 1);
  }
  return counts;
}

/** The original's name stays as stored; a version's name adds its label and its own extension. */
export function downloadFilename(
  originalFilename: string,
  development: Pick<PhotoDevelopmentItem, "format" | "label"> | undefined,
): string {
  if (!development) return originalFilename;
  const stem = originalFilename.replace(/\.[^.]+$/, "");
  const label = development.label.replace(/[/\\:*?"<>|]+/g, "-");
  const extension = development.format === "jpeg" ? "jpg" : development.format;
  return `${label === stem ? stem : `${stem}-${label}`}.${extension}`;
}
