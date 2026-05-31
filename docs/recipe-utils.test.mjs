import assert from 'node:assert/strict';
import {
  convertUnitAmount,
  formatAmountForDisplay,
  formatUnitLabel,
  formatStepText,
  renderIngredientLines,
  ingredientDisplay,
  renderStepLines,
  groupLinesBySection,
} from './recipe-utils.js';

function runTests() {
  const fracFriendly = formatAmountForDisplay(1.5);
  assert.equal(fracFriendly, '1 1/2', 'should keep simple cooking fractions');

  const gramsToOz = convertUnitAmount(100, 'g', 'oz');
  assert(gramsToOz, 'conversion for grams to ounces should succeed');
  const roundedOz = formatAmountForDisplay(gramsToOz.amount);
  assert.equal(roundedOz, '3.53', 'awkward conversions should use rounded decimals');

  const mlToCup = convertUnitAmount(500, 'ml', 'cup');
  assert(mlToCup, 'conversion for milliliters to cups should succeed');
  const decimalCup = formatAmountForDisplay(mlToCup.amount);
  assert.equal(decimalCup, '2.08', 'metric to imperial should allow decimal display');

  assert.equal(formatUnitLabel('tbsp', 1), 'tablespoon', 'singular labels stay singular');
  assert.equal(formatUnitLabel('tbsp', 2), 'tablespoons', 'plural labels switch for larger amounts');

  const sugar = { ratio: '1', unit: 'cup', display: 'sugar' };
  const sugarDisplay = ingredientDisplay(sugar, 1, 'tbsp');
  assert.equal(sugarDisplay.amountStr, '16', 'explicit unit conversions should display as clean whole numbers');
  assert.equal(sugarDisplay.convertedUnitLabel, 'tablespoons', 'converted unit label should pluralize');
  assert.equal(sugarDisplay.baseUnitLabel, 'cup', 'base unit label should stay singular');

  const oil = { ratio: '16', unit: 'tbsp', display: 'oil' };
  const oilDisplay = ingredientDisplay(oil, 1);
  assert.equal(oilDisplay.text, '1 cup oil', 'cup-sized tablespoon amounts should default to cups');
  assert.equal(oilDisplay.displayUnit, 'cup', 'default display unit should upgrade tablespoons to cups');

  const cilantro = { ratio: '2', unit: 'tbsp', display: 'fresh cilantro', ingredient_id: 'cilantro' };
  const cilantroDisplay = ingredientDisplay(cilantro, 1);
  assert.equal(cilantroDisplay.text, '1/8 cup fresh cilantro', 'cilantro should default to cups when the cup fraction is readable');

  const parsley = { ratio: '1', unit: 'tbsp', display: 'parsley', ingredient_id: 'parsley' };
  const parsleyDisplay = ingredientDisplay(parsley, 1);
  assert.equal(parsleyDisplay.text, '1 tablespoon parsley', 'tiny herb amounts should stay in tablespoons when cups would be awkward');

  const recipe = {
    token_order: ['egg', 'flour_base', 'flour_adjust'],
    ingredients: {
      egg: {
        token: 'egg',
        isChoice: true,
        options: [
          { option: 'whole', display: 'egg', ratio: '1', unit: 'count' },
          { option: 'yolk', display: 'egg yolk', ratio: '1', unit: 'count' },
        ],
      },
      flour_base: {
        token: 'flour_base',
        line_group: 'flour',
        isChoice: false,
        options: [{ option: '', display: 'all-purpose flour', ratio: '2', unit: 'cup', line_group: 'flour' }],
      },
      flour_adjust: {
        token: 'flour_adjust',
        line_group: 'flour',
        isChoice: false,
        options: [
          {
            option: '',
            display: 'all-purpose flour',
            ratio: '1/4',
            unit: 'cup',
            line_group: 'flour',
            depends_on: { token: 'egg', option: 'whole' },
          },
        ],
      },
    },
    choices: { egg: { default_option: 'whole' } },
  };

  const baseState = {
    multiplier: 1,
    panMultiplier: 1,
    restrictions: { gluten_free: false, egg_free: false, dairy_free: false },
    selectedOptions: { egg: 'whole' },
    unitSelections: {},
  };

  const groupedLines = renderIngredientLines(recipe, {
    ...baseState,
    selectedOptions: { ...baseState.selectedOptions },
    unitSelections: {},
  });
  const groupedFlour = groupedLines.find((line) => line.text.includes('flour'));
  assert.equal(groupedLines.length, 2, 'grouped ingredients should collapse sibling items but keep other lines');
  assert(groupedFlour?.text.includes('1/4'), 'dependent ingredient should show when dependency is met');

  const yolkState = { ...baseState, selectedOptions: { egg: 'yolk' } };
  const yolkLines = renderIngredientLines(recipe, yolkState);
  const yolkFlour = yolkLines.find((line) => line.text.includes('flour'));
  assert.equal(yolkLines.length, 2, 'non-dependent ingredients still render alongside grouped entries');
  assert.equal(
    yolkFlour?.text.includes('1/4'),
    false,
    'dependent ingredient should be omitted when dependency fails'
  );

  const conditionalStep =
    'Mix {{flour_base}} together{{#if egg=whole}} with {{flour_adjust}} for whole-egg batches{{/if}}';
  const conditionalWhole = formatStepText(conditionalStep, recipe, {
    ...baseState,
    selectedOptions: { ...baseState.selectedOptions },
    unitSelections: {},
  });
  assert(
    conditionalWhole.includes('whole-egg batches'),
    'conditional step text should render when dependency is satisfied'
  );
  const conditionalYolk = formatStepText(conditionalStep, recipe, yolkState);
  assert.equal(
    conditionalYolk.includes('whole-egg batches'),
    false,
    'conditional step text should disappear when dependency is not met'
  );

  const sectionedStepsRecipe = {
    ...recipe,
    steps: [
      { section: 'Prep', text: 'Combine {{flour_base}} ingredients' },
      { section: 'Cook', text: 'Heat {{egg}} mixture' },
    ],
    step_sections: ['Prep', 'Cook'],
  };
  const sectionedLines = renderStepLines(sectionedStepsRecipe, {
    ...baseState,
    selectedOptions: { ...baseState.selectedOptions },
    unitSelections: {},
  });
  assert.equal(sectionedLines[0].section, 'Prep', 'step sections should be preserved');
  const groupedSections = groupLinesBySection(sectionedLines, sectionedStepsRecipe.step_sections);
  assert.equal(groupedSections.length, 2, 'grouping should keep distinct step sections');

  const repeatedSections = groupLinesBySection(
    [
      { section: 'Prep', text: 'First prep step' },
      { section: 'Dressing', text: 'Make dressing' },
      { section: 'Prep', text: 'Second prep step' },
      { section: 'Serve', text: 'Serve it' },
    ],
    ['Prep', 'Dressing', 'Serve']
  );

  assert.equal(repeatedSections.length, 3, 'repeated section names should be grouped once');
  assert.equal(repeatedSections[0].section, 'Prep', 'Prep should remain the first grouped section');
  assert.equal(repeatedSections[0].lines.length, 2, 'non-contiguous Prep lines should be grouped together');
  assert.equal(repeatedSections[1].section, 'Dressing', 'Dressing should remain after Prep');
  assert.equal(repeatedSections[2].section, 'Serve', 'Serve should remain after Dressing');

  return 'All tests passed';
}

console.log(runTests());
