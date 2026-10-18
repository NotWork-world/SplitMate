// Dish name -> visual. Emoji render from the system font (Noto Color Emoji on
// Android), so they are licence-safe, offline and always match the dish type.
// Order matters: more specific words come first. Unknown dishes get a neutral
// plate — never an unrelated picture.

const RULES: Array<[RegExp, string]> = [
  [/chai|\btea\b|masala tea|green tea|iced tea/i, '🍵'],
  [/coffee|latte|cappuccino|espresso|americano|mocha|filter kaapi|cold brew/i, '☕'],
  [/lassi|milkshake|shake|smoothie|milk\b|buttermilk|chaas/i, '🥛'],
  [/biryani|pulao|pulav|fried rice|khichdi|jeera rice|steamed rice|\brice\b/i, '🍛'],
  [/pizza|margherita|farmhouse pizza/i, '🍕'],
  [/burger|whopper|zinger/i, '🍔'],
  [/fries|french fry|finger chips/i, '🍟'],
  [/hot ?dog/i, '🌭'],
  [/sandwich|sub\b|panini|club/i, '🥪'],
  [/wrap|roll|kathi|frankie|shawarma|burrito/i, '🌯'],
  [/taco/i, '🌮'],
  [/momo|dumpling|dim sum|gyoza|wonton/i, '🥟'],
  [/noodle|chowmein|chow mein|hakka|maggi|ramen|pho|thukpa/i, '🍜'],
  [/pasta|spaghetti|penne|lasagna|lasagne|macaroni|alfredo|arrabbiata/i, '🍝'],
  [/sushi|maki|nigiri/i, '🍣'],
  [/dosa|uttapam|idli|vada|appam/i, '🫓'],
  [/naan|roti|chapati|paratha|kulcha|bhatura|phulka|bread|garlic bread|pav\b|bun\b/i, '🫓'],
  [/paneer|dal|daal|curry|masala|korma|makhani|kadai|kadhai|sabzi|sabji|rajma|chole|chana|gravy|thali/i, '🍲'],
  [/tikka|kebab|kabab|tandoori|seekh|grill|bbq|barbecue/i, '🍢'],
  [/chicken|wings|drumstick|nugget/i, '🍗'],
  [/mutton|lamb|goat|steak|beef|pork|ribs/i, '🥩'],
  [/\bfish|prawn|shrimp|crab|lobster|seafood/i, '🍤'],
  [/egg|omelette|omelet|bhurji/i, '🍳'],
  [/salad|caesar/i, '🥗'],
  [/soup|shorba|rasam/i, '🥣'],
  [/samosa|pakora|pakoda|bhaji|kachori|chaat|pani ?puri|golgappa|bhel|sev puri/i, '🥟'],
  [/popcorn/i, '🍿'],
  [/chips|nachos|crisps/i, '🥨'],
  [/cake|pastry|brownie|cupcake|muffin/i, '🍰'],
  [/ice ?cream|kulfi|sundae|gelato/i, '🍨'],
  [/gulab jamun|rasgulla|rasmalai|jalebi|halwa|kheer|ladoo|laddu|barfi|sweet|mithai|dessert|payasam/i, '🍮'],
  [/donut|doughnut/i, '🍩'],
  [/cookie|biscuit/i, '🍪'],
  [/chocolate/i, '🍫'],
  [/beer|lager|ale\b|pint/i, '🍺'],
  [/wine|champagne/i, '🍷'],
  [/whisky|whiskey|vodka|\brum\b|\bgin\b|tequila|cocktail|mojito|margarita/i, '🍸'],
  [/juice|nimbu|lemonade|shikanji|soda|cola|coke|pepsi|sprite|soft drink|mocktail|drink|beverage/i, '🥤'],
  [/\bwater\b|mineral water/i, '💧'],
  [/fruit|apple|banana|mango|orange|grapes|watermelon/i, '🍎'],
];

export const FALLBACK_DISH = '🍽️';

export function dishEmoji(name: string): string {
  for (const [re, emoji] of RULES) {
    if (re.test(name)) {
      return emoji;
    }
  }
  return FALLBACK_DISH;
}

export const CATEGORY_META: Record<string, {emoji: string; label: string}> = {
  food: {emoji: '🍽️', label: 'Food & dining'},
  rent: {emoji: '🏠', label: 'Rent'},
  groceries: {emoji: '🛒', label: 'Groceries'},
  transport: {emoji: '🚕', label: 'Transport'},
  fuel: {emoji: '⛽', label: 'Fuel'},
  shopping: {emoji: '🛍️', label: 'Shopping'},
  utilities: {emoji: '💡', label: 'Utilities'},
  travel: {emoji: '✈️', label: 'Travel'},
  entertainment: {emoji: '🎬', label: 'Entertainment'},
  tickets: {emoji: '🎟️', label: 'Tickets'},
  health: {emoji: '💊', label: 'Health'},
  other: {emoji: '🧾', label: 'Other'},
};

export const GROUP_TYPE_META: Record<string, {emoji: string; label: string}> = {
  trip: {emoji: '🧳', label: 'Trip'},
  home: {emoji: '🏡', label: 'Home'},
  couple: {emoji: '💞', label: 'Couple'},
  friends: {emoji: '🍻', label: 'Friends'},
  other: {emoji: '✨', label: 'Other'},
  personal: {emoji: '👤', label: 'Personal'},
};
