/**
 * The site logo shown after a source-matched link (FR27). The logo comes from
 * the phone's icon cache (which asks the Mac); a globe shows while loading,
 * when the site has none, or when the Mac is unreachable. Tapping it opens the
 * source page. Pure JS, Expo Go compatible.
 */

import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text } from "react-native";
import type { IconCache } from "@/store/iconCache";
import { logoDisplay } from "./inlineLink";

export function SourceLogo({
  host,
  url,
  iconCache,
  onOpen,
}: {
  host: string;
  url: string;
  iconCache: IconCache;
  onOpen: (url: string) => void;
}) {
  const [cached, setCached] = useState<string | null | undefined>(() =>
    iconCache.peek(host),
  );

  useEffect(() => {
    let active = true;
    setCached(iconCache.peek(host));
    iconCache.get(host).then(
      (value) => {
        if (active) setCached(value);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [host, iconCache]);

  const display = logoDisplay(cached);
  return (
    <Text
      onPress={() => onOpen(url)}
      accessibilityRole="link"
      accessibilityLabel="Open source"
    >
      {display.kind === "image" ? (
        <Image source={{ uri: display.uri }} style={styles.logo} />
      ) : (
        "\u{1F310}"
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  logo: { width: 14, height: 14 },
});
