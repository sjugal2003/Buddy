/** What a form's server action returns when it does not redirect. */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
  /** A one-time value to show the user, such as an invitation link. */
  link?: string;
}
