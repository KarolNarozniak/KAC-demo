import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { KeyboardVisibility } from './keyboardVisibility';

export default function KeyboardFrame({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return <KeyboardVisibility.Provider value={visible}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, minHeight: 0 }}>
      {children}
    </KeyboardAvoidingView>
  </KeyboardVisibility.Provider>;
}
