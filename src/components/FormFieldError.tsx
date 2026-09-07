interface FormFieldErrorProps {
  message?: string;
}

export function FormFieldError({ message }: FormFieldErrorProps) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-red-500 mt-1">
      {message}
    </p>
  );
}
