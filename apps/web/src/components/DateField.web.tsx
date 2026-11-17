import React from 'react';
import WebPickerField from './WebPickerField';
import type { DateFieldProps } from './DateField.types';

export default function DateField(props: DateFieldProps) {
  return <WebPickerField {...props} type="date" />;
}
