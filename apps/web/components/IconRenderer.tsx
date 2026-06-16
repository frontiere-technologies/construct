import React from 'react';
import * as Icons from 'lucide-react';

interface IconRendererProps {
  name?: string;
  className?: string;
  size?: number;
}

export const IconRenderer: React.FC<IconRendererProps> = ({ name, className, size = 20 }) => {
  if (!name) return null;

  // @ts-ignore
  const IconComponent = Icons[name];

  if (!IconComponent) {
    return <Icons.HelpCircle className={className} size={size} />;
  }

  return <IconComponent className={className} size={size} />;
};
