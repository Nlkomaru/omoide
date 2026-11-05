import { blurhashToCssGradientString } from "@unpic/placeholder";
import { useCallback, useMemo, useState } from "react";

interface BlurhashImageProps {
  src: string;
  alt: string;
  blurhash: string | null;
  width: number;
  height: number;
  className?: string;
}

export function BlurhashImage({
  src,
  alt,
  blurhash,
  width,
  height,
  className = "",
}: BlurhashImageProps) {
  const [loaded, setLoaded] = useState(false);

  // A cached image fires no fade: a virtualized row remounting on scroll should not flash its
  // placeholder again.
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, []);

  const backgroundImage = useMemo(() => {
    if (!blurhash || blurhash.length < 6) return undefined;
    try {
      return blurhashToCssGradientString(blurhash);
    } catch {
      return undefined;
    }
  }, [blurhash]);

  const aspectRatio = width > 0 && height > 0 ? `${width} / ${height}` : "3 / 2";

  return (
    // A span, because a thumbnail sits inside a button, which only allows phrasing content.
    <span
      className={`relative block overflow-hidden bg-subtle ${className}`}
      style={{
        aspectRatio,
        backgroundImage,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-opacity duration-500 ease-out ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </span>
  );
}
