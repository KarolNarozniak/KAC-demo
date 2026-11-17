import React from 'react';
import WebPickerField from './WebPickerField';
import type { TimeFieldProps } from './TimeField.types';

export default function TimeField(props: TimeFieldProps) {
  return <WebPickerField {...props} type="time" />;
}
