import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './ui';

export default function Disclosure({ title, summary, children, initiallyOpen = false }: { title: string; summary?: string; children: React.ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const header = useRef<React.ComponentRef<typeof Pressable>>(null);
  const { palette, styles } = useTheme();
  return <View style={{ borderTopWidth: 1, borderColor: palette.line, paddingVertical: 16 }}>
    <Pressable ref={header} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title} onPress={() => {
      setOpen(value => !value);
      if (!open) requestAnimationFrame(() => {
        const node = header.current as unknown as { scrollIntoView?: (options: { block: 'start'; behavior: 'smooth' }) => void };
        node?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      });
    }} style={[styles.row, { minHeight: 48, justifyContent: 'space-between' }]}>
      <View style={{ flex: 1, gap: 4 }}><Text style={styles.heading}>{title}</Text>{!!summary && <Text style={styles.muted}>{summary}</Text>}</View><Text style={{ color: palette.blue, fontSize: 22, padding: 6 }}>{open ? '−' : '+'}</Text>
    </Pressable>
    {open && <View style={{ paddingTop: 20 }}>{children}</View>}
  </View>;
}
