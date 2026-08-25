import * as React from 'react'
import { cn } from '@/lib/utils'
import { inputBaseClasses } from './input'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cn(inputBaseClasses, className)} {...props} />
}
