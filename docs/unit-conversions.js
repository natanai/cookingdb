export const UNIT_CONVERSIONS = {
  volume: {
    label: 'Volume',
    base: 'ml',
    units: {
      tsp: { label: 'teaspoon', plural: 'teaspoons', to_base: 5 },
      tbsp: { label: 'tablespoon', plural: 'tablespoons', to_base: 15 },
      cup: { label: 'cup', plural: 'cups', to_base: 240 },
      fl_oz: { label: 'fl oz', plural: 'fl oz', to_base: 30 },
      pint: { label: 'pint', plural: 'pints', to_base: 480 },
      quart: { label: 'quart', plural: 'quarts', to_base: 960 },
      gallon: { label: 'gallon', plural: 'gallons', to_base: 3840 },
      ml: { label: 'mL', plural: 'mL', to_base: 1 },
      l: { label: 'liter', plural: 'liters', to_base: 1000 }
    }
  },
  mass: {
    label: 'Mass',
    base: 'g',
    units: {
      g: { label: 'gram', plural: 'grams', to_base: 1 },
      kg: { label: 'kilogram', plural: 'kilograms', to_base: 1000 },
      oz: { label: 'ounce', plural: 'ounces', to_base: 28.3495 },
      lb: { label: 'pound', plural: 'pounds', to_base: 453.592 }
    }
  },
  count: {
    label: 'Count',
    base: 'count',
    units: {
      count: { label: 'count', plural: 'count', to_base: 1 }
    }
  }
};
