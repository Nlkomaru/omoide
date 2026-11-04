import { blurhashToCssGradientString } from "@unpic/placeholder";
import { useMemo, useState } from "react";

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
    <div
      className={`relative overflow-hidden bg-[#F4F4F5] ${className}`}
      style={{
        aspectRatio,
        backgroundImage,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-all duration-500 ease-out group-hover:scale-[1.03] ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
