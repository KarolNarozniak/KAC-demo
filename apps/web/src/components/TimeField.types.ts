export type TimeFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Podświetlenie pola wymagającego poprawy (np. w podglądzie importu). */
  invalid?: boolean;
};
