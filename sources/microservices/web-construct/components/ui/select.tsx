import * as React from 'react'
import { cn } from '@/lib/utils'
import { inputBaseClasses } from './input'

/**
 * L'elemento <select> nativo, vestito come Input. Non e' il Select di Radix:
 * sostituire CustomSelect.tsx con un componente accessibile a discesa e' un
 * lavoro a se', fuori dal perimetro di UI-1.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, ...props }: SelectProps) {
  return <select className={cn(inputBaseClasses, className)} {...props} />
}
