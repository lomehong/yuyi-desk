import { Fragment, useCallback, type ReactNode } from "react";
import { Linking, Text, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type LinkifiedPart =
  | { type: "text"; text: string }
  | { type: "url"; text: string; href: string };

export function parseLinkifiedText(input: string): LinkifiedPart[] {
  const parts: LinkifiedPart[] = [];
  const pattern = /https?:\/\/[^\s<>。，；：！？）)\]}]+/gi;
  let cursor = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", text: input.slice(cursor, index) });
    const href = match[0].replace(/[.,;:!?。，；：！？）)\]}]+$/g, "");
    if (href) parts.push({ type: "url", text: href, href });
    cursor = index + href.length;
  }
  if (cursor < input.length) parts.push({ type: "text", text: input.slice(cursor) });
  return parts.length > 0 ? parts : [{ type: "text", text: input }];
}

// 用内容（url 用 href、纯文本用正文）构造稳定 key，重复内容以出现次序消歧，避免数组下标作 key
function keyedParts(parts: LinkifiedPart[]): { key: string; node: ReactNode }[] {
  const seen = new Map<string, number>();
  return parts.map((part) => {
    const content = part.type === "url" ? part.href : part.text;
    const count = (seen.get(content) ?? 0) + 1;
    seen.set(content, count);
    const key = count > 1 ? `${content}#${count}` : content;
    const node =
      part.type === "url" ? <LinkifiedUrl href={part.href}>{part.text}</LinkifiedUrl> : part.text;
    return { key, node };
  });
}

function LinkifiedUrl({ href, children }: { href: string; children: string }) {
  const open = useCallback(() => {
    void Linking.openURL(href);
  }, [href]);
  return (
    <Text style={styles.link} accessibilityRole="link" onPress={open}>
      {children}
    </Text>
  );
}

export function LinkifiedText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {keyedParts(parseLinkifiedText(text)).map(({ key, node }) => (
        <Fragment key={key}>{node}</Fragment>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  link: { color: theme.colors.accentBright, textDecorationLine: "underline" },
}));
