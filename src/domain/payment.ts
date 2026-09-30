export type EssentialCategoryId =
  | 'airtime'
  | 'data'
  | 'electricity'
  | 'cable-internet'

export type EssentialAvailability = 'next' | 'unavailable'

export interface EssentialCategory {
  id: EssentialCategoryId
  name: string
  description: string
  availability: EssentialAvailability
}

export const ESSENTIAL_CATEGORIES: readonly EssentialCategory[] = [
  {
    id: 'airtime',
    name: 'Airtime',
    description: 'Plan a mobile top-up when the provider flow is ready.',
    availability: 'next',
  },
  {
    id: 'data',
    name: 'Data',
    description: 'Plan a data bundle when the provider flow is ready.',
    availability: 'next',
  },
  {
    id: 'electricity',
    name: 'Electricity',
    description: 'Electricity payments are not available in this preview.',
    availability: 'unavailable',
  },
  {
    id: 'cable-internet',
    name: 'Cable & internet',
    description: 'Cable and internet payments are not available in this preview.',
    availability: 'unavailable',
  },
]
