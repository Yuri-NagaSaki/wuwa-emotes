import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

interface FieldCtx {
  id: string
  hintId?: string
  invalid: boolean
}
const FieldContext = createContext<FieldCtx | null>(null)

export interface FieldProps {
  label: ReactNode
  /** Right-aligned note next to the label (e.g. "选填"). */
  aside?: ReactNode
  hint?: ReactNode
  /** Error message; marks the control invalid and replaces the hint. */
  error?: ReactNode
  id?: string
  className?: string
  children: ReactNode
}

/** Label + control + hint. Input / Textarea inside pick up the id and aria wiring. */
export function Field({ label, aside, hint, error, id, className, children }: FieldProps) {
  const auto = useId()
  const fieldId = id ?? `f${auto}`
  const note = error ?? hint
  const hintId = note ? `${fieldId}-hint` : undefined
  return (
    <FieldContext.Provider value={{ id: fieldId, hintId, invalid: Boolean(error) }}>
      <div className={cx('field', className)}>
        <label htmlFor={fieldId}>
          {label}
          {aside ? <small>{aside}</small> : null}
        </label>
        {children}
        {note ? (
          <span id={hintId} className={cx('hint', error ? 'err' : null)}>
            {note}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icon?: IconName
  /** Trailing content inside the pill (a button, a kbd hint). */
  tail?: ReactNode
  size?: 'sm' | 'md'
  invalid?: boolean
  wrapClassName?: string
  ref?: Ref<HTMLInputElement>
}

export function Input({ icon, tail, size = 'md', invalid, wrapClassName, id, type = 'text', ...rest }: InputProps) {
  const field = useContext(FieldContext)
  const bad = invalid ?? field?.invalid ?? false
  return (
    <div className={cx('input', size === 'sm' && 'sm', bad && 'is-err', wrapClassName)}>
      {icon ? <Icon name={icon} /> : null}
      <input
        id={id ?? field?.id}
        type={type}
        aria-invalid={bad || undefined}
        aria-describedby={field?.hintId}
        {...rest}
      />
      {tail}
    </div>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({ id, className, ...rest }: TextareaProps) {
  const field = useContext(FieldContext)
  return (
    <textarea
      id={id ?? field?.id}
      className={cx('textarea', className)}
      aria-invalid={field?.invalid || undefined}
      aria-describedby={field?.hintId}
      {...rest}
    />
  )
}

/** Checkbox styled as the island check box. */
export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('check', checked && 'is-on')}>
      <input type="checkbox" className="sr" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span className="box" aria-hidden="true">
        <Icon name="check" />
      </span>
      {children}
    </label>
  )
}
