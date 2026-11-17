import { createContext, useContext } from 'react';

export const KeyboardVisibility = createContext(false);
export const useKeyboardVisible = () => useContext(KeyboardVisibility);
