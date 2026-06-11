import { createContext, useContext } from 'react';

export type Density = 'compact' | 'full';
export const DensityContext = createContext<Density>('full');
export function useDensity() {
  return useContext(DensityContext);
}
