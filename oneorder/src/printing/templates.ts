export type TemplateStyle = 'compact' | 'wide' | 'boxed';

export interface PrintTemplate {
  id: string;
  name: string;
  paper: string;
  description: string;
  columns: number;
  style: TemplateStyle;
}

export const TEMPLATES: PrintTemplate[] = [
  {
    id: 't2',
    name: '2-inch Compact',
    paper: '58 mm',
    description: 'Compact layout for 2-inch paper. Long item names wrap; totals stay right-aligned.',
    columns: 32,
    style: 'compact',
  },
  {
    id: 't3',
    name: '3-inch Wide',
    paper: '80 mm',
    description: 'Wider layout for 3-inch paper with a full item / qty / rate / amount table.',
    columns: 48,
    style: 'wide',
  },
  {
    id: 'alt',
    name: 'Alternative Boxed',
    paper: '80 mm',
    description: 'Boxed style with bold quantity-first item lines, for comparison.',
    columns: 48,
    style: 'boxed',
  },
];

export function templateById(id: string): PrintTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
